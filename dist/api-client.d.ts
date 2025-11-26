/**
 * HTTP client for communicating with Zekt backend API
 */
import { RegisterRunRequest, ZektApiResponse } from './types';
/**
 * Send payload to Zekt backend with retry logic
 */
export declare function sendToZekt(url: string, payload: RegisterRunRequest, githubToken: string, repository: string, runId: number, attempt?: number): Promise<ZektApiResponse>;
