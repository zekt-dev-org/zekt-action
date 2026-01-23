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
export interface ShieldRecipient {
    consumerId: string;
    encryptedKey: string;
}
export interface ShieldEnvelope {
    type: 'zekt-shield-envelope';
    version: '1.0';
    encryptedData: string;
    recipients: ShieldRecipient[];
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
export interface EncryptedPayload {
    encryptedData: Buffer;
    iv: Buffer;
    authTag: Buffer;
}
export interface AESKey {
    key: Buffer;
}
