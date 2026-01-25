// ============================================================================
// Action Inputs
// ============================================================================

export interface ActionInputs {
  eventType: string;
  payload: string;
  zektApiUrl: string;
  shield: boolean;
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
