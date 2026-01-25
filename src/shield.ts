import * as crypto from 'crypto';
import * as core from '@actions/core';
import { HttpClient } from '@actions/http-client';
import {
  ConsumerKey,
  ShieldKeysRequest,
  ShieldKeysResponse,
  ShieldEnvelope,
  EncryptedRecipient,
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
 * Encrypt payload using direct RSA-OAEP encryption
 * Encrypts the entire payload for each consumer separately
 */
export async function encryptPayload(
  payload: unknown,
  consumerKeys: ConsumerKey[]
): Promise<ShieldEnvelope> {
  if (!consumerKeys || consumerKeys.length === 0) {
    throw new Error('No consumer keys provided for encryption');
  }

  // Serialize payload to JSON
  const payloadJson = JSON.stringify(payload);
  const payloadBuffer = Buffer.from(payloadJson, 'utf-8');
  
  core.info(`🔐 Encrypting payload (${payloadBuffer.length} bytes) for ${consumerKeys.length} consumer(s)`);
  
  const recipients: EncryptedRecipient[] = [];
  const errors: string[] = [];
  
  for (const { consumerId, publicKey } of consumerKeys) {
    try {
      // Validate PEM format
      if (!publicKey.includes('BEGIN PUBLIC KEY') || !publicKey.includes('END PUBLIC KEY')) {
        throw new Error('Invalid PEM format: missing BEGIN/END markers');
      }
      
      // Import RSA public key from PEM
      const publicKeyObject = crypto.createPublicKey({
        key: publicKey,
        format: 'pem',
        type: 'spki'
      });
      
      // Encrypt using RSA-OAEP with SHA-256
      const encryptedBuffer = crypto.publicEncrypt(
        {
          key: publicKeyObject,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256'
        },
        payloadBuffer
      );
      
      // Encode to Base64
      const encryptedPayload = encryptedBuffer.toString('base64');
      
      recipients.push({
        consumerId,
        encryptedPayload
      });
      
      core.info(`   ✅ Encrypted for consumer: ${consumerId} (${encryptedBuffer.length} bytes)`);
      
    } catch (error: any) {
      // Check for payload size error
      if (error.message && error.message.includes('data too large')) {
        const errorMsg = 
          `Payload too large for RSA encryption (${payloadBuffer.length} bytes). ` +
          `Maximum: ~190 bytes (2048-bit key) or ~446 bytes (4096-bit key). ` +
          `Reduce payload size or contact Zekt for hybrid encryption support.`;
        core.error(`   ❌ ${errorMsg}`);
        errors.push(`${consumerId}: ${errorMsg}`);
      } else {
        const errorMsg = `Failed to encrypt for ${consumerId}: ${error.message}`;
        core.error(`   ❌ ${errorMsg}`);
        errors.push(errorMsg);
      }
      
      // Continue to try other consumers even if one fails
      // This allows partial delivery if some keys are invalid
    }
  }
  
  // If ALL encryptions failed, throw error
  if (recipients.length === 0) {
    throw new Error(`All encryption attempts failed:\n${errors.join('\n')}`);
  }
  
  // If SOME encryptions failed, log warning but continue
  if (errors.length > 0) {
    core.warning(`⚠️ Warning: ${errors.length} consumer(s) failed encryption, continuing with ${recipients.length} successful`);
  }
  
  // Build Shield envelope
  const envelope: ShieldEnvelope = {
    type: 'zekt-shield-envelope',
    recipients,
    algorithm: 'RSA-OAEP',
    version: '1.0'
  };
  
  core.info(`✅ Shield envelope created with ${recipients.length} recipient(s)`);
  
  return envelope;
}
