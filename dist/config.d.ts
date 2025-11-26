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
export declare function getConfig(): ActionConfig;
