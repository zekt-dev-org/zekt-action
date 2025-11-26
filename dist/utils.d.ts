/**
 * Utility functions for Zekt Action
 */
/**
 * Sleep for a specified number of milliseconds
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * Format bytes to human-readable string
 */
export declare function formatBytes(bytes: number): string;
/**
 * Redact sensitive information from error messages
 */
export declare function redactSensitiveInfo(message: string): string;
