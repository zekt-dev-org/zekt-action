import * as core from '@actions/core';
import { Context } from '@actions/github/lib/context';
import { ActionInputs } from './types';

/**
 * Get and validate action inputs
 */
export function getActionInputs(): ActionInputs {
  const eventType = core.getInput('event-type', { required: true });
  const payload = core.getInput('payload', { required: false }) || '{}';
  const zektApiUrl =
    core.getInput('zekt-api-url', { required: false }) ||
    'https://fxdevzektapp.azurewebsites.net';
  const shieldInput = core.getInput('shield', { required: false });

  // Parse boolean (handles 'true', 'false', '', etc.)
  const shield = shieldInput === 'true';

  return {
    eventType,
    payload,
    zektApiUrl,
    shield,
  };
}

/**
 * Extract workflow path from GitHub context
 * Example: "owner/repo/.github/workflows/deploy.yml@refs/heads/main"
 * Returns: ".github/workflows/deploy.yml"
 */
export function extractWorkflowPath(context: Context): string {
  // Use workflow_ref if available (GitHub Actions context)
  // @ts-ignore - workflow_ref exists in runtime context but not in types
  const workflowRef = context.workflow_ref || '';

  // Format: owner/repo/.github/workflows/file.yml@ref
  const match = workflowRef.match(/\.github\/workflows\/[^@]+/);

  if (match) {
    return match[0];
  }

  // Fallback: use workflow name
  core.warning(
    `Could not extract workflow path from workflow_ref: ${workflowRef}. ` +
      `Using workflow name instead.`
  );

  return `.github/workflows/${context.workflow}.yml`;
}
