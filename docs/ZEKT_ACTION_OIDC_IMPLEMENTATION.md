# Zekt Action OIDC Authentication Implementation

## Overview

This document describes the implementation plan for zero-secret authentication between the Zekt GitHub Action and the Zekt Backend API using GitHub's built-in OIDC (OpenID Connect) tokens.

**Goal**: Providers should NOT need to configure any secrets to use the Zekt Action. Authentication is handled automatically using GitHub Actions' OIDC capability.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PROVIDER WORKFLOW                                                           │
│                                                                             │
│  jobs:                                                                      │
│    send-to-zekt:                                                           │
│      permissions:                                                           │
│        id-token: write    ← Required for OIDC                              │
│        contents: read                                                       │
│                                                                             │
│      steps:                                                                 │
│        - uses: zekt-dev/zekt-action@v1                                     │
│          with:                                                              │
│            event-type: 'deployment'                                         │
│            payload: '{"version": "1.0"}'                                   │
│            # NO SECRETS NEEDED!                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ ZEKT ACTION (this repository)                                               │
│                                                                             │
│  1. Request OIDC token from GitHub:                                         │
│     curl -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN"         │
│          "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=api://zekt"                │
│                                                                             │
│  2. Send event to Zekt API with OIDC token:                                │
│     POST https://zekt-api.azurewebsites.net/api/events/receive              │
│     Headers:                                                                │
│       Authorization: Bearer <oidc-token>                                    │
│       Content-Type: application/json                                        │
│       X-GitHub-Repository: owner/repo                                       │
│     Body: { eventType, repository, payload, ... }                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ ZEKT BACKEND API (zektMainWeb repository)                                   │
│                                                                             │
│  1. Extract Bearer token from Authorization header                          │
│  2. Decode JWT and validate:                                                │
│     - Issuer: https://token.actions.githubusercontent.com                   │
│     - Audience: api://zekt                                                  │
│     - Expiration: not expired                                               │
│     - Repository claim matches request body                                 │
│  3. Verify repository is enabled in Zekt                                    │
│  4. Store event and forward to consumers                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## OIDC Token Details

### Token Request
GitHub Actions provides these environment variables when `id-token: write` permission is set:
- `ACTIONS_ID_TOKEN_REQUEST_TOKEN` - Bearer token to request OIDC token
- `ACTIONS_ID_TOKEN_REQUEST_URL` - URL to request OIDC token from

### Token Claims
The OIDC token from GitHub contains these claims:
```json
{
  "iss": "https://token.actions.githubusercontent.com",
  "aud": "api://zekt",
  "sub": "repo:owner/repo:ref:refs/heads/main",
  "repository": "owner/repo",
  "repository_owner": "owner",
  "repository_owner_id": "12345",
  "actor": "username",
  "actor_id": "67890",
  "workflow": "workflow-name",
  "workflow_ref": "owner/repo/.github/workflows/workflow.yml@refs/heads/main",
  "event_name": "workflow_dispatch",
  "ref": "refs/heads/main",
  "sha": "abc123...",
  "run_id": "123456789",
  "run_number": "42",
  "job_workflow_ref": "owner/repo/.github/workflows/workflow.yml@refs/heads/main",
  "iat": 1701792000,
  "exp": 1701792900,
  "nbf": 1701791700
}
```

---

## Zekt Action Implementation

### action.yml

```yaml
name: 'Zekt Event Action'
description: 'Send workflow events to Zekt broker for distribution to consumers. No secrets required - uses GitHub OIDC for authentication.'
author: 'Zekt'

branding:
  icon: 'send'
  color: 'orange'

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
    default: 'https://zekt-customer-api.azurewebsites.net'

outputs:
  event-id:
    description: 'The unique ID of the sent event'
    value: ${{ steps.send-event.outputs.event_id }}
  status:
    description: 'Status of the event submission (success/failed)'
    value: ${{ steps.send-event.outputs.status }}
  consumers-notified:
    description: 'Number of consumers that will receive this event'
    value: ${{ steps.send-event.outputs.consumers_notified }}

runs:
  using: 'composite'
  steps:
    - name: Validate Inputs
      shell: bash
      run: |
        if [ -z "${{ inputs.event-type }}" ]; then
          echo "::error::event-type is required"
          exit 1
        fi
        
        # Validate payload is valid JSON
        if ! echo '${{ inputs.payload }}' | jq . > /dev/null 2>&1; then
          echo "::error::payload must be valid JSON"
          exit 1
        fi
        
        echo "✅ Inputs validated"

    - name: Get OIDC Token
      id: get-token
      shell: bash
      run: |
        echo "🔐 Requesting OIDC token from GitHub..."
        
        # Check if OIDC is available
        if [ -z "$ACTIONS_ID_TOKEN_REQUEST_TOKEN" ] || [ -z "$ACTIONS_ID_TOKEN_REQUEST_URL" ]; then
          echo "::error::OIDC token request not available. Ensure the workflow has 'permissions: id-token: write'"
          exit 1
        fi
        
        # Request OIDC token with Zekt audience
        OIDC_RESPONSE=$(curl -s -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
          "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=api://zekt")
        
        OIDC_TOKEN=$(echo "$OIDC_RESPONSE" | jq -r '.value')
        
        if [ -z "$OIDC_TOKEN" ] || [ "$OIDC_TOKEN" == "null" ]; then
          echo "::error::Failed to obtain OIDC token"
          echo "Response: $OIDC_RESPONSE"
          exit 1
        fi
        
        # Mask the token in logs
        echo "::add-mask::$OIDC_TOKEN"
        echo "oidc_token=$OIDC_TOKEN" >> $GITHUB_OUTPUT
        
        echo "✅ OIDC token obtained successfully"

    - name: Send Event to Zekt
      id: send-event
      shell: bash
      env:
        ZEKT_API_URL: ${{ inputs.zekt-api-url }}
        EVENT_TYPE: ${{ inputs.event-type }}
        PAYLOAD: ${{ inputs.payload }}
        OIDC_TOKEN: ${{ steps.get-token.outputs.oidc_token }}
      run: |
        echo "📤 Sending event to Zekt..."
        echo "   API URL: $ZEKT_API_URL"
        echo "   Event Type: $EVENT_TYPE"
        echo "   Repository: $GITHUB_REPOSITORY"
        
        # Build the request body
        REQUEST_BODY=$(jq -n \
          --arg eventType "$EVENT_TYPE" \
          --arg repository "$GITHUB_REPOSITORY" \
          --arg runId "$GITHUB_RUN_ID" \
          --arg actor "$GITHUB_ACTOR" \
          --arg sha "$GITHUB_SHA" \
          --arg ref "$GITHUB_REF" \
          --arg workflow "$GITHUB_WORKFLOW" \
          --argjson payload "$PAYLOAD" \
          '{
            eventType: $eventType,
            repository: $repository,
            workflowRunId: $runId,
            triggeredBy: $actor,
            commitSha: $sha,
            ref: $ref,
            workflow: $workflow,
            payload: $payload,
            timestamp: (now | todate)
          }')
        
        # Send to Zekt API with OIDC token
        RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
          "$ZEKT_API_URL/api/events/receive" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $OIDC_TOKEN" \
          -H "X-GitHub-Repository: $GITHUB_REPOSITORY" \
          -d "$REQUEST_BODY")
        
        # Extract status code (last line) and body (everything else)
        HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
        RESPONSE_BODY=$(echo "$RESPONSE" | sed '$d')
        
        echo "   HTTP Status: $HTTP_CODE"
        
        if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
          echo "✅ Event sent successfully!"
          
          # Parse response
          EVENT_ID=$(echo "$RESPONSE_BODY" | jq -r '.eventId // "unknown"')
          CONSUMERS=$(echo "$RESPONSE_BODY" | jq -r '.consumersNotified // 0')
          MESSAGE=$(echo "$RESPONSE_BODY" | jq -r '.message // "Event received"')
          
          echo "event_id=$EVENT_ID" >> $GITHUB_OUTPUT
          echo "status=success" >> $GITHUB_OUTPUT
          echo "consumers_notified=$CONSUMERS" >> $GITHUB_OUTPUT
          
          echo ""
          echo "📋 Event Details:"
          echo "   Event ID: $EVENT_ID"
          echo "   Consumers Notified: $CONSUMERS"
          echo "   Message: $MESSAGE"
        else
          echo "::error::Failed to send event to Zekt (HTTP $HTTP_CODE)"
          echo "Response: $RESPONSE_BODY"
          echo "status=failed" >> $GITHUB_OUTPUT
          echo "event_id=" >> $GITHUB_OUTPUT
          echo "consumers_notified=0" >> $GITHUB_OUTPUT
          exit 1
        fi

    - name: Write Job Summary
      shell: bash
      if: always()
      run: |
        echo "### 📨 Zekt Event Delivery" >> $GITHUB_STEP_SUMMARY
        echo "" >> $GITHUB_STEP_SUMMARY
        echo "| Property | Value |" >> $GITHUB_STEP_SUMMARY
        echo "|----------|-------|" >> $GITHUB_STEP_SUMMARY
        echo "| Event Type | \`${{ inputs.event-type }}\` |" >> $GITHUB_STEP_SUMMARY
        echo "| Repository | \`${{ github.repository }}\` |" >> $GITHUB_STEP_SUMMARY
        echo "| Workflow | \`${{ github.workflow }}\` |" >> $GITHUB_STEP_SUMMARY
        echo "| Run ID | \`${{ github.run_id }}\` |" >> $GITHUB_STEP_SUMMARY
        echo "| Status | **${{ steps.send-event.outputs.status || 'unknown' }}** |" >> $GITHUB_STEP_SUMMARY
        if [ "${{ steps.send-event.outputs.status }}" == "success" ]; then
          echo "| Event ID | \`${{ steps.send-event.outputs.event_id }}\` |" >> $GITHUB_STEP_SUMMARY
          echo "| Consumers Notified | ${{ steps.send-event.outputs.consumers_notified }} |" >> $GITHUB_STEP_SUMMARY
        fi
        echo "" >> $GITHUB_STEP_SUMMARY
        echo "---" >> $GITHUB_STEP_SUMMARY
        echo "_Sent via [Zekt Action](https://github.com/zekt-dev/zekt-action)_" >> $GITHUB_STEP_SUMMARY
```

---

## API Contract

### Endpoint
```
POST /api/events/receive
```

### Headers
| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer <oidc-token>` |
| `Content-Type` | Yes | `application/json` |
| `X-GitHub-Repository` | Yes | `owner/repo` format |

### Request Body
```json
{
  "eventType": "deployment-complete",
  "repository": "owner/repo",
  "workflowRunId": "123456789",
  "triggeredBy": "username",
  "commitSha": "abc123def456...",
  "ref": "refs/heads/main",
  "workflow": "deploy.yml",
  "payload": {
    "version": "1.0.0",
    "environment": "production",
    "custom": "data"
  },
  "timestamp": "2025-12-05T10:30:00Z"
}
```

### Response (Success - 200)
```json
{
  "success": true,
  "eventId": "evt-abc123",
  "consumersNotified": 3,
  "message": "Event received and forwarded to 3 consumer(s)"
}
```

### Response (Errors)
| Status | Body | Reason |
|--------|------|--------|
| 400 | `{"error": "Invalid event data"}` | Missing or malformed request |
| 401 | `{"error": "Missing or invalid Authorization header"}` | No OIDC token |
| 401 | `{"error": "Invalid token issuer"}` | Token not from GitHub |
| 401 | `{"error": "Token expired"}` | OIDC token expired |
| 403 | `{"error": "Repository mismatch"}` | Token repo ≠ body repo |
| 404 | `{"error": "Repository not enabled in Zekt"}` | Repo not onboarded |
| 404 | `{"error": "Provider not found"}` | Customer not found |
| 500 | `{"error": "Internal server error"}` | Server error |

---

## Backend Implementation Notes

The Zekt backend (zektMainWeb repository) will implement:

1. **OIDC Token Validation**
   - Decode JWT without full signature validation (for now)
   - Verify issuer is `https://token.actions.githubusercontent.com`
   - Check token is not expired
   - Extract `repository` claim

2. **Repository Verification**
   - `repository` claim in token MUST match `repository` in request body
   - Repository must be enabled in Zekt (exists in enabled-repositories container)
   - Repository must have `isActive: true`

3. **Event Processing**
   - Store event in `webhook-events` container
   - Look up active provider-consumer mappings
   - Forward event to subscribed consumers via `repository_dispatch`

---

## Migration from Secret-Based Auth

### Before (Required Secrets)
```yaml
- uses: zekt-dev/zekt-action@v1
  with:
    zekt-api-url: ${{ secrets.ZEKT_API_URL }}
    zekt-webhook-secret: ${{ secrets.ZEKT_WEBHOOK_SECRET }}
    event-type: 'deployment'
    payload: '...'
```

### After (Zero Secrets)
```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: zekt-dev/zekt-action@v1
    with:
      event-type: 'deployment'
      payload: '...'
```

---

## Testing Checklist

### Action Side
- [ ] OIDC token is successfully requested when `id-token: write` permission exists
- [ ] Error is shown when permission is missing
- [ ] Request body is correctly constructed with all GitHub context
- [ ] OIDC token is passed in Authorization header
- [ ] Response is correctly parsed and outputs are set
- [ ] Job summary is written correctly
- [ ] Errors are properly reported

### Backend Side
- [ ] OIDC token is extracted from Authorization header
- [ ] Token is decoded and issuer is validated
- [ ] Token expiration is checked
- [ ] Repository claim is extracted and matched
- [ ] Enabled repository lookup works
- [ ] Event is stored in Cosmos DB
- [ ] Event is forwarded to consumers

### End-to-End
- [ ] Provider runs workflow with Zekt Action (no secrets)
- [ ] Event appears in Zekt `webhook-events` container
- [ ] Consumer workflow is triggered via `repository_dispatch`
- [ ] Consumer receives correct payload

---

## Files to Create/Modify

### In zekt-action repository:
1. **`action.yml`** - Complete rewrite with OIDC authentication (see above)
2. **`README.md`** - Update documentation to reflect zero-secret usage
3. **Remove** any references to `zekt-webhook-secret` input

### In zektMainWeb repository (handled separately):
1. **`EventReceiverFunction.cs`** - Add OIDC token validation
2. **`CustomerApi.csproj`** - Add `System.IdentityModel.Tokens.Jwt` package

---

## Questions for Coordination

1. **API URL**: Should the default be `https://zekt-customer-api.azurewebsites.net` or different?
2. **Audience**: Using `api://zekt` - is this correct for your Azure AD setup?
3. **Versioning**: Should this be a major version bump (v2) since it's a breaking change?

---

## Contact

For backend implementation questions, refer to the zektMainWeb repository or coordinate with the backend agent.

Document created: December 5, 2025
