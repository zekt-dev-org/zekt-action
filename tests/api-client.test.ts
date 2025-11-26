/**
 * Tests for API client module
 */

import { sendToZekt } from '../src/api-client';
import { RegisterRunRequest, ZektApiResponse } from '../src/types';
import * as core from '@actions/core';
import { sleep } from '../src/utils';

// Mock @actions/core
jest.mock('@actions/core');

// Mock config
jest.mock('../src/config', () => ({
  getConfig: jest.fn(() => ({
    zektApiUrl: 'https://api.zekt.dev',
    maxPayloadSizeBytes: 512 * 1024,
    payloadSizeWarningThresholdBytes: 400 * 1024,
    maxRetries: 3,
    retryDelayMs: 1000,
  })),
}));

// Mock utils
jest.mock('../src/utils', () => {
  const actual = jest.requireActual('../src/utils');
  return {
    ...actual,
    sleep: jest.fn().mockResolvedValue(undefined),
  };
});

// Mock global fetch
const fetchMock = jest.fn();
Object.defineProperty(global, 'fetch', {
  value: fetchMock,
  writable: true,
});

describe('API Client', () => {
  const mockPayload: RegisterRunRequest = {
    zekt_run_id: 12345,
    zekt_step_id: 'test-step',
    zekt_payload: { test: true },
    github_context: {
      repository: 'owner/repo',
      workflow: 'CI',
      job: 'build',
      actor: 'testuser',
      event_name: 'push',
      ref: 'refs/heads/main',
      sha: 'abc123',
    },
  };

  const mockToken = 'ghp_test123';

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock) = jest.fn();
  });

  describe('sendToZekt', () => {
    it('should successfully send payload', async () => {
      const mockResponse: ZektApiResponse = {
        success: true,
        run_id: 12345,
        step_id: 'test-step',
        message: 'Payload registered successfully',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => mockResponse,
      });

      const result = await sendToZekt(mockPayload, mockToken);

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.zekt.dev/api/zekt/register-run',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mockToken}`,
            'User-Agent': 'zekt-action/1.0.0',
          }),
          body: JSON.stringify(mockPayload),
        })
      );
    });

    it('should retry on 500 error', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ success: false, error: 'Server error' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 202,
          json: async () => ({ success: true, message: 'Success on retry' }),
        });

      const result = await sendToZekt(mockPayload, mockToken);

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(1000); // First retry delay
    });

    it('should retry on 429 rate limit', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: async () => ({ success: false, error: 'Rate limited' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 202,
          json: async () => ({ success: true }),
        });

      await sendToZekt(mockPayload, mockToken);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('429'));
    });

    it('should use exponential backoff for retries', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ success: false }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ success: false }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 202,
          json: async () => ({ success: true }),
        });

      await sendToZekt(mockPayload, mockToken);

      expect(sleep).toHaveBeenNthCalledWith(1, 1000); // 2^0 * 1000
      expect(sleep).toHaveBeenNthCalledWith(2, 2000); // 2^1 * 1000
    });

    it('should fail after max retries', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ success: false, error: 'Persistent error' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ success: false, error: 'Persistent error' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ success: false, error: 'Persistent error' }),
        });

      await expect(
        sendToZekt(mockPayload, mockToken)
      ).rejects.toThrow('Persistent error');

      expect(global.fetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should handle network errors with retry', async () => {
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          status: 202,
          json: async () => ({ success: true }),
        });

      const result = await sendToZekt(mockPayload, mockToken);

      expect(result.success).toBe(true);
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Network error'));
    });
  });
});
