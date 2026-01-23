"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConsumerKeys = getConsumerKeys;
exports.encryptPayload = encryptPayload;
const crypto = __importStar(require("crypto"));
const core = __importStar(require("@actions/core"));
const node_rsa_1 = __importDefault(require("node-rsa"));
const http_client_1 = require("@actions/http-client");
/**
 * Get consumer public keys from Zekt backend
 */
async function getConsumerKeys(apiUrl, oidcToken, repository) {
    const client = new http_client_1.HttpClient('zekt-action/2.0.2');
    const endpoint = `${apiUrl}/api/shield/keys`;
    const requestBody = {
        repository,
    };
    core.debug(`Fetching consumer keys from ${endpoint}`);
    core.debug(`Request body: ${JSON.stringify(requestBody)}`);
    const response = await client.postJson(endpoint, requestBody, {
        'authorization': `Bearer ${oidcToken}`,
        'content-type': 'application/json',
    });
    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        const errorMsg = response.result?.error || 'Unknown error';
        // Provide specific error messages based on status code
        if (response.statusCode === 401 || response.statusCode === 403) {
            throw new Error(`Authentication failed (HTTP ${response.statusCode}). ` +
                `Ensure the workflow has 'permissions: id-token: write'`);
        }
        else if (response.statusCode === 404) {
            throw new Error(`Repository not enabled for Shield (HTTP 404). ` +
                `Contact Zekt support to enable Shield for this repository.`);
        }
        else {
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
async function encryptPayload(payload, consumerKeys) {
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
    const recipients = [];
    for (const consumer of consumerKeys) {
        try {
            const encryptedKey = encryptAESKeyWithRSA(aesKey.key, consumer.publicKey);
            recipients.push({
                consumerId: consumer.consumerId,
                encryptedKey,
            });
            core.debug(`Encrypted AES key for consumer ${consumer.consumerId}`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to encrypt AES key for consumer ${consumer.consumerId}: ${errorMessage}`);
        }
    }
    // 5. Build Shield envelope
    const envelope = {
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
function generateAESKey() {
    return {
        key: crypto.randomBytes(32), // 256 bits
    };
}
/**
 * Encrypt data with AES-256-GCM
 */
function encryptWithAES(plaintext, aesKey) {
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
function encryptAESKeyWithRSA(aesKey, publicKeyPEM) {
    try {
        const key = new node_rsa_1.default();
        key.importKey(publicKeyPEM, 'pkcs8-public-pem');
        key.setOptions({ encryptionScheme: 'pkcs1_oaep' });
        return key.encrypt(aesKey, 'base64');
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`RSA encryption failed: ${errorMessage}`);
    }
}
//# sourceMappingURL=shield.js.map