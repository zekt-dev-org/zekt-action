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

  core.info(`🔍 Shield Keys Request:`);
  core.info(`  Endpoint: ${endpoint}`);
  core.info(`  Repository: ${repository}`);
  core.info(`  Token length: ${oidcToken.length} chars`);
  core.info(`  Token prefix: ${oidcToken.substring(0, 20)}...`);
  core.debug(`Request body: ${JSON.stringify(requestBody)}`);

  // Use post() instead of postJson() to get raw response
  const rawResponse = await client.post(endpoint, JSON.stringify(requestBody), {
    'authorization': `Bearer ${oidcToken}`,
    'content-type': 'application/json',
  });

  const statusCode = rawResponse.message.statusCode || 0;
  core.info(`📥 Shield Keys Response: HTTP ${statusCode}`);

  const responseBody = await rawResponse.readBody();
  core.debug(`Response body: ${responseBody.substring(0, 500)}`);

  if (statusCode < 200 || statusCode >= 300) {
    core.error(`Error Response Body: ${responseBody}`);
    
    if (statusCode === 401 || statusCode === 403) {
      throw new Error(
        `Authentication failed (HTTP ${statusCode}). ` +
        `Ensure the workflow has 'permissions: id-token: write'.`
      );
    } else if (statusCode === 404) {
      throw new Error(
        `Repository not enabled for Shield (HTTP 404). ` +
        `Contact Zekt support to enable Shield for this repository.`
      );
    } else {
      throw new Error(`Failed to fetch consumer keys (HTTP ${statusCode}): ${responseBody.substring(0, 200)}`);
    }
  }

  let response: ShieldKeysResponse;
  try {
    response = JSON.parse(responseBody);
  } catch (error: any) {
    throw new Error(`Invalid JSON response from Shield API: ${error.message}`);
  }

  if (!response.keys) {
    throw new Error('Invalid response from Shield keys API: missing "keys" field');
  }

  return response.keys;
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
