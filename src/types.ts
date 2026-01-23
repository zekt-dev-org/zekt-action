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

export interface ShieldRecipient {
  consumerId: string;
  encryptedKey: string; // Base64-encoded RSA-encrypted AES key
}

export interface ShieldEnvelope {
  type: 'zekt-shield-envelope';
  version: '1.0';
  encryptedData: string; // Base64: iv + authTag + encryptedPayload
  recipients: ShieldRecipient[];
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

export interface EncryptedPayload {
  encryptedData: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export interface AESKey {
  key: Buffer; // 32 bytes
}
