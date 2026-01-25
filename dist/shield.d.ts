import { ConsumerKey, ShieldEnvelope } from './types';
/**
 * Get consumer public keys from Zekt backend
 */
export declare function getConsumerKeys(apiUrl: string, oidcToken: string, repository: string): Promise<ConsumerKey[]>;
/**
 * Encrypt payload using direct RSA-OAEP encryption
 * Encrypts the entire payload for each consumer separately
 */
export declare function encryptPayload(payload: unknown, consumerKeys: ConsumerKey[]): Promise<ShieldEnvelope>;
