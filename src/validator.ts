/**
 * Validation functions for Zekt Action
 */

import * as core from '@actions/core';
import { ActionInputs, PayloadValidationResult } from './types';
import { formatBytes } from './utils';

const MAX_PAYLOAD_SIZE = 524288; // 512 KB in bytes
const WARNING_THRESHOLD_SIZE = 419430; // 400 KB in bytes (80% of max)

/**
 * Validate payload size with warning at 80% threshold
 */
export function validatePayloadSize(payload: string): PayloadValidationResult {
  const sizeBytes = Buffer.byteLength(payload, 'utf8');

  if (sizeBytes > MAX_PAYLOAD_SIZE) {
    throw new Error(
      `Payload size (${formatBytes(sizeBytes)}) exceeds maximum allowed size (${formatBytes(MAX_PAYLOAD_SIZE)}). ` +
        `Maximum: 512 KB (524,288 bytes)`
    );
  }

  // Warning at 80% threshold (400 KB)
  if (sizeBytes > WARNING_THRESHOLD_SIZE) {
    const percentUsed = ((sizeBytes / MAX_PAYLOAD_SIZE) * 100).toFixed(1);
    const warning =
      `⚠️  Payload size is ${formatBytes(sizeBytes)} (${percentUsed}% of maximum). ` +
      `Consider reducing payload size to avoid hitting the 512 KB limit.`;
    core.warning(warning);

    return {
      valid: true,
      sizeBytes,
      warning,
    };
  }

  return {
    valid: true,
    sizeBytes,
  };
}

/**
 * Validate JSON structure
 */
export function validateJSON(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `Invalid JSON payload: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
        `Please ensure zekt_payload contains valid JSON.`
    );
  }
}

/**
 * Validate required inputs
 */
export function validateInputs(inputs: ActionInputs): void {
  if (!inputs.zektRunId || inputs.zektRunId <= 0) {
    throw new Error(
      'zekt_run_id is required and must be a positive number. ' + 'Use: ${{ github.run_id }}'
    );
  }

  if (!inputs.zektPayload || inputs.zektPayload.trim() === '') {
    throw new Error(
      'zekt_payload is required and cannot be empty. ' +
        'Provide a valid JSON object as a string.'
    );
  }

  if (!inputs.githubToken || inputs.githubToken.trim() === '') {
    throw new Error('github_token is required. Use: ${{ secrets.GITHUB_TOKEN }}');
  }

  if (!inputs.zektApiUrl || !inputs.zektApiUrl.startsWith('http')) {
    throw new Error('zekt_api_url must be a valid HTTP/HTTPS URL');
  }
}
