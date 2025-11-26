/**
 * HTTP client for communicating with Zekt backend API
 */

import * as core from '@actions/core';
import { RegisterRunRequest, ZektApiResponse } from './types';
import { sleep, redactSensitiveInfo } from './utils';

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000; // 1 second

/**
 * Send payload to Zekt backend with retry logic
 */
export async function sendToZekt(
  url: string,
  payload: RegisterRunRequest,
  githubToken: string,
  repository: string,
  runId: number,
  attempt: number = 1
): Promise<ZektApiResponse> {
  try {
    core.debug(`Attempt ${attempt}/${MAX_RETRIES}: Sending request to ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Repository': repository,
        'X-GitHub-Run-ID': runId.toString(),
        'User-Agent': 'zekt-action/1.0.0',
      },
      body: JSON.stringify(payload),
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

    // Handle error responses first (before retry logic)
    if (!response.ok) {
      const errorMessage = responseBody.error || `HTTP ${response.status}: ${response.statusText}`;
      
      // Retry on 5xx errors or 429 (rate limit) only
      if ((response.status >= 500 || response.status === 429) && attempt < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
        core.warning(
          `Received ${response.status} from API. Retry attempt ${attempt}/${MAX_RETRIES} after ${delay}ms...`
        );
        await sleep(delay);
        return sendToZekt(url, payload, githubToken, repository, runId, attempt + 1);
      }
      
      // Don't retry on 4xx client errors (401, 403, 400, etc.)
      throw new Error(redactSensitiveInfo(errorMessage));
    }

    return responseBody;
  } catch (error) {
    // Retry on network errors
    if (attempt < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      core.warning(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
          `Retry attempt ${attempt}/${MAX_RETRIES} after ${delay}ms...`
      );
      await sleep(delay);
      return sendToZekt(url, payload, githubToken, repository, runId, attempt + 1);
    }

    // Redact sensitive info before throwing
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new Error(redactSensitiveInfo(errorMessage));
  }
}
