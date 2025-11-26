/**
 * Utility functions for Zekt Action
 */

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Redact sensitive information from error messages
 */
export function redactSensitiveInfo(message: string): string {
  // Redact GitHub token patterns
  let redacted = message.replace(/ghp_[a-zA-Z0-9]{36}/g, 'ghp_[REDACTED]');
  redacted = redacted.replace(/gho_[a-zA-Z0-9]{36}/g, 'gho_[REDACTED]');
  redacted = redacted.replace(/ghs_[a-zA-Z0-9]{36}/g, 'ghs_[REDACTED]');
  redacted = redacted.replace(/ghu_[a-zA-Z0-9]{36}/g, 'ghu_[REDACTED]');
  
  // Redact Bearer tokens from headers
  redacted = redacted.replace(/Bearer\s+[a-zA-Z0-9_-]+/g, 'Bearer [REDACTED]');
  
  return redacted;
}
