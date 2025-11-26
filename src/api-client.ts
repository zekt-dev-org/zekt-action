/**
 * HTTP client for communicating with Zekt backend API
 */

import * as core from '@actions/core';
import { getConfig } from './config';
import { RegisterRunRequest, ZektApiResponse } from './types';
import { sleep, redactSensitiveInfo } from './utils';

/**
 * Send payload to Zekt backend with retry logic
 * Uses centralized configuration for API endpoint
 */
export async function sendToZekt(
  request: RegisterRunRequest,
  githubToken: string,
  attempt: number = 1
): Promise<ZektApiResponse> {
  const config = getConfig();
  
  try {
    core.debug(
      `Attempt ${attempt}/${config.maxRetries}: Sending request to ${config.zektApiUrl}/api/zekt/register-run`
    );

    const response = await fetch(`${config.zektApiUrl}/api/zekt/register-run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${githubToken}`,
        'User-Agent': 'zekt-action/1.0.0',
      },
      body: JSON.stringify(request),
    });

    // Parse response body
    let responseBody: ZektApiResponse;
    try {
      responseBody = (await response.json()) as ZektApiResponse;
    } catch {
      responseBody = {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    // Handle success responses
    if (response.ok) {
      core.debug('Successfully sent to Zekt');
      return responseBody;
    }

    // Handle server errors and rate limits (retry)
    if ((response.status >= 500 || response.status === 429) && attempt < config.maxRetries) {
      const delay = config.retryDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
      core.warning(
        `Received ${response.status} from API. Retry attempt ${attempt}/${config.maxRetries} after ${delay}ms...`
      );
      await sleep(delay);
      return sendToZekt(request, githubToken, attempt + 1);
    }

    // Handle client errors (no retry) and max retries exceeded
    const errorMessage = responseBody.error || `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(redactSensitiveInfo(errorMessage));
  } catch (error) {
    // Retry on network errors
    if (attempt < config.maxRetries) {
      const delay = config.retryDelayMs * Math.pow(2, attempt - 1);
      core.warning(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
          `Retry attempt ${attempt}/${config.maxRetries} after ${delay}ms...`
      );
      await sleep(delay);
      return sendToZekt(request, githubToken, attempt + 1);
    }

    // Redact sensitive info before throwing
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new Error(redactSensitiveInfo(errorMessage));
  }
}
