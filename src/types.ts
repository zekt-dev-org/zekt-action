// ============================================================================
// Action Inputs
// ============================================================================

export interface ActionInputs {
  eventType: string;
  payload: string;
  zektApiUrl: string;
  orchestrationApiUrl: string;
  shield: boolean;
  orchestrate: boolean;
  executionMode: string;
  wait: boolean;
}

// ============================================================================
// Shield API Types
// ============================================================================

export interface ShieldKeysRequest {
  repository: string;
}

export interface ConsumerKey {
  consumerId: string;
  publicKey: string; // PEM format
}

export interface ShieldKeysResponse {
  keys: ConsumerKey[];
}

// ============================================================================
// Shield Envelope Types (hybrid: AES-256-GCM payload + RSA-OAEP wrapped key)
// ============================================================================

export interface ShieldEnvelope {
  type: 'zekt-shield-envelope';
  iv: string;         // standard base64, 12 bytes
  authTag: string;    // standard base64, 16 bytes
  ciphertext: string; // standard base64, AES-256-GCM of UTF-8 JSON payload
  recipients: Record<string, string>; // consumerId -> base64 RSA-OAEP-SHA256 wrapped AES key
}

// ============================================================================
// Event API Types
// ============================================================================

export interface EventRequest {
  eventType: string;
  repository: string;
  workflowRunId: string;
  triggeredBy: string;
  commitSha: string;
  ref: string;
  workflow: string;
  payload: unknown | ShieldEnvelope; // Can be either
  timestamp: string;
  orchestration_step_ref?: OrchestrationStepRef | null;
}

export interface EventResponse {
  success?: boolean;
  eventId?: string;
  consumersNotified?: number;
  message?: string;
  error?: string;
}

// ============================================================================
// Encryption Internal Types
// ============================================================================
// (Removed - using direct RSA-OAEP, no AES layer)

// ============================================================================
// Orchestration Types
// ============================================================================

export interface OrchestrationStepRef {
  execution_id: string;
  step_id: string;
}

export interface OrchestrationStepRef {
  execution_id: string;
  step_id: string;
}

export interface OrchestrationStep {
  step_id: string;
  service_slug: string;
  service_owner_name?: string;
  requested_by?: string;
  depends_on?: string[];
  input: Record<string, unknown>;
  // spec 162: a step may carry a condition the GitHub runner already evaluated.
  // Strict JSON boolean — validated by Core, not here (see ZA3 / the rule below).
  condition?: boolean;
  // spec 162: display-only text shown with the condition. Never evaluated.
  condition_description?: string;
  // Forwarded verbatim before this release but never declared; declared now so
  // the pass-through is visible in the type rather than only in the cast.
  timeout_minutes?: number;
  input_schema_version?: string;
}

export interface OrchestrationPayload {
  default_service_owner?: string;
  execution_mode?: string;
  strict_output_schema_resolution?: boolean;
  services: OrchestrationStep[];
}

export interface SubmitOrchestrationRequest {
  workflow_run_id: number;
  execution_mode: string;
  default_service_owner?: string;
  strict_output_schema_resolution?: boolean;
  services: OrchestrationStep[];
}

export interface SubmitOrchestrationResponse {
  execution_id: string;
  // Advisory messages from the backend (spec 113/115). Absent when there are none;
  // never fails the run — surfaced as ::warning:: annotations only.
  warnings?: string[];
  // spec 162: 'completed' already at submit when every step was excluded and
  // nothing was dispatched. Otherwise the execution's opening status.
  status?: string;
}

export interface OrchestrationStepStatus {
  step_id: string;
  /**
   * Stored step status. Known values: pending, dispatched, running, completed,
   * failed, skipped, timed_out and — spec 162 — `excluded`, which is terminal
   * and is never a failure (D4). Deliberately `string`: a status Core adds later
   * must not become a compile error here, and must still be reported verbatim.
   */
  status: string;
  outputs?: Record<string, unknown>;
  // spec 162. Present only on a step that was conditioned or excluded; on a
  // cascade-excluded step `condition` is present and null. Treat absent and
  // null alike.
  condition?: boolean | null;
  condition_description?: string | null;
  /**
   * Why the step was excluded. Known values: `condition_false` (its own
   * condition was false) and `dependency_excluded` (cascade, D3). Deliberately
   * `string`, not a union (F1): a reason Core adds later must still log.
   */
  exclusion_reason?: string | null;
  // Step id of the conditioned step at the root of the cascade. Only on
  // `dependency_excluded`.
  excluded_by?: string | null;
}

export interface OrchestrationStatusResponse {
  execution_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timed_out';
  steps: OrchestrationStepStatus[];
  // spec 162: present only when at least one step was excluded.
  excluded_steps?: number;
}
