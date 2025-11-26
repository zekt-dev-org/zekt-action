/**
 * Tests for utility functions
 */

import { sleep, formatBytes, redactSensitiveInfo } from '../src/utils';

describe('Utils', () => {
  describe('sleep', () => {
    it('should sleep for specified milliseconds', async () => {
      const start = Date.now();
      await sleep(50);
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThanOrEqual(50);
      expect(duration).toBeLessThan(150); // Allow some tolerance
    });

    it('should resolve with undefined', async () => {
      const result = await sleep(0);
      expect(result).toBeUndefined();
    });
  });

  describe('formatBytes', () => {
    it('should format zero bytes', () => {
      expect(formatBytes(0)).toBe('0 Bytes');
    });

    it('should format bytes', () => {
      expect(formatBytes(500)).toBe('500 Bytes');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(2048)).toBe('2 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
      expect(formatBytes(2.5 * 1024 * 1024)).toMatch(/2\.5 MB/);
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('should handle large numbers', () => {
      const largeNumber = 524288; // 512 KB
      const formatted = formatBytes(largeNumber);
      expect(formatted).toBe('512 KB');
    });
  });

  describe('redactSensitiveInfo', () => {
    it('should redact ghp_ token pattern', () => {
      const message =
        'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789';
      const redacted = redactSensitiveInfo(message);
      expect(redacted).toContain('[REDACTED]');
      expect(redacted).not.toContain('ghp_abc');
    });

    it('should redact gho_ token pattern', () => {
      const message =
        'Authorization: Bearer gho_abcdefghijklmnopqrstuvwxyz0123456789';
      const redacted = redactSensitiveInfo(message);
      expect(redacted).toContain('[REDACTED]');
      expect(redacted).not.toContain('gho_abc');
    });

    it('should redact ghs_ token pattern', () => {
      const message =
        'Authorization: Bearer ghs_abcdefghijklmnopqrstuvwxyz0123456789';
      const redacted = redactSensitiveInfo(message);
      expect(redacted).toContain('[REDACTED]');
      expect(redacted).not.toContain('ghs_abc');
    });

    it('should redact ghu_ token pattern', () => {
      const message =
        'Authorization: Bearer ghu_abcdefghijklmnopqrstuvwxyz0123456789';
      const redacted = redactSensitiveInfo(message);
      expect(redacted).toContain('[REDACTED]');
      expect(redacted).not.toContain('ghu_abc');
    });

    it('should redact Bearer tokens', () => {
      const message = 'Authorization: Bearer my_secret_token_123456';
      const redacted = redactSensitiveInfo(message);
      expect(redacted).toContain('[REDACTED]');
      expect(redacted).not.toContain('my_secret_token');
    });

    it('should not redact non-token content', () => {
      const message = 'This is a normal message without tokens';
      const redacted = redactSensitiveInfo(message);
      expect(redacted).toBe(message);
    });

    it('should handle multiple sensitive patterns', () => {
      const message =
        'Token ghp_123456789012345678901234567890 and Bearer xyz123 exposed';
      const redacted = redactSensitiveInfo(message);
      expect(redacted).toContain('[REDACTED]');
      expect(redacted).not.toContain('xyz123');
    });
  });
});
