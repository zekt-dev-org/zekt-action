import * as crypto from 'crypto';
import * as core from '@actions/core';
import { HttpClient } from '@actions/http-client';
import {
  ConsumerKey,
  ShieldKeysRequest,
  ShieldKeysResponse,
  ShieldEnvelope,
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
 * Encrypt payload using hybrid encryption:
 *   1. AES-256-GCM encrypts the payload once (no size ceiling).
 *   2. RSA-OAEP-SHA256 wraps the 32-byte AES key for each consumer.
 * Fails fast on any per-consumer wrap failure — partial encryption would
 * leave some consumers unable to decrypt.
 */
export async function encryptPayload(
  payload: unknown,
  consumerKeys: ConsumerKey[]
): Promise<ShieldEnvelope> {
  if (!consumerKeys || consumerKeys.length === 0) {
    throw new Error('No consumer keys provided for encryption');
  }

  const payloadJson = JSON.stringify(payload);
  const payloadBuffer = Buffer.from(payloadJson, 'utf-8');

  core.info(`🔐 Encrypting payload (${payloadBuffer.length} bytes) for ${consumerKeys.length} consumer(s)`);

  // 1. Ephemeral AES-256 key + 12-byte IV
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  // 2. AES-256-GCM encrypt the payload once
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(payloadBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // 3. RSA-OAEP-SHA256 wrap the AES key per consumer
  const recipients: Record<string, string> = {};
  for (const { consumerId, publicKey } of consumerKeys) {
    if (!publicKey.includes('BEGIN PUBLIC KEY') || !publicKey.includes('END PUBLIC KEY')) {
      throw new Error(`Failed to encrypt for ${consumerId}: invalid PEM format (missing BEGIN/END markers)`);
    }
    try {
      const wrapped = crypto.publicEncrypt(
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        aesKey
      );
      recipients[consumerId] = wrapped.toString('base64');
      core.info(`   ✅ Wrapped AES key for consumer: ${consumerId}`);
    } catch (error: any) {
      throw new Error(`Failed to encrypt for ${consumerId}: ${error.message}`);
    }
  }

  const envelope: ShieldEnvelope = {
    type: 'zekt-shield-envelope',
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    recipients,
  };

  core.info(`✅ Shield envelope created with ${Object.keys(recipients).length} recipient(s)`);

  return envelope;
}
