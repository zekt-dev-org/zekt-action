/**
 * Centralized configuration for Zekt Action
 * This keeps sensitive endpoints abstracted from end users
 * API endpoint is set during action build/deployment via environment variables
 */

export interface ActionConfig {
  zektApiUrl: string;
  maxPayloadSizeBytes: number;
  payloadSizeWarningThresholdBytes: number;
  maxRetries: number;
  retryDelayMs: number;
}

/**
 * Load configuration from environment variables
 * The ZEKT_API_URL should be set during build time from GitHub Actions secrets
 */
export function getConfig(): ActionConfig {
  const zektApiUrl = process.env.ZEKT_API_URL;

  if (!zektApiUrl) {
    throw new Error(
      'ZEKT_API_URL environment variable is not set. ' +
        'This should be configured in the action repository during deployment.'
    );
  }

  return {
    zektApiUrl,
    maxPayloadSizeBytes: 512 * 1024, // 512 KB
    payloadSizeWarningThresholdBytes: 400 * 1024, // 400 KB (80%)
    maxRetries: 3,
    retryDelayMs: 1000, // 1 second base delay
  };
}
