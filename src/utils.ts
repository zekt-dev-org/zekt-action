import * as core from '@actions/core';
import * as fs from 'fs';
import { Context } from '@actions/github/lib/context';
import { ActionInputs, OrchestrationStepRef } from './types';

/**
 * Get and validate action inputs
 */
export function getActionInputs(): ActionInputs {
  const eventType = core.getInput('event-type', { required: false }) || '';
  const payload = core.getInput('payload', { required: false }) || '{}';
  const zektApiUrl =
    core.getInput('zekt-api-url', { required: false }) ||
    'https://fxdevzektapp.azurewebsites.net';
  const orchestrationApiUrl =
    core.getInput('orchestration-api-url', { required: false }) ||
    'https://www.zekt.dev';
  const shieldInput = core.getInput('shield', { required: false });
  const orchestrateInput = core.getInput('orchestrate', { required: false });
  const executionMode = core.getInput('execution_mode', { required: false }) || 'sequential';
  const waitInput = core.getInput('wait', { required: false });

  const shield = shieldInput === 'true';
  const orchestrate = orchestrateInput === 'true';
  const wait = waitInput === 'true';

  return {
    eventType,
    payload,
    zektApiUrl,
    orchestrationApiUrl,
    shield,
    orchestrate,
    executionMode,
    wait,
  };
}

/**
 * Reads orchestration_step_ref from the GitHub event file when running inside
 * a repository_dispatch-triggered workflow that is part of an orchestration.
 * Returns null for all standard (non-orchestrated) runs.
 */
export function readOrchestrationStepRef(): OrchestrationStepRef | null {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (eventName !== 'repository_dispatch' || !eventPath) {
    return null;
  }

  try {
    const raw = fs.readFileSync(eventPath, 'utf-8');
    const event = JSON.parse(raw);
    // _zekt.orchestration uses camelCase: executionId, stepId
    const orch = event?.client_payload?._zekt?.orchestration;

    if (
      orch &&
      typeof orch.executionId === 'string' &&
      typeof orch.stepId === 'string'
    ) {
      return { execution_id: orch.executionId, step_id: orch.stepId };
    }
  } catch {
    // Non-fatal: if we can't read the event file, treat as non-orchestrated
  }

  return null;
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
