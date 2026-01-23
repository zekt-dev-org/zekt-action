# Zekt Action Shield Implementation Specification

**Version:** 2.0.2  
**Date:** January 23, 2026  
**Status:** Planning Phase

---

## Overview

This document specifies the implementation of **Shield** - an end-to-end payload encryption feature for the Zekt Action. When enabled, Shield encrypts event payloads using hybrid encryption (AES-256-GCM + RSA-OAEP) so only authorized consumer repositories can decrypt them.

### Key Objectives

1. ✅ Add optional `shield` input parameter (boolean)
2. ✅ Migrate from bash composite action to Node.js/TypeScript action
3. ✅ Implement hybrid encryption (AES + RSA)
4. ✅ Maintain 100% backward compatibility when `shield` is not used
5. ✅ Fail explicitly on Shield errors (never fall back to plaintext)

---

## Architecture Change

### Current (v2.0.1)
```
Action Type: Composite (bash)
Runtime: Bash scripts
Dependencies: curl, jq, openssl (for OIDC only)
```

### Target (v2.0.2)
```
Action Type: JavaScript/TypeScript
Runtime: Node.js 20
Dependencies: @actions/core, @actions/http-client, crypto, node-rsa
```

**Rationale:**
- Better crypto library support (native `crypto` module + `node-rsa`)
- Reliable JSON/Base64 handling
- Easier error handling and testing
- Simpler OIDC token management (`core.getIDToken()`)
- Better maintainability

---

## New Input Parameter

### action.yml Changes

```yaml
inputs:
  event-type:
    description: 'The type of event to send (e.g., deployment, release, build-complete)'
    required: true
  payload:
    description: 'JSON payload to send with the event'
    required: false
    default: '{}'
  zekt-api-url:
    description: 'Zekt API URL (optional - defaults to production)'
    required: false
    default: 'https://fxdevzektapp.azurewebsites.net'
  shield:                                    # ⬅️ NEW
    description: 'Enable end-to-end encryption of payload (requires consumers with Shield enabled)'
    required: false
    default: 'false'
```

### Usage Examples

**Without Shield (current behavior):**
```yaml
- uses: zekt-dev-org/zekt-action@v2.0.2
  with:
    event-type: 'deployment'
    payload: '{"version": "1.0.0"}'
```

**With Shield (encrypted):**
```yaml
- uses: zekt-dev-org/zekt-action@v2.0.2
  with:
    event-type: 'deployment'
    payload: '{"version": "1.0.0"}'
    shield: true
```

---

## Shield Encryption Flow

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Provider Workflow (shield: true)                                │
│    - event-type: 'deployment'                                       │
│    - payload: {"version": "1.0.0"}                                  │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Zekt Action - Get Consumer Keys                                 │
│    POST /api/shield/keys                                            │
│    Body: {                                                          │
│      "repository": "owner/repo",                                    │
│      "workflowPath": ".github/workflows/deploy.yml"                 │
│    }                                                                │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Zekt Backend Returns Consumer Public Keys                       │
│    {                                                                │
│      "keys": [                                                      │
│        {                                                            │
│          "consumerId": "107622248",                                 │
│          "publicKey": "-----BEGIN PUBLIC KEY-----\n..."             │
│        },                                                           │
│        // ... up to 100 consumers                                   │
│      ]                                                              │
│    }                                                                │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Zekt Action - Hybrid Encryption                                 │
│                                                                     │
│    a) Generate random AES-256-GCM key (32 bytes)                   │
│    b) Encrypt payload ONCE with AES key                            │
│       - Algorithm: AES-256-GCM                                      │
│       - Output: encryptedData + iv + authTag                       │
│                                                                     │
│    c) For EACH consumer:                                           │
│       - Encrypt AES key with consumer's RSA public key             │
│       - Algorithm: RSA-OAEP with SHA-256                           │
│       - Output: encryptedKey (per consumer)                        │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. Build Shield Envelope (replaces original payload)               │
│    {                                                                │
│      "type": "zekt-shield-envelope",                                │
│      "version": "1.0",                                              │
│      "encryptedData": "base64-encoded-encrypted-payload",           │
│      "recipients": [                                                │
│        {                                                            │
│          "consumerId": "107622248",                                 │
│          "encryptedKey": "base64-rsa-encrypted-aes-key"             │
│        },                                                           │
│        // ... N consumers                                           │
│      ]                                                              │
│    }                                                                │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. Send to Zekt Backend                                            │
│    POST /api/events/receive                                         │
│    Body: {                                                          │
│      "eventType": "deployment",                                     │
│      "repository": "owner/repo",                                    │
│      "payload": { /* shield envelope */ },  ⬅️ ENTIRE ENVELOPE      │
│      ...                                                            │
│    }                                                                │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 7. Zekt Backend Detects Shield                                     │
│    - Checks: payload.type === "zekt-shield-envelope"               │
│    - Routes encrypted envelope to consumers                         │
│    - Consumers decrypt with their private keys                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## API Contracts

### 1. Get Consumer Public Keys

**Endpoint:** `POST /api/shield/keys`

**Headers:**
```http
Authorization: Bearer {OIDC_TOKEN}
Content-Type: application/json
```

**Request Body:**
```json
{
  "repository": "owner/repo",
  "workflowPath": ".github/workflows/deploy.yml"
}
```

**Success Response (200):**
```json
{
  "keys": [
    {
      "consumerId": "107622248",
      "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----"
    },
    {
      "consumerId": "107622249",
      "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq..."
    }
  ]
}
```

**Error Responses:**

| Status | Response | Meaning | Action |
|--------|----------|---------|--------|
| 401 | `{"error": "Unauthorized"}` | Invalid OIDC token | FAIL - Check permissions |
| 403 | `{"error": "Repository not enabled for Shield"}` | Repo not onboarded | FAIL - Enable Shield |
| 404 | `{"error": "No consumers found"}` | No active consumers | FAIL - No recipients |
| 500 | `{"error": "Internal server error"}` | Server error | FAIL - Retry later |

### 2. Send Event (Same as v2.0.1)

**Endpoint:** `POST /api/events/receive`

**Headers:**
```http
Authorization: Bearer {OIDC_TOKEN}
Content-Type: application/json
X-GitHub-Repository: owner/repo
```

**Request Body (WITHOUT Shield):**
```json
{
  "eventType": "deployment",
  "repository": "owner/repo",
  "workflowRunId": "123456789",
  "triggeredBy": "username",
  "commitSha": "abc123...",
  "ref": "refs/heads/main",
  "workflow": "deploy.yml",
  "payload": {
    "version": "1.0.0",
    "environment": "production"
  },
  "timestamp": "2026-01-23T10:30:00Z"
}
```

**Request Body (WITH Shield):**
```json
{
  "eventType": "deployment",
  "repository": "owner/repo",
  "workflowRunId": "123456789",
  "triggeredBy": "username",
  "commitSha": "abc123...",
  "ref": "refs/heads/main",
  "workflow": "deploy.yml",
  "payload": {
    "type": "zekt-shield-envelope",
    "version": "1.0",
    "encryptedData": "base64-encrypted-payload...",
    "recipients": [
      {
        "consumerId": "107622248",
        "encryptedKey": "base64-rsa-encrypted-key..."
      }
    ]
  },
  "timestamp": "2026-01-23T10:30:00Z"
}
```

---

## Encryption Implementation Details

### Hybrid Encryption Algorithm

```
Original Payload → [AES-256-GCM] → Encrypted Payload
                                           ↓
                                    (encrypted ONCE)
                                           ↓
                                      Base64 Encode
                                           ↓
                                   "encryptedData" field

AES Key (32 bytes) → [RSA-OAEP + SHA-256 + Consumer PubKey #1] → Encrypted Key #1
                  → [RSA-OAEP + SHA-256 + Consumer PubKey #2] → Encrypted Key #2
                  → [RSA-OAEP + SHA-256 + Consumer PubKey #N] → Encrypted Key #N
                                                                        ↓
                                                                  Base64 Encode
                                                                        ↓
                                                              "recipients[].encryptedKey"
```

### AES-256-GCM Encryption (Payload)

**Input:**
- Plaintext: `JSON.stringify(payload)`
- Key: 32 random bytes (generated via `crypto.randomBytes(32)`)
- IV: 16 random bytes (generated via `crypto.randomBytes(16)`)

**Algorithm:**
- Cipher: `aes-256-gcm`
- Node.js: `crypto.createCipheriv('aes-256-gcm', key, iv)`

**Output:**
```typescript
{
  encryptedData: Buffer,  // Encrypted payload
  iv: Buffer,             // Initialization vector (16 bytes)
  authTag: Buffer         // Authentication tag (16 bytes)
}
```

**Serialization:**
```typescript
// Combine: iv + authTag + encryptedData
const combined = Buffer.concat([iv, authTag, encryptedData]);
const base64 = combined.toString('base64');
```

### RSA-OAEP Encryption (AES Key)

**Input:**
- Plaintext: 32-byte AES key
- Public Key: Consumer's RSA public key (PEM format)

**Algorithm:**
- Padding: OAEP with SHA-256
- Node.js Library: `node-rsa`

**Configuration:**
```typescript
const NodeRSA = require('node-rsa');
const key = new NodeRSA();
key.importKey(publicKeyPEM, 'pkcs8-public-pem');
key.setOptions({ encryptionScheme: 'pkcs1_oaep' });

const encryptedKey = key.encrypt(aesKey, 'base64');
```

**Output:**
```typescript
{
  consumerId: string,
  encryptedKey: string  // Base64-encoded RSA-encrypted AES key
}
```

---

## File Structure (Post-Migration)

```
zekt-action/
├── .github/
│   └── workflows/
│       ├── build.yml              # Build & test on PR
│       ├── release.yml            # Publish on tag
│       └── test-integration.yml   # Integration tests
│
├── src/
│   ├── index.ts                   # Entry point
│   ├── main.ts                    # Core logic (OIDC + send event)
│   ├── shield.ts                  # Shield encryption logic
│   ├── api-client.ts              # HTTP client (shield keys + events)
│   ├── types.ts                   # TypeScript interfaces
│   └── utils.ts                   # Helpers (context extraction, etc.)
│
├── dist/
│   └── index.js                   # Compiled bundle (via @vercel/ncc)
│
├── __tests__/
│   ├── shield.test.ts             # Shield encryption tests
│   ├── api-client.test.ts         # API client tests
│   └── main.test.ts               # Integration tests
│
├── docs/
│   ├── SHIELD_IMPLEMENTATION_SPEC.md  # This document
│   └── ZEKT_ACTION_OIDC_IMPLEMENTATION.md
│
├── action.yml                     # Updated with 'shield' input
├── package.json                   # Dependencies
├── tsconfig.json                  # TypeScript config
├── jest.config.js                 # Test config
├── .gitignore
├── README.md                      # Updated documentation
├── CHANGELOG.md                   # Version history
└── LICENSE
```

---

## Dependencies (package.json)

```json
{
  "name": "zekt-action",
  "version": "2.0.2",
  "description": "GitHub Action for sending events to Zekt with optional Shield encryption",
  "main": "dist/index.js",
  "scripts": {
    "build": "ncc build src/index.ts -o dist --source-map --license licenses.txt",
    "test": "jest",
    "lint": "eslint src/**/*.ts",
    "format": "prettier --write src/**/*.ts"
  },
  "dependencies": {
    "@actions/core": "^1.10.1",
    "@actions/github": "^6.0.0",
    "@actions/http-client": "^2.2.0",
    "node-rsa": "^1.1.1"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@vercel/ncc": "^0.38.1",
    "typescript": "^5.3.3",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.11",
    "ts-jest": "^29.1.1",
    "prettier": "^3.1.1",
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.15.0",
    "@typescript-eslint/parser": "^6.15.0"
  }
}
```

**Key Dependencies:**
- `@actions/core` - GitHub Actions SDK (inputs, outputs, logging)
- `@actions/http-client` - HTTP client for API calls
- `node-rsa` - RSA encryption/decryption
- Built-in `crypto` module - AES-256-GCM encryption

---

## TypeScript Type Definitions

### types.ts

```typescript
// ============================================================================
// Action Inputs
// ============================================================================

export interface ActionInputs {
  eventType: string;
  payload: string;
  zektApiUrl: string;
  shield: boolean;
}

// ============================================================================
// Shield API Types
// ============================================================================

export interface ShieldKeysRequest {
  repository: string;
  workflowPath: string;
}

export interface ConsumerKey {
  consumerId: string;
  publicKey: string;  // PEM format
}

export interface ShieldKeysResponse {
  keys: ConsumerKey[];
}

// ============================================================================
// Shield Envelope Types
// ============================================================================

export interface ShieldRecipient {
  consumerId: string;
  encryptedKey: string;  // Base64-encoded RSA-encrypted AES key
}

export interface ShieldEnvelope {
  type: 'zekt-shield-envelope';
  version: '1.0';
  encryptedData: string;  // Base64: iv + authTag + encryptedPayload
  recipients: ShieldRecipient[];
}

// ============================================================================
// Event API Types
// ============================================================================

export interface EventRequest {
  eventType: string;
  repository: string;
  workflowRunId: string;
  triggeredBy: string;
  commitSha: string;
  ref: string;
  workflow: string;
  payload: unknown | ShieldEnvelope;  // Can be either
  timestamp: string;
}

export interface EventResponse {
  success: boolean;
  eventId?: string;
  consumersNotified?: number;
  message?: string;
  error?: string;
}

// ============================================================================
// Encryption Internal Types
// ============================================================================

export interface EncryptedPayload {
  encryptedData: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export interface AESKey {
  key: Buffer;  // 32 bytes
}
```

---

## Implementation Modules

### 1. src/index.ts (Entry Point)

```typescript
import * as core from '@actions/core';
import { run } from './main';

// Entry point - catches all errors
run().catch((error) => {
  core.setFailed(error.message);
  process.exit(1);
});
```

### 2. src/main.ts (Core Logic)

```typescript
import * as core from '@actions/core';
import * as github from '@actions/github';
import { getActionInputs, extractWorkflowPath } from './utils';
import { getConsumerKeys, encryptPayload } from './shield';
import { sendEvent } from './api-client';
import { ActionInputs, EventRequest, ShieldEnvelope } from './types';

export async function run(): Promise<void> {
  try {
    // 1. Get inputs
    const inputs = getActionInputs();
    core.info(`Event Type: ${inputs.eventType}`);
    core.info(`Shield: ${inputs.shield}`);

    // 2. Get OIDC token
    const oidcToken = await core.getIDToken('api://zekt');
    core.setSecret(oidcToken);
    core.info('✅ OIDC token obtained');

    // 3. Parse payload
    let payloadObject: unknown;
    try {
      payloadObject = JSON.parse(inputs.payload);
    } catch (error) {
      throw new Error(`Invalid JSON payload: ${error.message}`);
    }

    // 4. Shield encryption (if enabled)
    let finalPayload: unknown | ShieldEnvelope = payloadObject;
    
    if (inputs.shield) {
      core.info('🛡️ Shield encryption enabled');
      
      // Get workflow path
      const workflowPath = extractWorkflowPath(github.context);
      
      // Get consumer keys
      const consumerKeys = await getConsumerKeys(
        inputs.zektApiUrl,
        oidcToken,
        github.context.repo.owner + '/' + github.context.repo.repo,
        workflowPath
      );
      
      core.info(`📋 Retrieved ${consumerKeys.length} consumer keys`);
      
      if (consumerKeys.length === 0) {
        throw new Error(
          'Shield encryption failed: No consumers found. ' +
          'Ensure at least one consumer is subscribed to this provider.'
        );
      }
      
      // Encrypt payload
      finalPayload = await encryptPayload(payloadObject, consumerKeys);
      core.info('✅ Payload encrypted successfully');
    }

    // 5. Build event request
    const eventRequest: EventRequest = {
      eventType: inputs.eventType,
      repository: github.context.repo.owner + '/' + github.context.repo.repo,
      workflowRunId: github.context.runId.toString(),
      triggeredBy: github.context.actor,
      commitSha: github.context.sha,
      ref: github.context.ref,
      workflow: github.context.workflow,
      payload: finalPayload,
      timestamp: new Date().toISOString()
    };

    // 6. Send to Zekt
    const response = await sendEvent(
      inputs.zektApiUrl,
      oidcToken,
      eventRequest
    );

    // 7. Set outputs
    core.setOutput('event-id', response.eventId || '');
    core.setOutput('status', response.success ? 'success' : 'failed');
    core.setOutput('consumers-notified', response.consumersNotified || 0);

    // 8. Write job summary
    await writeJobSummary(inputs, response, inputs.shield);

    core.info('✅ Event sent successfully');
  } catch (error) {
    core.error(`❌ Failed: ${error.message}`);
    throw error;
  }
}

async function writeJobSummary(
  inputs: ActionInputs,
  response: any,
  shieldEnabled: boolean
): Promise<void> {
  await core.summary
    .addHeading('Zekt Event Delivery')
    .addTable([
      [
        { data: 'Property', header: true },
        { data: 'Value', header: true }
      ],
      ['Event Type', inputs.eventType],
      ['Repository', github.context.repo.owner + '/' + github.context.repo.repo],
      ['Workflow', github.context.workflow],
      ['Run ID', github.context.runId.toString()],
      ['Shield', shieldEnabled ? '🛡️ Enabled' : 'Disabled'],
      ['Status', response.success ? '✅ Success' : '❌ Failed'],
      ['Event ID', response.eventId || 'N/A'],
      ['Consumers Notified', (response.consumersNotified || 0).toString()]
    ])
    .addRaw('<hr>')
    .addRaw('_Sent via [Zekt Action](https://github.com/zekt-dev-org/zekt-action)_')
    .write();
}
```

### 3. src/shield.ts (Encryption Logic)

```typescript
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
  AESKey
} from './types';

/**
 * Get consumer public keys from Zekt backend
 */
export async function getConsumerKeys(
  apiUrl: string,
  oidcToken: string,
  repository: string,
  workflowPath: string
): Promise<ConsumerKey[]> {
  const client = new HttpClient('zekt-action/2.0.2');
  const endpoint = `${apiUrl}/api/shield/keys`;

  const requestBody: ShieldKeysRequest = {
    repository,
    workflowPath
  };

  core.debug(`Fetching consumer keys from ${endpoint}`);
  core.debug(`Request body: ${JSON.stringify(requestBody)}`);

  const response = await client.postJson<ShieldKeysResponse>(
    endpoint,
    requestBody,
    {
      Authorization: `Bearer ${oidcToken}`,
      'Content-Type': 'application/json'
    }
  );

  if (response.statusCode !== 200) {
    const errorMsg = response.result?.error || 'Unknown error';
    throw new Error(
      `Failed to fetch consumer keys (HTTP ${response.statusCode}): ${errorMsg}`
    );
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
  const combined = Buffer.concat([
    encrypted.iv,
    encrypted.authTag,
    encrypted.encryptedData
  ]);
  const encryptedDataBase64 = combined.toString('base64');

  // 4. Encrypt AES key for each consumer
  const recipients: ShieldRecipient[] = [];
  
  for (const consumer of consumerKeys) {
    try {
      const encryptedKey = encryptAESKeyWithRSA(aesKey.key, consumer.publicKey);
      recipients.push({
        consumerId: consumer.consumerId,
        encryptedKey
      });
      core.debug(`Encrypted AES key for consumer ${consumer.consumerId}`);
    } catch (error) {
      throw new Error(
        `Failed to encrypt AES key for consumer ${consumer.consumerId}: ${error.message}`
      );
    }
  }

  // 5. Build Shield envelope
  const envelope: ShieldEnvelope = {
    type: 'zekt-shield-envelope',
    version: '1.0',
    encryptedData: encryptedDataBase64,
    recipients
  };

  core.info(`🛡️ Shield envelope created: ${recipients.length} recipients`);
  return envelope;
}

/**
 * Generate random AES-256 key
 */
function generateAESKey(): AESKey {
  return {
    key: crypto.randomBytes(32)  // 256 bits
  };
}

/**
 * Encrypt data with AES-256-GCM
 */
function encryptWithAES(plaintext: string, aesKey: AESKey): EncryptedPayload {
  const iv = crypto.randomBytes(16);  // 128 bits
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey.key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return {
    encryptedData: encrypted,
    iv,
    authTag
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
    throw new Error(`RSA encryption failed: ${error.message}`);
  }
}
```

### 4. src/api-client.ts (HTTP Client)

```typescript
import { HttpClient } from '@actions/http-client';
import { EventRequest, EventResponse } from './types';

/**
 * Send event to Zekt backend
 */
export async function sendEvent(
  apiUrl: string,
  oidcToken: string,
  eventRequest: EventRequest
): Promise<EventResponse> {
  const client = new HttpClient('zekt-action/2.0.2');
  const endpoint = `${apiUrl}/api/events/receive`;

  const response = await client.postJson<EventResponse>(
    endpoint,
    eventRequest,
    {
      Authorization: `Bearer ${oidcToken}`,
      'Content-Type': 'application/json',
      'X-GitHub-Repository': eventRequest.repository
    }
  );

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const errorMsg = response.result?.error || 'Unknown error';
    throw new Error(
      `Failed to send event (HTTP ${response.statusCode}): ${errorMsg}`
    );
  }

  if (!response.result) {
    throw new Error('Invalid response from Zekt API: empty response');
  }

  return response.result;
}
```

### 5. src/utils.ts (Helpers)

```typescript
import * as core from '@actions/core';
import { Context } from '@actions/github/lib/context';
import { ActionInputs } from './types';

/**
 * Get and validate action inputs
 */
export function getActionInputs(): ActionInputs {
  const eventType = core.getInput('event-type', { required: true });
  const payload = core.getInput('payload', { required: false }) || '{}';
  const zektApiUrl = core.getInput('zekt-api-url', { required: false }) || 
    'https://fxdevzektapp.azurewebsites.net';
  const shieldInput = core.getInput('shield', { required: false });
  
  // Parse boolean (handles 'true', 'false', '', etc.)
  const shield = shieldInput === 'true';

  return {
    eventType,
    payload,
    zektApiUrl,
    shield
  };
}

/**
 * Extract workflow path from GitHub context
 * Example: "owner/repo/.github/workflows/deploy.yml@refs/heads/main"
 * Returns: ".github/workflows/deploy.yml"
 */
export function extractWorkflowPath(context: Context): string {
  const workflowRef = context.workflow_ref || '';
  
  // Format: owner/repo/.github/workflows/file.yml@ref
  const match = workflowRef.match(/\.github\/workflows\/[^@]+/);
  
  if (match) {
    return match[0];
  }
  
  // Fallback: use workflow name
  core.warning(
    `Could not extract workflow path from workflow_ref: ${workflowRef}. ` +
    `Using workflow name instead.`
  );
  
  return `.github/workflows/${context.workflow}.yml`;
}
```

---

## Error Handling Strategy

### Error Decision Tree

```
shield: true
│
├─ Validate inputs
│  ├─ event-type empty → FAIL ("event-type is required")
│  └─ payload invalid JSON → FAIL ("Invalid JSON payload")
│
├─ Get OIDC token
│  └─ Token request fails → FAIL ("OIDC token not available")
│
├─ Fetch consumer keys (POST /api/shield/keys)
│  ├─ 401/403 → FAIL ("Authentication failed - check permissions")
│  ├─ 404 → FAIL ("Repository not enabled for Shield")
│  ├─ 500+ → FAIL ("Zekt API unavailable")
│  └─ 0 keys → FAIL ("No consumers found - cannot encrypt")
│
├─ Encrypt payload
│  ├─ AES encryption fails → FAIL ("AES encryption failed")
│  ├─ Invalid RSA key → FAIL ("Consumer public key invalid")
│  └─ RSA encryption fails → FAIL ("RSA encryption failed for consumer X")
│
└─ Send event (POST /api/events/receive)
   ├─ 400 → FAIL ("Invalid event data")
   ├─ 401/403 → FAIL ("Authentication failed")
   ├─ 500+ → FAIL ("Zekt API unavailable")
   └─ 200/202 → SUCCESS
```

### Error Messages

| Error Scenario | User-Facing Message | Suggested Action |
|----------------|---------------------|------------------|
| OIDC token unavailable | `OIDC token not available. Ensure the workflow has 'permissions: id-token: write'` | Add `permissions: id-token: write` |
| Shield keys API 403 | `Repository not enabled for Shield. Contact Zekt support.` | Enable Shield in Zekt platform |
| 0 consumers returned | `Shield encryption failed: No consumers found. Ensure at least one consumer is subscribed.` | Add consumer subscriptions |
| Invalid consumer key | `Consumer public key invalid (consumer ID: 12345). Contact Zekt support.` | Report to Zekt team |
| AES encryption fails | `Payload encryption failed: [error]. This is an internal error.` | Report issue |
| Event send fails (400) | `Failed to send event: Invalid event data. Check payload structure.` | Validate payload |

### Fail-Safe Principles

1. ✅ **Never fall back to plaintext** when `shield: true`
2. ✅ **Fail early** - validate inputs before expensive operations
3. ✅ **Clear error messages** - tell users exactly what to fix
4. ✅ **Mask sensitive data** - OIDC tokens, encryption keys
5. ✅ **Log diagnostics** - use `core.debug()` for troubleshooting

---

## Testing Strategy

### Unit Tests

**File:** `__tests__/shield.test.ts`

```typescript
describe('Shield Encryption', () => {
  test('generateAESKey creates 32-byte key', () => {
    // Test AES key generation
  });

  test('encryptWithAES produces valid ciphertext', () => {
    // Test AES encryption
  });

  test('encryptAESKeyWithRSA encrypts with valid RSA key', () => {
    // Test RSA encryption
  });

  test('encryptPayload creates valid Shield envelope', async () => {
    // Test full encryption flow
  });

  test('throws error when consumer key is invalid', async () => {
    // Test error handling
  });
});
```

**File:** `__tests__/api-client.test.ts`

```typescript
describe('API Client', () => {
  test('getConsumerKeys returns keys on success', async () => {
    // Mock successful API response
  });

  test('getConsumerKeys throws on 404', async () => {
    // Mock 404 response
  });

  test('sendEvent sends correct request body', async () => {
    // Verify request structure
  });
});
```

### Integration Tests

**File:** `.github/workflows/test-integration.yml`

```yaml
name: Integration Tests

on: [push, pull_request]

jobs:
  test-without-shield:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      
      - name: Test without Shield
        uses: ./
        with:
          event-type: 'test-event'
          payload: '{"test": true}'
          zekt-api-url: 'https://staging.zekt.dev'

  test-with-shield:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      
      - name: Test with Shield
        uses: ./
        with:
          event-type: 'test-event'
          payload: '{"test": true}'
          shield: true
          zekt-api-url: 'https://staging.zekt.dev'
```

---

## Migration Guide

### From v2.0.1 to v2.0.2

**No breaking changes** - fully backward compatible!

**Existing workflows (no changes needed):**
```yaml
- uses: zekt-dev-org/zekt-action@v2.0.1
  with:
    event-type: 'deployment'
    payload: '{"version": "1.0.0"}'

# Works exactly the same with v2.0.2
- uses: zekt-dev-org/zekt-action@v2.0.2
  with:
    event-type: 'deployment'
    payload: '{"version": "1.0.0"}'
```

**New feature (opt-in):**
```yaml
- uses: zekt-dev-org/zekt-action@v2.0.2
  with:
    event-type: 'deployment'
    payload: '{"version": "1.0.0"}'
    shield: true  # ⬅️ NEW: Enable encryption
```

---

## Implementation Checklist

### Phase 1: Setup
- [ ] Create `package.json` with dependencies
- [ ] Create `tsconfig.json`
- [ ] Create `jest.config.js`
- [ ] Set up directory structure (`src/`, `dist/`, `__tests__/`)

### Phase 2: Core Migration (Bash → TypeScript)
- [ ] Implement `src/index.ts` (entry point)
- [ ] Implement `src/main.ts` (OIDC + event sending)
- [ ] Implement `src/utils.ts` (input parsing, context extraction)
- [ ] Implement `src/api-client.ts` (event API only, no Shield yet)
- [ ] Implement `src/types.ts` (all type definitions)
- [ ] Update `action.yml` to use `runs: using: 'node20'`
- [ ] Test: Verify existing functionality works without Shield

### Phase 3: Shield Implementation
- [ ] Add `shield` input to `action.yml`
- [ ] Implement `src/shield.ts` (encryption logic)
  - [ ] `getConsumerKeys()` - API call
  - [ ] `generateAESKey()` - AES key generation
  - [ ] `encryptWithAES()` - AES-256-GCM encryption
  - [ ] `encryptAESKeyWithRSA()` - RSA-OAEP encryption
  - [ ] `encryptPayload()` - Orchestration
- [ ] Update `src/main.ts` to conditionally call Shield
- [ ] Add Shield types to `src/types.ts`

### Phase 4: Testing
- [ ] Write unit tests for Shield encryption
- [ ] Write API client tests
- [ ] Create integration test workflow
- [ ] Manual testing with staging API

### Phase 5: Documentation
- [ ] Update `README.md` with Shield usage
- [ ] Update `CHANGELOG.md` for v2.0.2
- [ ] Add Shield examples to docs
- [ ] Update GitHub release notes

### Phase 6: Release
- [ ] Build and commit `dist/index.js`
- [ ] Create GitHub release v2.0.2
- [ ] Tag release
- [ ] Announce in discussions

---

## Security Considerations

### Cryptographic Standards

✅ **AES-256-GCM** - Industry standard for symmetric encryption  
✅ **RSA-OAEP with SHA-256** - Secure RSA padding scheme  
✅ **Random IV generation** - Unique IV per encryption  
✅ **Authentication tags** - Prevents tampering (GCM mode)

### Key Management

✅ **AES keys generated per-event** - No key reuse  
✅ **Keys never logged** - Masked in all outputs  
✅ **Public keys only in action** - Private keys stay with consumers  
✅ **OIDC token masking** - Tokens hidden from logs

### Attack Vectors Mitigated

| Attack | Mitigation |
|--------|-----------|
| Man-in-the-middle | TLS + OIDC authentication |
| Replay attacks | Unique AES key per event |
| Tampering | GCM authentication tag |
| Unauthorized decryption | RSA-OAEP per consumer |
| Key exposure | Ephemeral AES keys |

---

## Performance Considerations

### Encryption Overhead

**Example: 100 consumers, 10 KB payload**

| Operation | Count | Size/Time | Total |
|-----------|-------|-----------|-------|
| AES encryption | 1 | ~10 KB | 10 KB |
| RSA encryptions | 100 | ~32 bytes each | 3.2 KB |
| Base64 encoding | 1 | 10 KB → 13.3 KB | 13.3 KB |
| RSA key encoding | 100 | ~44 bytes each | 4.4 KB |
| **Total envelope size** | - | - | **~21 KB** |

**Overhead:** ~11 KB (2.1x original payload size)

**Time:** ~100-200ms for encryption (acceptable in CI/CD)

### Scalability

| Consumers | Payload Size | Envelope Size | Encryption Time |
|-----------|--------------|---------------|-----------------|
| 10 | 10 KB | ~11 KB | ~50 ms |
| 50 | 10 KB | ~16 KB | ~100 ms |
| 100 | 10 KB | ~21 KB | ~200 ms |
| 100 | 100 KB | ~110 KB | ~300 ms |

**Conclusion:** Performance is acceptable for typical CI/CD use cases.

---

## Backward Compatibility

### Guarantee

✅ **100% backward compatible** - All existing workflows work without changes  
✅ **Opt-in feature** - Shield is disabled by default  
✅ **Same API endpoints** - No changes to Zekt backend contracts  
✅ **Same outputs** - `event-id`, `status`, `consumers-notified` unchanged

### Version Matrix

| Version | Type | Shield Support | Breaking Changes |
|---------|------|----------------|------------------|
| v1.0.0 | Node.js | ❌ No | Initial release |
| v2.0.0 | Bash | ❌ No | ✅ Complete rewrite |
| v2.0.1 | Bash | ❌ No | Bug fixes |
| v2.0.2 | Node.js | ✅ Yes | ❌ None (opt-in) |

---

## Future Enhancements

### Potential Features (Post v2.0.2)

1. **Shield Key Caching** - Cache consumer keys for 5 minutes to reduce API calls
2. **Payload Compression** - Gzip payloads before encryption
3. **Multi-algorithm Support** - Allow consumers to specify algorithm preferences
4. **Shield Metadata** - Include encryption metadata (algorithm, timestamp)
5. **Shield Verification** - Endpoint to verify Shield is working

---

## Glossary

| Term | Definition |
|------|------------|
| **Shield** | End-to-end encryption feature for Zekt payloads |
| **Hybrid Encryption** | AES for data + RSA for key encryption |
| **OIDC** | OpenID Connect - GitHub's authentication mechanism |
| **Shield Envelope** | Encrypted payload wrapper with metadata |
| **Consumer** | Repository that receives events from provider |
| **Provider** | Repository that sends events to consumers |
| **AES-256-GCM** | Advanced Encryption Standard with Galois/Counter Mode |
| **RSA-OAEP** | RSA with Optimal Asymmetric Encryption Padding |

---

## Support & Questions

- **GitHub Issues:** https://github.com/zekt-dev-org/zekt-action/issues
- **Discussions:** https://github.com/zekt-dev-org/zekt-action/discussions
- **Email:** support@zekt.dev

---

**Document Status:** ✅ Ready for Implementation  
**Next Step:** Begin Phase 1 (Setup) from Implementation Checklist

---

*This specification was created on January 23, 2026 for Zekt Action v2.0.2 Shield implementation.*
