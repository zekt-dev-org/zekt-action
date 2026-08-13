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
 *
 * Wire format expected in client_payload._zekt.orchestration (camelCase):
 *   { executionId: string, stepId: string, requestorRepository?: string }
 * Returned ref (snake_case, per RegisterRunOrchestrationRef DTO):
 *   { execution_id: string, step_id: string }
 *
 * If _zekt.orchestration exists but is missing/empty on either required field,
 * a ::warning:: is emitted and null is returned (never send a partial ref —
 * the backend would accept it and then fail to advance the step).
 */
export function readOrchestrationStepRef(): OrchestrationStepRef | null {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (eventName !== 'repository_dispatch' || !eventPath) {
    return null;
  }

  let event: unknown;
  try {
    event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
  } catch {
    return null;
  }

  const orch = (event as { client_payload?: { _zekt?: { orchestration?: unknown } } })
    ?.client_payload?._zekt?.orchestration;

  if (!orch || typeof orch !== 'object') {
    return null;
  }

  const executionId = (orch as { executionId?: unknown }).executionId;
  const stepId = (orch as { stepId?: unknown }).stepId;
  const hasExec = typeof executionId === 'string' && executionId.length > 0;
  const hasStep = typeof stepId === 'string' && stepId.length > 0;

  if (hasExec && hasStep) {
    return { execution_id: executionId as string, step_id: stepId as string };
  }

  core.warning(
    '_zekt.orchestration present but incomplete (executionId and stepId required) — dropping orchestration_step_ref'
  );
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
