/**
 * Tests for main run function
 */

import { run } from '../src/run';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { sendToZekt } from '../src/api-client';

// Mock dependencies
jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('../src/api-client');
jest.mock('../src/config', () => ({
  getConfig: jest.fn(() => ({
    zektApiUrl: 'https://api.zekt.dev',
    maxPayloadSizeBytes: 512 * 1024,
    payloadSizeWarningThresholdBytes: 400 * 1024,
    maxRetries: 3,
    retryDelayMs: 1000,
  })),
}));

describe('Run Function', () => {
  const mockGetInput = core.getInput as jest.MockedFunction<typeof core.getInput>;
  const mockSetOutput = core.setOutput as jest.MockedFunction<typeof core.setOutput>;
  const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>;
  const mockInfo = core.info as jest.MockedFunction<typeof core.info>;
  const mockSendToZekt = sendToZekt as jest.MockedFunction<typeof sendToZekt>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock GitHub context
    Object.defineProperty(github, 'context', {
      value: {
        repo: { owner: 'test-owner', repo: 'test-repo' },
        workflow: 'CI Pipeline',
        job: 'build',
        actor: 'testuser',
        eventName: 'push',
        ref: 'refs/heads/main',
        sha: 'abc123def456',
      },
      configurable: true,
    });

    // Default input mocks (no zekt_api_url needed)
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        zekt_run_id: '12345',
        zekt_step_id: 'test-step',
        zekt_payload: '{"test": true, "value": 42}',
        github_token: 'ghp_test123456',
      };
      return inputs[name] || '';
    });
  });

  it('should successfully register a run', async () => {
    mockSendToZekt.mockResolvedValueOnce({
      success: true,
      run_id: 12345,
      step_id: 'test-step',
      message: 'Success',
    });

    await run();

    expect(mockSendToZekt).toHaveBeenCalledWith(
      expect.objectContaining({
        zekt_run_id: 12345,
        zekt_step_id: 'test-step',
        zekt_payload: { test: true, value: 42 },
        github_context: expect.objectContaining({
          repository: 'test-owner/test-repo',
          workflow: 'CI Pipeline',
        }),
      }),
      'ghp_test123456'
    );

    expect(mockSetOutput).toHaveBeenCalledWith('success', 'true');
    expect(mockSetOutput).toHaveBeenCalledWith('run_id', '12345');
    expect(mockSetOutput).toHaveBeenCalledWith('step_id', 'test-step');
    expect(mockSetOutput).toHaveBeenCalledWith('error_message', '');
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Successfully registered'));
  });

  it('should use default step_id when not provided', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'zekt_step_id') return '';
      return name === 'zekt_run_id'
        ? '12345'
        : name === 'zekt_payload'
          ? '{"test": true}'
          : 'token';
    });

    mockSendToZekt.mockResolvedValueOnce({ success: true });

    await run();

    expect(mockSendToZekt).toHaveBeenCalledWith(
      expect.objectContaining({
        zekt_step_id: 'default',
      }),
      expect.any(String)
    );
  });

  it('should handle invalid JSON payload', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'zekt_payload') return '{invalid json}';
      return name === 'zekt_run_id'
        ? '12345'
        : 'token';
    });

    await run();

    expect(mockSetOutput).toHaveBeenCalledWith('success', 'false');
    expect(mockSetOutput).toHaveBeenCalledWith(
      'error_message',
      expect.stringContaining('Invalid JSON payload')
    );
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON'));
  });

  it('should handle payload size validation error', async () => {
    const largePayload = 'A'.repeat(524289); // Over 512 KB
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'zekt_payload') return largePayload;
      return name === 'zekt_run_id'
        ? '12345'
        : 'token';
    });

    await run();

    expect(mockSetOutput).toHaveBeenCalledWith('success', 'false');
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('exceeds maximum allowed size')
    );
  });

  it('should handle API errors', async () => {
    mockSendToZekt.mockRejectedValueOnce(new Error('API Error: Connection timeout'));

    await run();

    expect(mockSetOutput).toHaveBeenCalledWith('success', 'false');
    expect(mockSetOutput).toHaveBeenCalledWith('error_message', 'API Error: Connection timeout');
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('API Error: Connection timeout')
    );
  });

  it('should handle missing required inputs', async () => {
    mockGetInput.mockImplementation((name: string) => {
      if (name === 'zekt_run_id') return '0'; // Invalid
      return '';
    });

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('zekt_run_id is required')
    );
  });

  it('should construct proper GitHub context', async () => {
    mockSendToZekt.mockResolvedValueOnce({ success: true });

    await run();

    expect(mockSendToZekt).toHaveBeenCalledWith(
      expect.objectContaining({
        github_context: {
          repository: 'test-owner/test-repo',
          workflow: 'CI Pipeline',
          job: 'build',
          actor: 'testuser',
          event_name: 'push',
          ref: 'refs/heads/main',
          sha: 'abc123def456',
        },
      }),
      expect.any(String)
    );
  });

  it('should log validation steps', async () => {
    mockSendToZekt.mockResolvedValueOnce({ success: true });

    await run();

    expect(mockInfo).toHaveBeenCalledWith('Validating inputs...');
    expect(mockInfo).toHaveBeenCalledWith('Validating payload size...');
    expect(mockInfo).toHaveBeenCalledWith('Validating JSON structure...');
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Sending payload to Zekt'));
  });
});
