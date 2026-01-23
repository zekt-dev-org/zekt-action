import { ConsumerKey, ShieldEnvelope } from './types';
/**
 * Get consumer public keys from Zekt backend
 */
export declare function getConsumerKeys(apiUrl: string, oidcToken: string, repository: string, workflowPath: string): Promise<ConsumerKey[]>;
/**
 * Encrypt payload using hybrid encryption (AES + RSA)
 */
export declare function encryptPayload(payload: unknown, consumerKeys: ConsumerKey[]): Promise<ShieldEnvelope>;
