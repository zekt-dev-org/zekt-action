/**
 * Tests for validator module
 */

import { validatePayloadSize, validateJSON, validateInputs } from '../src/validator';
import { ActionInputs } from '../src/types';
import * as core from '@actions/core';

// Mock @actions/core
jest.mock('@actions/core');

describe('Validator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validatePayloadSize', () => {
    it('should pass for small payload', () => {
      const payload = JSON.stringify({ data: 'small payload' });
      const result = validatePayloadSize(payload);
      expect(result.valid).toBe(true);
      expect(result.sizeBytes).toBeLessThan(524288);
      expect(result.warning).toBeUndefined();
    });

    it('should pass for payload under 400 KB without warning', () => {
      const payload = 'A'.repeat(400000); // Just under 400 KB
      const result = validatePayloadSize(payload);
      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('should warn at 80% threshold (400 KB)', () => {
      const payload = 'A'.repeat(420000); // Over 400 KB
      const result = validatePayloadSize(payload);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('⚠️');
      expect(core.warning).toHaveBeenCalled();
    });

    it('should reject payload over 512 KB', () => {
      const largePayload = 'A'.repeat(524289); // 512 KB + 1 byte
      expect(() => validatePayloadSize(largePayload)).toThrow('exceeds maximum allowed size');
    });

    it('should provide helpful error message for oversized payload', () => {
      const largePayload = 'A'.repeat(600000);
      expect(() => validatePayloadSize(largePayload)).toThrow('512 KB');
      expect(() => validatePayloadSize(largePayload)).toThrow('524,288 bytes');
    });
  });

  describe('validateJSON', () => {
    it('should parse valid JSON object', () => {
      const json = '{"test": true, "value": 42}';
      const result = validateJSON(json);
      expect(result).toEqual({ test: true, value: 42 });
    });

    it('should parse valid JSON array', () => {
      const json = '[1, 2, 3]';
      const result = validateJSON(json);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should parse nested JSON', () => {
      const json = '{"outer": {"inner": "value"}}';
      const result = validateJSON(json);
      expect(result).toEqual({ outer: { inner: 'value' } });
    });

    it('should reject invalid JSON', () => {
      const invalidJson = '{invalid}';
      expect(() => validateJSON(invalidJson)).toThrow('Invalid JSON payload');
    });

    it('should reject incomplete JSON', () => {
      const invalidJson = '{"test": ';
      expect(() => validateJSON(invalidJson)).toThrow('Invalid JSON payload');
    });

    it('should provide helpful error message', () => {
      const invalidJson = '{broken}';
      expect(() => validateJSON(invalidJson)).toThrow('ensure zekt_payload contains valid JSON');
    });
  });

  describe('validateInputs', () => {
    const validInputs: ActionInputs = {
      zektRunId: 12345,
      zektStepId: 'test-step',
      zektPayload: '{"test": true}',
      zektApiUrl: 'https://api.zekt.dev/api/zekt/register-run',
      githubToken: 'ghp_test123456789012345678901234567890',
    };

    it('should pass for valid inputs', () => {
      expect(() => validateInputs(validInputs)).not.toThrow();
    });

    it('should reject missing run_id', () => {
      const inputs = { ...validInputs, zektRunId: 0 };
      expect(() => validateInputs(inputs)).toThrow('zekt_run_id is required');
      expect(() => validateInputs(inputs)).toThrow('${{ github.run_id }}');
    });

    it('should reject negative run_id', () => {
      const inputs = { ...validInputs, zektRunId: -1 };
      expect(() => validateInputs(inputs)).toThrow('positive number');
    });

    it('should reject empty payload', () => {
      const inputs = { ...validInputs, zektPayload: '' };
      expect(() => validateInputs(inputs)).toThrow('zekt_payload is required');
    });

    it('should reject whitespace-only payload', () => {
      const inputs = { ...validInputs, zektPayload: '   ' };
      expect(() => validateInputs(inputs)).toThrow('cannot be empty');
    });

    it('should reject empty github_token', () => {
      const inputs = { ...validInputs, githubToken: '' };
      expect(() => validateInputs(inputs)).toThrow('github_token is required');
      expect(() => validateInputs(inputs)).toThrow('${{ secrets.GITHUB_TOKEN }}');
    });

    it('should reject whitespace-only github_token', () => {
      const inputs = { ...validInputs, githubToken: '  ' };
      expect(() => validateInputs(inputs)).toThrow('github_token is required');
    });

    it('should reject invalid API URL (not HTTP/HTTPS)', () => {
      const inputs = { ...validInputs, zektApiUrl: 'ftp://invalid.com' };
      expect(() => validateInputs(inputs)).toThrow('must be a valid HTTP/HTTPS URL');
    });

    it('should reject empty API URL', () => {
      const inputs = { ...validInputs, zektApiUrl: '' };
      expect(() => validateInputs(inputs)).toThrow('must be a valid HTTP/HTTPS URL');
    });

    it('should accept HTTPS URLs', () => {
      const inputs = { ...validInputs, zektApiUrl: 'https://custom.api.com/endpoint' };
      expect(() => validateInputs(inputs)).not.toThrow();
    });

    it('should accept HTTP URLs (for testing)', () => {
      const inputs = { ...validInputs, zektApiUrl: 'http://localhost:3000/test' };
      expect(() => validateInputs(inputs)).not.toThrow();
    });
  });
});
