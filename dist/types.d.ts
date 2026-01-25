export interface ActionInputs {
    eventType: string;
    payload: string;
    zektApiUrl: string;
    shield: boolean;
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
export interface EncryptedRecipient {
    consumerId: string;
    encryptedPayload: string;
}
export interface ShieldEnvelope {
    type: 'zekt-shield-envelope';
    recipients: EncryptedRecipient[];
    algorithm: 'RSA-OAEP';
    version: '1.0';
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
}
export interface EventResponse {
    success?: boolean;
    eventId?: string;
    consumersNotified?: number;
    message?: string;
    error?: string;
}
