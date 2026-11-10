import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  ActionInputs,
  OrchestrationPayload,
  OrchestrationStep,
  SubmitOrchestrationRequest,
  SubmitOrchestrationResponse,
  OrchestrationStatusResponse,
  OrchestrationStepStatus,
} from './types';
import { submitOrchestration, getOrchestrationStatus } from './api-client';

const STEP_ID_RE = /^[a-zA-Z0-9_-]+$/;
const SERVICE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'timed_out']);
const POLL_INTERVAL_MS = 30_000;

// Pattern to detect GitHub Actions step references that get evaluated on the runner
// before zekt-action ever sees them — these should use $zekt{{ steps.… }} instead.
const BAD_TEMPLATE_PATTERN = /\$\{\{\s*steps\./;

// spec 162 (ZA4): a GitHub expression that renders to nothing leaves
// `"condition": ,` or `"condition": }` behind, which is invalid JSON — the
// submit fails in JSON.parse, before Core ever sees the plan. This is the one
// condition failure only the action can explain.
const CONDITION_EMPTY_RENDER_RE = /"condition"\s*:\s*[,}\]]/;

const CONDITION_EMPTY_RENDER_HINT =
  "A step's `condition` rendered empty: the GitHub expression produced nothing. " +
  'Write `"condition": ${{ <expression> }}` without quotes, using an expression ' +
  'that gives true or false.';

// spec 162 (ZA8): a quoted `"condition": "${{ … }}"` renders as the string
// "false", which Core refuses by name (D9). Appended only once Core has actually
// refused, so a later Core that accepts other condition types never produces a
// false alarm in a pinned workflow.
const CONDITION_QUOTED_HINT = 'Remove the quotes around the expression.';

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

  // spec 115: strict_output_schema_resolution must be a JSON boolean when present.
  // Reject truthy-string coercion — silently enabling a strict mode the caller
  // cannot observe is worse than the field not existing.
  if (
    payload.strict_output_schema_resolution !== undefined &&
    typeof payload.strict_output_schema_resolution !== 'boolean'
  ) {
    throw new Error(
      '"strict_output_schema_resolution" must be a JSON boolean (got ' +
        `${typeof payload.strict_output_schema_resolution}: ${JSON.stringify(payload.strict_output_schema_resolution)})`
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

/**
 * Recursively scan all string values for ${{ steps. patterns.
 * GitHub Actions evaluates these on the runner (usually to empty string)
 * before zekt-action runs — callers should use $zekt{{ steps.… }} instead.
 */
function scanForBadTemplatePatterns(value: unknown): boolean {
  if (typeof value === 'string') {
    return BAD_TEMPLATE_PATTERN.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(scanForBadTemplatePatterns);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(scanForBadTemplatePatterns);
  }
  return false;
}

/**
 * Emit a warning if any step input contains ${{ steps.… }} patterns.
 * See spec Section 8.4 — these get collapsed to "" by GitHub Actions.
 */
function warnOnBadTemplatePatterns(payload: OrchestrationPayload): void {
  const hasIssue = payload.services.some(step => scanForBadTemplatePatterns(step.input));
  if (hasIssue) {
    core.warning(
      'Your orchestration payload contains ${{ steps.… }} expressions. ' +
      'GitHub Actions evaluates these on the runner (usually to an empty string) ' +
      'before Zekt sees them. Use $zekt{{ steps.… }} for cross-step references. ' +
      'See: https://github.com/zekt-dev-org/zekt-action#cross-step-output-references'
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * core.summary.addTable wraps cell text in <td> without escaping it
 * (@actions/core summary.js). Caller-supplied values therefore reach the job
 * summary as HTML. spec 162 (ZA6) adds a free-text column
 * (condition_description), so every caller-supplied cell is escaped here.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The `condition` cell: the boolean as submitted, with its description after it. */
function conditionCell(step: OrchestrationStep): string {
  if (step.condition === undefined || step.condition === null) return '';
  const value = step.condition ? 'true' : 'false';
  const description = step.condition_description;
  return description ? `${value} — ${description}` : value;
}

/**
 * The `status` cell, from the final status response. An excluded step reads as
 * excluded and never as failed (P2); a cascade names the step that excluded it.
 */
function statusCell(entry: OrchestrationStepStatus | undefined): string {
  if (!entry) return '';
  if (entry.status !== 'excluded') return entry.status;
  if (entry.exclusion_reason === 'dependency_excluded' && entry.excluded_by) {
    return `excluded (by ${entry.excluded_by})`;
  }
  return 'excluded';
}

/** spec 162 (ZA5): one info line per excluded step. Never a warning or an error. */
function logExclusions(steps: OrchestrationStepStatus[]): void {
  for (const step of steps) {
    if (step.status !== 'excluded') continue;
    if (step.exclusion_reason === 'condition_false') {
      core.info(`step '${step.step_id}' excluded by its condition`);
    } else if (step.exclusion_reason === 'dependency_excluded') {
      core.info(
        `step '${step.step_id}' excluded because '${step.excluded_by}' was excluded by its condition`
      );
    } else {
      // A reason Core adds later still gets reported verbatim (F1).
      core.info(
        `step '${step.step_id}' excluded (${step.exclusion_reason ?? 'no reason given'})`
      );
    }
  }
}

/**
 * spec 162 (ZA7): a backend that predates conditions stores none, so its status
 * entries carry no `condition` and every step ran. That is the one silent
 * failure this feature has, and it is invisible without this check.
 * Absent and null are the same thing here — a cascade-excluded step reports
 * `condition: null` — so a submitted step is only compared when it had one.
 */
function warnIfConditionsIgnored(
  request: SubmitOrchestrationRequest,
  steps: OrchestrationStepStatus[]
): void {
  const byId = new Map(steps.map((s) => [s.step_id, s]));
  const ignored = request.services.some((submitted) => {
    if (submitted.condition === undefined || submitted.condition === null) return false;
    const entry = byId.get(submitted.step_id);
    return entry !== undefined && entry.condition == null;
  });
  if (ignored) {
    core.warning(
      "Zekt ignored the steps' `condition` fields: this backend predates conditions, " +
        'so every step ran.'
    );
  }
}

/**
 * spec 162 (ZA8): Core refuses a non-boolean condition by name. When the step's
 * submitted value was a string, the cause is almost always a quoted expression,
 * which the runner renders to "true"/"false" — a string, not a boolean.
 */
function decorateConditionError(err: unknown, request: SubmitOrchestrationRequest): Error {
  const error = err instanceof Error ? err : new Error(String(err));
  if (!/invalid condition/i.test(error.message)) return error;
  const quoted = request.services.some(
    (s) => typeof (s as { condition?: unknown }).condition === 'string'
  );
  if (!quoted) return error;
  return new Error(`${error.message} ${CONDITION_QUOTED_HINT}`);
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
    // spec 162 (ZA4): an empty-rendered condition breaks the JSON here, and the
    // raw parse error alone sends the caller looking in the wrong place.
    const hint = CONDITION_EMPTY_RENDER_RE.test(inputs.payload)
      ? ` ${CONDITION_EMPTY_RENDER_HINT}`
      : '';
    throw new Error(`Orchestration payload is not valid JSON: ${msg}${hint}`);
  }

  // 2. Validate orchestration payload structure
  const orchestrationPayload = validateOrchestrationPayload(rawPayload);
  core.info(`✅ Orchestration payload validated — ${orchestrationPayload.services.length} step(s)`);

  // 2a. Warn on ${{ steps.… }} patterns — GitHub Actions eats these before we see them
  warnOnBadTemplatePatterns(orchestrationPayload);

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
  // Forward spec 115 flag verbatim; preserve false vs. absent (do not coerce).
  if (orchestrationPayload.strict_output_schema_resolution !== undefined) {
    request.strict_output_schema_resolution =
      orchestrationPayload.strict_output_schema_resolution;
  }

  // 4. Submit orchestration
  core.info(`Submitting orchestration (${effectiveMode}, ${request.services.length} step(s)) ...`);
  let submitResponse: SubmitOrchestrationResponse;
  try {
    submitResponse = await submitOrchestration(
      inputs.orchestrationApiUrl,
      oidcToken,
      repository,
      request
    );
  } catch (err) {
    throw decorateConditionError(err, request);
  }

  const executionId = submitResponse.execution_id;
  core.setOutput('execution_id', executionId);
  core.info(`✅ Orchestration submitted — execution_id: ${executionId}`);

  // 4a. Surface backend advisories (spec 113/115). Never affects exit code.
  //     Emit BEFORE the wait loop so wait: true callers see them immediately.
  if (Array.isArray(submitResponse.warnings)) {
    for (const w of submitResponse.warnings) {
      if (typeof w === 'string' && w.length > 0) {
        core.warning(`Zekt orchestration: ${w}`);
      }
    }
  }

  // 4b. spec 162 (ZA5): every step excluded means Core completed the execution at
  //     submit and dispatched nothing. Say so on a fire-and-forget run — there is
  //     no poll to report it — but change no output: outputs stay wait: true only.
  if (!inputs.wait && submitResponse.status === 'completed') {
    core.info(
      `All ${request.services.length} steps were excluded by their conditions; nothing was sent.`
    );
  }

  // 5. Optionally wait for completion
  let finalStatus: OrchestrationStatusResponse | undefined;
  if (inputs.wait) {
    finalStatus = await pollUntilTerminal(
      inputs.orchestrationApiUrl,
      oidcToken,
      repository,
      executionId,
      request
    );
  }

  // 6. Write job summary — before the throw below (F2), so a failed or timed-out
  //    orchestration has a summary too. It is the surface a human reads to see
  //    which step ended how, which is exactly the failing case.
  await writeOrchestrationSummary(executionId, request, inputs.wait, finalStatus);

  // 7. A non-completed terminal status fails the run, now that the summary exists.
  if (finalStatus && finalStatus.status !== 'completed') {
    core.error(`Orchestration ${executionId} ended with status: ${finalStatus.status}`);
    throw new Error(`Orchestration ended with status: ${finalStatus.status}`);
  }
}

// ============================================================================
// Poll loop
// ============================================================================

/**
 * Polls until the execution reaches a terminal status and returns that status
 * response. Deliberately does not throw on a failed execution: the caller writes
 * the job summary from this response first, then fails the run (F2).
 */
async function pollUntilTerminal(
  apiUrl: string,
  oidcToken: string,
  repository: string,
  executionId: string,
  request: SubmitOrchestrationRequest
): Promise<OrchestrationStatusResponse> {
  core.info(`Polling orchestration status for ${executionId} (every 30s) ...`);

  while (true) {
    const statusResponse = await getOrchestrationStatus(
      apiUrl,
      oidcToken,
      repository,
      executionId
    );

    const status = statusResponse.status;

    if (TERMINAL_STATUSES.has(status)) {
      core.setOutput('execution_status', status);

      const steps = statusResponse.steps ?? [];

      // Write each step's outputs as step_{step_id}_outputs_{field}=value
      for (const step of steps) {
        for (const [field, value] of Object.entries(step.outputs ?? {})) {
          core.setOutput(`step_${step.step_id}_outputs_${field}`, String(value));
        }
      }

      // spec 162 (ZA5): a step's status, so a workflow can tell an excluded step
      // from one that ran and reported nothing — both write no outputs.
      for (const step of steps) {
        core.setOutput(`step_${step.step_id}_status`, step.status);
      }

      // Always present under wait: an unset output and an empty one are the same
      // thing in a workflow expression, so "0" is the only usable contract.
      core.setOutput('excluded_steps', String(statusResponse.excluded_steps ?? 0));

      logExclusions(steps);
      warnIfConditionsIgnored(request, steps);

      if (status === 'completed') {
        core.info(`✅ Orchestration completed — execution_id: ${executionId}`);
      }
      return statusResponse;
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
  waited: boolean,
  finalStatus?: OrchestrationStatusResponse
): Promise<void> {
  const byId = new Map((finalStatus?.steps ?? []).map((s) => [s.step_id, s]));

  // Every cell below is caller-supplied and would reach the summary as raw HTML
  // unless escaped here (see escapeHtml).
  const rows: string[][] = request.services.map((s) => {
    const cells = [
      s.step_id,
      s.service_slug,
      s.service_owner_name ?? request.default_service_owner ?? '',
      conditionCell(s),
    ];
    if (waited) cells.push(statusCell(byId.get(s.step_id)));
    return cells.map(escapeHtml);
  });

  const header = [
    { data: 'step_id', header: true },
    { data: 'service_slug', header: true },
    { data: 'owner', header: true },
    { data: 'condition', header: true },
  ];
  if (waited) header.push({ data: 'status', header: true });

  const overview: string[][] = [
    ['Execution ID', executionId],
    ['Execution Mode', request.execution_mode],
    ['Steps', request.services.length.toString()],
    ['Waited for Completion', waited ? 'Yes' : 'No (fire-and-forget)'],
  ];
  if (finalStatus) {
    overview.push(['Execution Status', finalStatus.status]);
    overview.push(['Excluded Steps', String(finalStatus.excluded_steps ?? 0)]);
  }

  await core.summary
    .addHeading('Zekt Orchestration')
    .addTable([
      [
        { data: 'Property', header: true },
        { data: 'Value', header: true },
      ],
      ...overview.map((row) => row.map(escapeHtml)),
    ])
    .addHeading('Steps', 3)
    .addTable([header, ...rows])
    .addRaw('<hr>')
    .addRaw('_Sent via [Zekt Action](https://github.com/zekt-dev-org/zekt-action)_')
    .write();
}
