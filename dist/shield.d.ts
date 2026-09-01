import { ConsumerKey, ShieldEnvelope } from './types';
/**
 * Get consumer public keys from Zekt backend
 */
export declare function getConsumerKeys(apiUrl: string, oidcToken: string, repository: string): Promise<ConsumerKey[]>;
/**
 * Encrypt payload using hybrid encryption:
 *   1. AES-256-GCM encrypts the payload once (no size ceiling).
 *   2. RSA-OAEP-SHA256 wraps the 32-byte AES key for each consumer.
 * Fails fast on any per-consumer wrap failure — partial encryption would
 * leave some consumers unable to decrypt.
 */
export declare function encryptPayload(payload: unknown, consumerKeys: ConsumerKey[]): Promise<ShieldEnvelope>;
