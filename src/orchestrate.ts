import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  ActionInputs,
  OrchestrationPayload,
  OrchestrationStep,
  SubmitOrchestrationRequest,
} from './types';
import { submitOrchestration, getOrchestrationStatus } from './api-client';

const STEP_ID_RE = /^[a-zA-Z0-9_-]+$/;
const SERVICE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'timed_out']);
const POLL_INTERVAL_MS = 30_000;

// ============================================================================
// Payload validation
// ============================================================================

function validateOrchestrationPayload(raw: unknown): OrchestrationPayload {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Orchestration payload must be a JSON object');
  }

  const payload = raw as Record<string, unknown>;

  if (!Array.isArray(payload.services) || payload.services.length === 0) {
    throw new Error('Orchestration payload must contain a non-empty "services" array');
  }

  if (payload.services.length > 20) {
    throw new Error(
      `Orchestration payload "services" array must have at most 20 items (got ${payload.services.length})`
    );
  }

  const knownStepIds = new Set<string>();

  for (let i = 0; i < payload.services.length; i++) {
    const step = payload.services[i] as Record<string, unknown>;
    const prefix = `services[${i}]`;

    // step_id
    if (typeof step.step_id !== 'string' || !step.step_id) {
      throw new Error(`${prefix}: "step_id" is required and must be a non-empty string`);
    }
    if (step.step_id.length > 64 || !STEP_ID_RE.test(step.step_id)) {
      throw new Error(
        `${prefix}: "step_id" must match ^[a-zA-Z0-9_-]+$ and be at most 64 chars (got "${step.step_id}")`
      );
    }
    if (knownStepIds.has(step.step_id)) {
      throw new Error(`${prefix}: duplicate step_id "${step.step_id}"`);
    }
    knownStepIds.add(step.step_id);

    // service_slug
    if (typeof step.service_slug !== 'string' || !step.service_slug) {
      throw new Error(`${prefix}: "service_slug" is required`);
    }
    if (!SERVICE_SLUG_RE.test(step.service_slug)) {
      throw new Error(
        `${prefix}: "service_slug" must match ^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$ (got "${step.service_slug}")`
      );
    }

    // service owner resolution
    const hasStepOwner =
      typeof step.service_owner_name === 'string' && step.service_owner_name.length > 0;
    const hasDefaultOwner =
      typeof payload.default_service_owner === 'string' &&
      (payload.default_service_owner as string).length > 0;
    if (!hasStepOwner && !hasDefaultOwner) {
      throw new Error(
        `${prefix}: service owner must be set via "service_owner_name" on the step or "default_service_owner" at the root`
      );
    }

    // input
    if (
      typeof step.input !== 'object' ||
      step.input === null ||
      Array.isArray(step.input)
    ) {
      throw new Error(`${prefix}: "input" must be a JSON object`);
    }
  }

  // Validate depends_on references now that all step_ids are known
  for (let i = 0; i < payload.services.length; i++) {
    const step = payload.services[i] as Record<string, unknown>;
    const prefix = `services[${i}]`;

    if (step.depends_on !== undefined) {
      if (!Array.isArray(step.depends_on)) {
        throw new Error(`${prefix}: "depends_on" must be an array`);
      }
      for (const dep of step.depends_on as unknown[]) {
        if (typeof dep !== 'string') {
          throw new Error(`${prefix}: each "depends_on" entry must be a string`);
        }
        if (!knownStepIds.has(dep)) {
          throw new Error(
            `${prefix}: "depends_on" references unknown step_id "${dep}"`
          );
        }
      }
    }
  }

  return payload as unknown as OrchestrationPayload;
}

// ============================================================================
// Main orchestration entry point
// ============================================================================

export async function runOrchestration(inputs: ActionInputs, oidcToken: string): Promise<void> {
  const repository = `${github.context.repo.owner}/${github.context.repo.repo}`;

  // 1. Parse payload
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(inputs.payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Orchestration payload is not valid JSON: ${msg}`);
  }

  // 2. Validate orchestration payload structure
  const orchestrationPayload = validateOrchestrationPayload(rawPayload);
  core.info(`✅ Orchestration payload validated — ${orchestrationPayload.services.length} step(s)`);

  // 3. Build request — payload.execution_mode wins over the action input
  const effectiveMode = orchestrationPayload.execution_mode ?? inputs.executionMode;

  const request: SubmitOrchestrationRequest = {
    workflow_run_id: github.context.runId,
    execution_mode: effectiveMode,
    services: orchestrationPayload.services as OrchestrationStep[],
  };
  if (orchestrationPayload.default_service_owner) {
    request.default_service_owner = orchestrationPayload.default_service_owner;
  }

  // 4. Submit orchestration
  core.info(`Submitting orchestration (${effectiveMode}, ${request.services.length} step(s)) ...`);
  const submitResponse = await submitOrchestration(
    inputs.zektApiUrl,
    oidcToken,
    repository,
    request
  );

  const executionId = submitResponse.execution_id;
  core.setOutput('execution_id', executionId);
  core.info(`✅ Orchestration submitted — execution_id: ${executionId}`);

  // 5. Optionally wait for completion
  if (inputs.wait) {
    await pollUntilTerminal(inputs, oidcToken, repository, executionId);
  }

  // 6. Write job summary
  await writeOrchestrationSummary(executionId, request, inputs.wait);
}

// ============================================================================
// Poll loop
// ============================================================================

async function pollUntilTerminal(
  inputs: ActionInputs,
  oidcToken: string,
  repository: string,
  executionId: string
): Promise<void> {
  core.info(`Polling orchestration status for ${executionId} (every 30s) ...`);

  while (true) {
    const statusResponse = await getOrchestrationStatus(
      inputs.zektApiUrl,
      oidcToken,
      repository,
      executionId
    );

    const status = statusResponse.status;

    if (TERMINAL_STATUSES.has(status)) {
      core.setOutput('execution_status', status);

      // Write each step's outputs as step_{step_id}_outputs_{field}=value
      for (const step of statusResponse.steps ?? []) {
        for (const [field, value] of Object.entries(step.outputs ?? {})) {
          core.setOutput(`step_${step.step_id}_outputs_${field}`, String(value));
        }
      }

      if (status !== 'completed') {
        core.error(`Orchestration ${executionId} ended with status: ${status}`);
        throw new Error(`Orchestration ended with status: ${status}`);
      }

      core.info(`✅ Orchestration completed — execution_id: ${executionId}`);
      return;
    }

    core.info(`Status: ${status} — waiting 30s ...`);
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// ============================================================================
// Job summary
// ============================================================================

async function writeOrchestrationSummary(
  executionId: string,
  request: SubmitOrchestrationRequest,
  waited: boolean
): Promise<void> {
  const rows: string[][] = request.services.map((s) => [
    s.step_id,
    s.service_slug,
    s.service_owner_name ?? request.default_service_owner ?? '',
  ]);

  await core.summary
    .addHeading('Zekt Orchestration')
    .addTable([
      [
        { data: 'Property', header: true },
        { data: 'Value', header: true },
      ],
      ['Execution ID', executionId],
      ['Execution Mode', request.execution_mode],
      ['Steps', request.services.length.toString()],
      ['Waited for Completion', waited ? 'Yes' : 'No (fire-and-forget)'],
    ])
    .addHeading('Steps', 3)
    .addTable([
      [
        { data: 'step_id', header: true },
        { data: 'service_slug', header: true },
        { data: 'owner', header: true },
      ],
      ...rows,
    ])
    .addRaw('<hr>')
    .addRaw('_Sent via [Zekt Action](https://github.com/zekt-dev-org/zekt-action)_')
    .write();
}
