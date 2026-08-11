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
// Shield Envelope Types
// ============================================================================

export interface EncryptedRecipient {
  consumerId: string;
  encryptedPayload: string; // Base64-encoded RSA-OAEP encrypted payload
}

export interface ShieldEnvelope {
  type: 'zekt-shield-envelope';
  recipients: EncryptedRecipient[];
  algorithm: 'RSA-OAEP';
  version: '1.0';
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

export interface OrchestrationStep {
  step_id: string;
  service_slug: string;
  service_owner_name?: string;
  requested_by?: string;
  depends_on?: string[];
  input: Record<string, unknown>;
}

export interface OrchestrationPayload {
  default_service_owner?: string;
  execution_mode?: string;
  services: OrchestrationStep[];
}

export interface SubmitOrchestrationRequest {
  workflow_run_id: number;
  execution_mode: string;
  default_service_owner?: string;
  services: OrchestrationStep[];
}

export interface SubmitOrchestrationResponse {
  execution_id: string;
}

export interface OrchestrationStepStatus {
  step_id: string;
  status: string;
  outputs?: Record<string, unknown>;
}

export interface OrchestrationStatusResponse {
  execution_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timed_out';
  steps: OrchestrationStepStatus[];
}
