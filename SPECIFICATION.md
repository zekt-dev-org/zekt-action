# Zekt Action - Complete Specification for AI Agent

## Repository Context & Intent

### Purpose
The `zekt-action` repository is a **standalone GitHub Action** that acts as the **entry point for custom messaging** in the Zekt orchestration platform. It enables **provider workflows** to send custom event payloads that will be distributed to **consumer repositories**.

### Core Functionality
1. **Capture** workflow run ID and custom JSON payload during workflow execution
2. **Validate** payload size (max 512 KB) and JSON structure
3. **Authenticate** using GitHub-issued `GITHUB_TOKEN`
4. **POST** data to Zekt backend API (`/api/zekt/register-run`)
5. **Handle errors** gracefully with retry logic and clear user feedback

### Integration Architecture
```
Provider Workflow (GitHub Actions)
  ↓
[zekt-action] ← THIS REPOSITORY
  ↓ HTTP POST
Zekt Backend API (/api/zekt/register-run)
  ↓ Correlation Engine (run_id matching)
  ↓ Storage (Cosmos DB run-correlations)
  ↓ Webhook Processing
Consumer Workflows (repository_dispatch)
```

---

## Technology Stack & Dependencies

### Runtime Environment
- **Platform:** GitHub Actions Runner (ubuntu-latest, windows-latest, macos-latest)
- **Node.js Version:** 20.x (matches GitHub Actions runner)
- **Action Type:** JavaScript action (runs directly in workflow, no Docker container)

### Required NPM Dependencies

```json
{
  "dependencies": {
    "@actions/core": "^1.10.1",
    "@actions/github": "^6.0.0"
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

### Language Selection: TypeScript ✅ REQUIRED
**Rationale:**
- Type safety prevents runtime errors
- Better IDE support (autocomplete, refactoring)
- GitHub Actions SDK has excellent TypeScript types
- Easier to maintain and extend

### Build Tool: @vercel/ncc ✅ REQUIRED
**Rationale:**
- Bundles TypeScript + dependencies into single `dist/index.js`
- No need to commit `node_modules` to Git
- Faster action execution (no npm install during runtime)
- Standard practice for JavaScript actions

---

## File Structure (REQUIRED)

```
zekt-action/
├── .github/
│   └── workflows/
│       ├── build.yml              # Build & test on PR
│       ├── release.yml            # Publish on tag
│       └── test-integration.yml   # Test against staging API
│
├── src/
│   ├── index.ts                   # Entry point (calls run())
│   ├── run.ts                     # Main action logic
│   ├── validator.ts               # Payload size/JSON validation
│   ├── api-client.ts              # HTTP communication with Zekt
│   ├── types.ts                   # TypeScript interfaces
│   └── utils.ts                   # Helper functions
│
├── dist/
│   └── index.js                   # Compiled bundle (MUST BE COMMITTED!)
│
├── tests/
│   ├── validator.test.ts
│   ├── api-client.test.ts
│   └── run.test.ts
│
├── .gitignore
├── .eslintrc.json
├── .prettierrc
├── action.yml                     # Action metadata (REQUIRED by GitHub)
├── package.json
├── tsconfig.json
├── jest.config.js
├── README.md                      # User documentation
├── SPECIFICATION.md               # This document
├── CHANGELOG.md                   # Version history
└── LICENSE                        # MIT License
```

---

## Action Inputs & Outputs

### action.yml Definition (REQUIRED)

```yaml
name: 'Zekt Event Publisher'
description: 'Send custom event payloads to Zekt orchestration platform'
author: 'zekt-dev-org'

branding:
  icon: 'send'
  color: 'blue'

inputs:
  zekt_run_id:
    description: 'GitHub workflow run ID (use ${{ github.run_id }})'
    required: true
    
  zekt_step_id:
    description: 'Unique step identifier for multiple actions in same workflow (use ${{ github.job }}-${{ github.action }})'
    required: false
    default: 'default'
    
  zekt_payload:
    description: 'Custom JSON payload to send to consumers (max 512 KB)'
    required: true
    
  zekt_api_url:
    description: 'Zekt API endpoint (override for testing)'
    required: false
    default: 'https://api.zekt.dev/api/zekt/register-run'
    
  github_token:
    description: 'GitHub token for authentication (use ${{ secrets.GITHUB_TOKEN }})'
    required: true

outputs:
  success:
    description: 'Whether the payload was successfully registered (true/false)'
    
  run_id:
    description: 'The workflow run ID that was registered'
    
  step_id:
    description: 'The step ID that was registered'
    
  error_message:
    description: 'Error message if registration failed (empty on success)'

runs:
  using: 'node20'
  main: 'dist/index.js'
```

---

## API Contract with Zekt Backend

### Request Format

```http
POST https://api.zekt.dev/api/zekt/register-run
Content-Type: application/json
Authorization: Bearer {GITHUB_TOKEN}
X-GitHub-Repository: {owner}/{repo}
X-GitHub-Run-ID: {run_id}
User-Agent: zekt-action/1.0.0
```

```json
{
  "zekt_run_id": 12345678,
  "zekt_step_id": "build-test",
  "zekt_payload": {
    "test_results": {
      "passed": 42,
      "failed": 3,
      "coverage": "87%"
    },
    "artifact_url": "https://...",
    "deployment_target": "production"
  },
  "github_context": {
    "repository": "acme-corp/backend",
    "workflow": "CI Pipeline",
    "job": "build",
    "actor": "john-doe",
    "event_name": "push",
    "ref": "refs/heads/main",
    "sha": "abc123def456"
  }
}
```

### TypeScript Type Definitions (types.ts)

```typescript
export interface RegisterRunRequest {
  zekt_run_id: number;
  zekt_step_id: string;
  zekt_payload: unknown;
  github_context: GitHubContext;
}

export interface GitHubContext {
  repository: string;
  workflow: string;
  job: string;
  actor: string;
  event_name: string;
  ref: string;
  sha: string;
}

export interface ActionInputs {
  zektRunId: number;
  zektStepId: string;
  zektPayload: string;
  zektApiUrl: string;
  githubToken: string;
}

export interface ZektApiResponse {
  success: boolean;
  run_id?: number;
  step_id?: string;
  message?: string;
  error?: string;
}
```

### Expected Response Codes

```http
# Success
HTTP/1.1 202 Accepted
{
  "success": true,
  "run_id": 12345678,
  "step_id": "build-test",
  "message": "Payload registered successfully"
}

# Unauthorized (invalid token)
HTTP/1.1 401 Unauthorized
{ "error": "Invalid GitHub token" }

# Forbidden (repository not Zekt-enabled)
HTTP/1.1 403 Forbidden
{ "error": "Repository 'acme-corp/backend' is not enabled for Zekt" }

# Payload too large
HTTP/1.1 413 Payload Too Large
{ "error": "Payload exceeds 512 KB limit" }

# Bad request (invalid JSON)
HTTP/1.1 400 Bad Request
{ "error": "zekt_payload must be valid JSON" }

# Server error
HTTP/1.1 500 Internal Server Error
{ "error": "Internal server error" }
```

---

## Validation Requirements

### 1. Payload Size Validation (validator.ts)

```typescript
const MAX_PAYLOAD_SIZE = 524288; // 512 KB in bytes

export function validatePayloadSize(payload: string): void {
  const sizeBytes = Buffer.byteLength(payload, 'utf8');
  
  if (sizeBytes > MAX_PAYLOAD_SIZE) {
    throw new Error(
      `Payload size (${sizeBytes} bytes) exceeds maximum allowed size (${MAX_PAYLOAD_SIZE} bytes). ` +
      `Maximum: 512 KB (524,288 bytes)`
    );
  }
}
```

### 2. JSON Validation (validator.ts)

```typescript
export function validateJSON(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `Invalid JSON payload: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
      `Please ensure zekt_payload contains valid JSON.`
    );
  }
}
```

### 3. Required Inputs Validation (validator.ts)

```typescript
export function validateInputs(inputs: ActionInputs): void {
  if (!inputs.zektRunId || inputs.zektRunId <= 0) {
    throw new Error(
      'zekt_run_id is required and must be a positive number. ' +
      'Use: ${{ github.run_id }}'
    );
  }
  
  if (!inputs.zektPayload || inputs.zektPayload.trim() === '') {
    throw new Error(
      'zekt_payload is required and cannot be empty. ' +
      'Provide a valid JSON object as a string.'
    );
  }
  
  if (!inputs.githubToken || inputs.githubToken.trim() === '') {
    throw new Error(
      'github_token is required. Use: ${{ secrets.GITHUB_TOKEN }}'
    );
  }
  
  if (!inputs.zektApiUrl || !inputs.zektApiUrl.startsWith('http')) {
    throw new Error(
      'zekt_api_url must be a valid HTTP/HTTPS URL'
    );
  }
}
```

---

## HTTP Client Implementation (api-client.ts)

### Retry Logic with Exponential Backoff

```typescript
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000; // 1 second

export async function sendToZekt(
  url: string,
  payload: RegisterRunRequest,
  token: string,
  repository: string,
  runId: number,
  attempt: number = 1
): Promise<ZektApiResponse> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Repository': repository,
        'X-GitHub-Run-ID': runId.toString(),
        'User-Agent': 'zekt-action/1.0.0'
      },
      body: JSON.stringify(payload)
    });

    // Parse response body
    let responseBody: ZektApiResponse;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    // Retry on 5xx errors or 429 (rate limit)
    if ((response.status >= 500 || response.status === 429) && attempt < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
      console.log(`Retry attempt ${attempt}/${MAX_RETRIES} after ${delay}ms...`);
      await sleep(delay);
      return sendToZekt(url, payload, token, repository, runId, attempt + 1);
    }

    // Handle error responses
    if (!response.ok) {
      throw new Error(
        responseBody.error || `HTTP ${response.status}: ${response.statusText}`
      );
    }

    return responseBody;

  } catch (error) {
    // Retry on network errors
    if (attempt < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`Network error. Retry attempt ${attempt}/${MAX_RETRIES} after ${delay}ms...`);
      await sleep(delay);
      return sendToZekt(url, payload, token, repository, runId, attempt + 1);
    }
    
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Main Action Logic (run.ts)

```typescript
import * as core from '@actions/core';
import * as github from '@actions/github';
import { validateInputs, validatePayloadSize, validateJSON } from './validator';
import { sendToZekt } from './api-client';
import { ActionInputs, RegisterRunRequest, GitHubContext } from './types';

export async function run(): Promise<void> {
  try {
    // 1. Read inputs
    const inputs: ActionInputs = {
      zektRunId: parseInt(core.getInput('zekt_run_id', { required: true })),
      zektStepId: core.getInput('zekt_step_id') || 'default',
      zektPayload: core.getInput('zekt_payload', { required: true }),
      zektApiUrl: core.getInput('zekt_api_url') || 'https://api.zekt.dev/api/zekt/register-run',
      githubToken: core.getInput('github_token', { required: true })
    };

    // 2. Validate inputs
    core.info('Validating inputs...');
    validateInputs(inputs);
    
    // 3. Validate payload size
    core.info('Validating payload size...');
    validatePayloadSize(inputs.zektPayload);
    
    // 4. Validate JSON structure
    core.info('Validating JSON structure...');
    const parsedPayload = validateJSON(inputs.zektPayload);

    // 5. Construct GitHub context
    const githubContext: GitHubContext = {
      repository: `${github.context.repo.owner}/${github.context.repo.repo}`,
      workflow: github.context.workflow,
      job: github.context.job,
      actor: github.context.actor,
      event_name: github.context.eventName,
      ref: github.context.ref,
      sha: github.context.sha
    };

    // 6. Construct request payload
    const request: RegisterRunRequest = {
      zekt_run_id: inputs.zektRunId,
      zekt_step_id: inputs.zektStepId,
      zekt_payload: parsedPayload,
      github_context: githubContext
    };

    // 7. Send to Zekt backend
    core.info(`Sending payload to Zekt (run_id: ${inputs.zektRunId}, step_id: ${inputs.zektStepId})...`);
    const response = await sendToZekt(
      inputs.zektApiUrl,
      request,
      inputs.githubToken,
      githubContext.repository,
      inputs.zektRunId
    );

    // 8. Set outputs
    core.setOutput('success', 'true');
    core.setOutput('run_id', inputs.zektRunId.toString());
    core.setOutput('step_id', inputs.zektStepId);
    core.setOutput('error_message', '');

    core.info(`✅ Successfully registered run ${inputs.zektRunId} with Zekt`);
    core.info(`Message: ${response.message || 'Payload registered successfully'}`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    core.setOutput('success', 'false');
    core.setOutput('error_message', errorMessage);
    
    core.setFailed(`❌ Failed to register run with Zekt: ${errorMessage}`);
  }
}
```

---

## Entry Point (index.ts)

```typescript
import { run } from './run';

// Execute action
run().catch(error => {
  console.error('Unhandled error in Zekt Action:', error);
  process.exit(1);
});
```

---

## Security Requirements (CRITICAL)

### 1. Token Handling - NEVER LOG TOKENS

```typescript
// ✅ CORRECT: Use token in Authorization header only
const response = await fetch(url, {
  headers: {
    'Authorization': `Bearer ${githubToken}`
  }
});

// ❌ WRONG: Never log the token
console.log(`Token: ${githubToken}`); // NEVER DO THIS
core.info(`Using token: ${githubToken}`); // NEVER DO THIS

// ❌ WRONG: Never store in variables that could be serialized
const config = { token: githubToken }; // DANGEROUS if logged
```

### 2. Error Message Safety

```typescript
// ✅ CORRECT: Redact sensitive data from errors
try {
  await sendToZekt(token, payload);
} catch (error) {
  // Only include error.message, never the full error object
  core.setFailed(`Failed to register run: ${error.message}`);
}

// ❌ WRONG: Exposing full error with potential token leak
catch (error) {
  core.setFailed(JSON.stringify(error)); // Could leak token
}
```

### 3. Payload Sanitization

```typescript
// ✅ CORRECT: Validate JSON, don't execute
const payload = JSON.parse(userInput);

// ❌ WRONG: Never use eval()
const payload = eval(userInput); // NEVER DO THIS

// ❌ WRONG: Never execute user-provided code
const fn = new Function(userInput); // NEVER DO THIS
```

---

## Testing Requirements

### Unit Tests (Jest)

**tests/validator.test.ts**
```typescript
import { validatePayloadSize, validateJSON, validateInputs } from '../src/validator';

describe('Validator', () => {
  describe('validatePayloadSize', () => {
    it('should pass for payload under 512 KB', () => {
      const payload = JSON.stringify({ data: 'small payload' });
      expect(() => validatePayloadSize(payload)).not.toThrow();
    });

    it('should reject payload over 512 KB', () => {
      const largePayload = 'A'.repeat(524289); // 512 KB + 1 byte
      expect(() => validatePayloadSize(largePayload)).toThrow('exceeds maximum allowed size');
    });
  });

  describe('validateJSON', () => {
    it('should parse valid JSON', () => {
      const json = '{"test": true}';
      const result = validateJSON(json);
      expect(result).toEqual({ test: true });
    });

    it('should reject invalid JSON', () => {
      const invalidJson = '{invalid}';
      expect(() => validateJSON(invalidJson)).toThrow('Invalid JSON payload');
    });
  });
});
```

**Coverage Target:** >90%

---

## Build & Deployment

### package.json Scripts

```json
{
  "scripts": {
    "build": "ncc build src/index.ts -o dist --source-map --license licenses.txt",
    "test": "jest",
    "test:coverage": "jest --coverage",
    "format": "prettier --write 'src/**/*.ts'",
    "lint": "eslint src/**/*.ts",
    "prepare": "npm run build"
  }
}
```

### Build Process

```bash
# 1. Install dependencies
npm install

# 2. Compile TypeScript + bundle
npm run build

# 3. Verify dist/index.js exists
ls -lh dist/index.js
# Expected: 50-100 KB bundled file

# 4. Commit dist/index.js (CRITICAL!)
git add dist/index.js
git commit -m "build: compile action bundle"
git push
```

⚠️ **CRITICAL:** The `dist/index.js` file MUST be committed to Git. GitHub Actions runs this file directly.

---

## Publishing to GitHub Marketplace

### Version Tagging

```bash
# 1. Create semantic version tag
git tag -a v1.0.0 -m "Initial release"
git push origin v1.0.0

# 2. Create major version tag (allows users to use @v1)
git tag -a v1 -m "v1 stable" -f
git push origin v1 -f

# 3. Create GitHub Release
gh release create v1.0.0 \
  --title "v1.0.0 - Initial Release" \
  --notes "First stable release of Zekt Action"
```

### Marketplace Listing
- **Category:** Deployment or Utilities
- **Tags:** orchestration, events, webhooks, ci-cd
- **Description:** "Send custom event payloads from GitHub workflows to Zekt consumers"

---

## Example Usage

### Basic Usage

```yaml
name: CI Pipeline
on: [push]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run tests
        run: npm test
      
      - name: Send results to Zekt
        uses: zekt-dev-org/zekt-action@v1
        with:
          zekt_run_id: ${{ github.run_id }}
          zekt_payload: |
            {
              "test_results": {
                "passed": 42,
                "failed": 3
              },
              "coverage": "87%"
            }
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Advanced Usage (Multiple Steps)

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Build
        run: npm run build
      
      - name: Send build status
        uses: zekt-dev-org/zekt-action@v1
        with:
          zekt_run_id: ${{ github.run_id }}
          zekt_step_id: ${{ github.job }}-build
          zekt_payload: '{"status": "success", "artifact": "build-123.tar.gz"}'
          github_token: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Deploy
        run: ./deploy.sh
      
      - name: Send deploy status
        uses: zekt-dev-org/zekt-action@v1
        with:
          zekt_run_id: ${{ github.run_id }}
          zekt_step_id: ${{ github.job }}-deploy
          zekt_payload: '{"status": "deployed", "environment": "production"}'
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

---

## Integration with Zekt Backend (zektMainWeb)

### Backend Components Required

**In zektMainWeb repository, the following must exist:**

1. **RegisterRunFunction.cs** - Receives POST from this action
   - Validates GitHub token
   - Checks repository is Zekt-enabled
   - Stores correlation in Cosmos DB `run-correlations` container

2. **RunCorrelation.cs** - Data model
   ```csharp
   public class RunCorrelation
   {
       public string Id { get; set; } // "{run_id}-{step_id}"
       public string CustomerId { get; set; } // partition key
       public long WorkflowRunId { get; set; }
       public string Repository { get; set; }
       public JsonElement CustomPayload { get; set; }
       public DateTime RegisteredAt { get; set; }
       public int Ttl { get; set; } = 86400; // 24h auto-delete
   }
   ```

3. **ProcessCustomPayloadFunction.cs** - Correlates webhook with payload
   - Receives GitHub webhook (workflow_run completed)
   - Looks up correlation by run_id
   - Merges metadata + custom payload
   - Dispatches to consumers via repository_dispatch

### API Endpoint Contract

**Backend must implement:**
```
POST /api/zekt/register-run
- Validate Authorization: Bearer {GITHUB_TOKEN}
- Validate X-GitHub-Repository header
- Check repository is Zekt-enabled in Cosmos DB
- Store in run-correlations container (TTL 24h)
- Return 202 Accepted on success
```

---

## Success Criteria (Definition of Done)

- [ ] `action.yml` with all required inputs/outputs
- [ ] TypeScript implementation with full validation
- [ ] Unit tests achieve >90% coverage
- [ ] `dist/index.js` compiled and committed
- [ ] Integration test workflow passes
- [ ] README.md with usage examples
- [ ] Published to GitHub Marketplace
- [ ] Tagged with v1.0.0 and v1
- [ ] End-to-end test passes (action → backend → Cosmos DB)
- [ ] Zero security vulnerabilities (npm audit)
- [ ] No GitHub tokens logged or exposed

---

## Common Issues & Troubleshooting

### Issue 1: "Module not found" Error
**Cause:** `dist/index.js` not committed or out of date
**Fix:**
```bash
npm run build
git add dist/index.js
git commit -m "build: update bundle"
git push
```

### Issue 2: 403 Forbidden from Backend
**Cause:** Repository not Zekt-enabled
**Fix:** Enable repository in Zekt portal (zektMainWeb)

### Issue 3: Payload Too Large
**Cause:** Payload exceeds 512 KB
**Fix:** Reduce payload size or reference external storage

---

## Final Notes

- This is a **standalone repository** separate from `zektMainWeb`
- Language: **TypeScript** (required)
- Build tool: **@vercel/ncc** (required)
- Testing: **Jest** with >90% coverage
- **MUST commit `dist/index.js`** to Git
- **NEVER log GitHub tokens**
- Follow semantic versioning (v1.0.0, v1.1.0, etc.)
- Maintain `v1`, `v1.0`, `v1.0.0` tags for flexible version pinning

**Integration Point:** This action POSTs to `zektMainWeb` backend, which handles correlation, storage, and distribution to consumers.
