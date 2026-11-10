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
export interface ShieldKeysRequest {
    repository: string;
}
export interface ConsumerKey {
    consumerId: string;
    publicKey: string;
}
export interface ShieldKeysResponse {
    keys: ConsumerKey[];
}
export interface ShieldEnvelope {
    type: 'zekt-shield-envelope';
    iv: string;
    authTag: string;
    ciphertext: string;
    recipients: Record<string, string>;
}
export interface EventRequest {
    eventType: string;
    repository: string;
    workflowRunId: string;
    triggeredBy: string;
    commitSha: string;
    ref: string;
    workflow: string;
    payload: unknown | ShieldEnvelope;
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
    condition?: boolean;
    condition_description?: string;
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
    warnings?: string[];
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
    condition?: boolean | null;
    condition_description?: string | null;
    /**
     * Why the step was excluded. Known values: `condition_false` (its own
     * condition was false) and `dependency_excluded` (cascade, D3). Deliberately
     * `string`, not a union (F1): a reason Core adds later must still log.
     */
    exclusion_reason?: string | null;
    excluded_by?: string | null;
}
export interface OrchestrationStatusResponse {
    execution_id: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'timed_out';
    steps: OrchestrationStepStatus[];
    excluded_steps?: number;
}
