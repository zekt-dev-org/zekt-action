import * as crypto from 'crypto';
import * as core from '@actions/core';
import NodeRSA from 'node-rsa';
import { HttpClient } from '@actions/http-client';
import {
  ConsumerKey,
  ShieldKeysRequest,
  ShieldKeysResponse,
  ShieldEnvelope,
  ShieldRecipient,
  EncryptedPayload,
  AESKey,
} from './types';

/**
 * Get consumer public keys from Zekt backend
 */
export async function getConsumerKeys(
  apiUrl: string,
  oidcToken: string,
  repository: string
): Promise<ConsumerKey[]> {
  const client = new HttpClient('zekt-action/2.0.2');
  const endpoint = `${apiUrl}/api/shield/keys`;

  const requestBody: ShieldKeysRequest = {
    repository,
  };

  core.debug(`Fetching consumer keys from ${endpoint}`);
  core.debug(`Request body: ${JSON.stringify(requestBody)}`);

  const response = await client.postJson<ShieldKeysResponse>(endpoint, requestBody, {
    'authorization': `Bearer ${oidcToken}`,
    'content-type': 'application/json',
  });

  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    const errorMsg = (response.result as any)?.error || 'Unknown error';
    
    // Provide specific error messages based on status code
    if (response.statusCode === 401 || response.statusCode === 403) {
      throw new Error(
        `Authentication failed (HTTP ${response.statusCode}). ` +
        `Ensure the workflow has 'permissions: id-token: write'`
      );
    } else if (response.statusCode === 404) {
      throw new Error(
        `Repository not enabled for Shield (HTTP 404). ` +
        `Contact Zekt support to enable Shield for this repository.`
      );
    } else {
      throw new Error(`Failed to fetch consumer keys (HTTP ${response.statusCode}): ${errorMsg}`);
    }
  }

  if (!response.result || !response.result.keys) {
    throw new Error('Invalid response from Shield keys API: missing "keys" field');
  }

  return response.result.keys;
}

/**
 * Encrypt payload using hybrid encryption (AES + RSA)
 */
export async function encryptPayload(
  payload: unknown,
  consumerKeys: ConsumerKey[]
): Promise<ShieldEnvelope> {
  // 1. Generate random AES key
  const aesKey = generateAESKey();
  core.debug('Generated AES-256 key');

  // 2. Encrypt payload with AES-256-GCM
  const payloadString = JSON.stringify(payload);
  const encrypted = encryptWithAES(payloadString, aesKey);
  core.debug(`Encrypted payload: ${encrypted.encryptedData.length} bytes`);

  // 3. Combine iv + authTag + encryptedData and encode to Base64
  const combined = Buffer.concat([encrypted.iv, encrypted.authTag, encrypted.encryptedData]);
  const encryptedDataBase64 = combined.toString('base64');

  // 4. Encrypt AES key for each consumer
  const recipients: ShieldRecipient[] = [];

  for (const consumer of consumerKeys) {
    try {
      const encryptedKey = encryptAESKeyWithRSA(aesKey.key, consumer.publicKey);
      recipients.push({
        consumerId: consumer.consumerId,
        encryptedKey,
      });
      core.debug(`Encrypted AES key for consumer ${consumer.consumerId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `Failed to encrypt AES key for consumer ${consumer.consumerId}: ${errorMessage}`
      );
    }
  }

  // 5. Build Shield envelope
  const envelope: ShieldEnvelope = {
    type: 'zekt-shield-envelope',
    version: '1.0',
    encryptedData: encryptedDataBase64,
    recipients,
  };

  core.info(`🛡️ Shield envelope created: ${recipients.length} recipients`);
  return envelope;
}

/**
 * Generate random AES-256 key
 */
function generateAESKey(): AESKey {
  return {
    key: crypto.randomBytes(32), // 256 bits
  };
}

/**
 * Encrypt data with AES-256-GCM
 */
function encryptWithAES(plaintext: string, aesKey: AESKey): EncryptedPayload {
  const iv = crypto.randomBytes(16); // 128 bits
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey.key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  const authTag = cipher.getAuthTag();

  return {
    encryptedData: encrypted,
    iv,
    authTag,
  };
}

/**
 * Encrypt AES key with RSA-OAEP
 */
function encryptAESKeyWithRSA(aesKey: Buffer, publicKeyPEM: string): string {
  try {
    const key = new NodeRSA();
    key.importKey(publicKeyPEM, 'pkcs8-public-pem');
    key.setOptions({ encryptionScheme: 'pkcs1_oaep' });

    return key.encrypt(aesKey, 'base64');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`RSA encryption failed: ${errorMessage}`);
  }
}
