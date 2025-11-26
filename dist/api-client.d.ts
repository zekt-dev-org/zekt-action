/**
 * HTTP client for communicating with Zekt backend API
 */
import { RegisterRunRequest, ZektApiResponse } from './types';
/**
 * Send payload to Zekt backend with retry logic
 * Uses centralized configuration for API endpoint
 */
export declare function sendToZekt(request: RegisterRunRequest, githubToken: string, attempt?: number): Promise<ZektApiResponse>;
