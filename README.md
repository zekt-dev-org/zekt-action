# Zekt Event Action

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Send workflow events to the Zekt broker for distribution to consumers — or submit a multi-step **orchestration plan** and let Zekt drive the entire service chain. **No secrets required** — uses GitHub's built-in OIDC for authentication.

## Features

- 🔐 **Zero Secrets** — No API keys or tokens to configure
- 🚀 **Simple Integration** — Just 1 required input for standard use
- ✅ **Automatic Authentication** — Uses GitHub OIDC tokens
- 🎼 **Orchestration** — Submit multi-step service chains in a single call (v3.0.0+)
- 🛡️ **Shield Encryption** — Optional end-to-end payload encryption (v2.0.2+)
- 📋 **Job Summary** — Writes delivery status to workflow summary
- 📤 **Rich Context** — Automatically includes workflow metadata

## Quick Start

```yaml
name: Deploy Pipeline
on: [push]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # Required for OIDC authentication
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Deploy application
        run: ./deploy.sh

      - name: Notify Zekt
        uses: zekt-dev-org/zekt-action@v3
        with:
          event-type: 'deployment-complete'
          payload: |
            {
              "version": "1.2.3",
              "environment": "production"
            }
```

> ⚠️ **Important:** `permissions: id-token: write` is required for OIDC authentication to work.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `event-type` | When `orchestrate: false` | — | The event type to send (e.g. `deployment`, `release`) |
| `payload` | No | `{}` | JSON event payload **or** orchestration plan (see [Orchestration](#orchestration)) |
| `shield` | No | `false` | Enable end-to-end payload encryption |
| `orchestrate` | No | `false` | When `true`, treat `payload` as a multi-step orchestration plan |
| `execution_mode` | No | `sequential` | Execution strategy; only evaluated when `orchestrate: true` |
| `wait` | No | `false` | Block until the orchestration reaches a terminal state (only when `orchestrate: true`) |
| `zekt-api-url` | No | `https://fxdevzektapp.azurewebsites.net` | Zekt API URL (for testing/staging) |

## Outputs

| Output | Set when | Description |
|--------|----------|-------------|
| `event-id` | `orchestrate: false` | Unique ID of the sent event |
| `status` | `orchestrate: false` | `success` or `failed` |
| `consumers-notified` | `orchestrate: false` | Number of consumers that will receive the event |
| `execution_id` | `orchestrate: true` | Orchestration execution ID (e.g. `exec-{uuid}`) |
| `execution_status` | `orchestrate: true` + `wait: true` | Terminal status: `completed` \| `failed` \| `timed_out` |
| `step_{step_id}_outputs_{field}` | `orchestrate: true` + `wait: true` | Individual step output values |

---

## Standard Usage (Event Dispatch)

### Basic

```yaml
jobs:
  notify:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: zekt-dev-org/zekt-action@v3
        with:
          event-type: 'build-complete'
```

### With Custom Payload

```yaml
- uses: zekt-dev-org/zekt-action@v3
  with:
    event-type: 'deployment'
    payload: |
      {
        "version": "${{ github.sha }}",
        "environment": "production",
        "deployed_by": "${{ github.actor }}"
      }
```

### Capture Outputs

```yaml
- name: Send Event
  id: zekt
  uses: zekt-dev-org/zekt-action@v3
  with:
    event-type: 'release'
    payload: '{"version": "3.0.0"}'

- name: Show Results
  run: |
    echo "Event ID: ${{ steps.zekt.outputs.event-id }}"
    echo "Status: ${{ steps.zekt.outputs.status }}"
    echo "Consumers: ${{ steps.zekt.outputs.consumers-notified }}"
```

### With Shield Encryption

```yaml
- uses: zekt-dev-org/zekt-action@v3
  with:
    event-type: 'deployment'
    shield: true
    payload: |
      {
        "version": "1.0.0",
        "environment": "production"
      }
```

> 🛡️ **Shield** encrypts the payload so only subscribed consumers with registered keys can decrypt it.

---

## Orchestration

> **Requires `orchestrate: true`** — the standard event path is completely unchanged.

Orchestration lets a consumer workflow submit a **multi-step service chain** in a single action call. Zekt dispatches each step as a `repository_dispatch` event to the target service workflow, resolving inter-step output references at dispatch time.

### Orchestration Payload Schema

When `orchestrate: true`, the `payload` input must be a JSON object with a `services` array:

```json
{
  "default_service_owner": "platform-team-org",
  "services": [
    {
      "step_id": "create-sub",
      "service_slug": "new-azure-subscription",
      "requested_by": "dev-team-a",
      "input": {
        "billing_account": "ba-123",
        "display_name": "dev-team-a-sub"
      }
    },
    {
      "step_id": "create-rg",
      "service_slug": "new-azure-resource-group",
      "depends_on": ["create-sub"],
      "input": {
        "subscription_id": "${{ steps.create-sub.outputs.subscription_id }}"
      }
    },
    {
      "step_id": "create-kv",
      "service_slug": "new-azure-keyvault",
      "depends_on": ["create-rg"],
      "input": {
        "resource_group": "${{ steps.create-rg.outputs.resource_group_name }}"
      }
    }
  ]
}
```

#### Top-level fields

| Field | Required | Description |
|-------|----------|-------------|
| `services` | ✅ Yes | Ordered list of steps (1–20 items) |
| `default_service_owner` | See note | GitHub org name used for any step that omits `service_owner_name` |
| `execution_mode` | No | `"sequential"` (default). Overrides the `execution_mode` action input when set here. |

> **Owner resolution:** every step must have a service owner — either set directly on the step via `service_owner_name`, or inherited from the request-level `default_service_owner`. At least one of the two must be present.

#### Per-step fields

| Field | Required | Description |
|-------|----------|-------------|
| `step_id` | ✅ Yes | Unique caller-defined name (`^[a-zA-Z0-9_-]+$`, max 64 chars). Used in `depends_on` and output references. |
| `service_slug` | ✅ Yes | Immutable machine-readable service identifier (`^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`). The only field used for routing — the human-readable name is never used. |
| `input` | ✅ Yes | Arbitrary JSON object passed to the target service. String values may contain `${{ steps.STEP_ID.outputs.FIELD }}` expressions — resolved by Zekt at dispatch time, **not** by this action. |
| `service_owner_name` | See note | GitHub org name of the service owner. Overrides `default_service_owner` for this step. |
| `requested_by` | No | Informational team name (max 256 chars). Never used for auth or routing. |
| `depends_on` | No | Array of `step_id` values that must complete before this step is dispatched. Omit for linear chains — Zekt infers sequential ordering automatically. |

### Usage Examples

#### Fire-and-Forget (no wait)

```yaml
jobs:
  orchestrate:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Submit orchestration
        id: orch
        uses: zekt-dev-org/zekt-action@v3
        with:
          orchestrate: true
          payload: |
            {
              "default_service_owner": "platform-team-org",
              "services": [
                {
                  "step_id": "create-sub",
                  "service_slug": "new-azure-subscription",
                  "input": { "billing_account": "ba-123" }
                },
                {
                  "step_id": "create-rg",
                  "service_slug": "new-azure-resource-group",
                  "depends_on": ["create-sub"],
                  "input": {
                    "subscription_id": "${{ steps.create-sub.outputs.subscription_id }}"
                  }
                }
              ]
            }

      - name: Log execution ID
        run: echo "Execution started: ${{ steps.orch.outputs.execution_id }}"
```

#### Wait for Completion

```yaml
      - name: Submit and wait
        id: orch
        uses: zekt-dev-org/zekt-action@v3
        with:
          orchestrate: true
          wait: true          # Block until completed | failed | timed_out
          payload: |
            {
              "default_service_owner": "platform-team-org",
              "services": [
                {
                  "step_id": "create-sub",
                  "service_slug": "new-azure-subscription",
                  "input": { "billing_account": "ba-123" }
                },
                {
                  "step_id": "create-rg",
                  "service_slug": "new-azure-resource-group",
                  "depends_on": ["create-sub"],
                  "input": {
                    "subscription_id": "${{ steps.create-sub.outputs.subscription_id }}"
                  }
                }
              ]
            }

      - name: Use step outputs
        run: |
          echo "Status:          ${{ steps.orch.outputs.execution_status }}"
          echo "Subscription ID: ${{ steps.orch.outputs.step_create-sub_outputs_subscription_id }}"
          echo "Resource group:  ${{ steps.orch.outputs.step_create-rg_outputs_resource_group_name }}"
```

> ⏳ **Timeout:** When `wait: true`, the action polls every 30 seconds with no internal timeout cap. Set `timeout-minutes` on your job or step if you need a hard limit.

#### Per-Step Owner Override

```yaml
          payload: |
            {
              "default_service_owner": "platform-team-org",
              "services": [
                {
                  "step_id": "create-sub",
                  "service_slug": "new-azure-subscription",
                  "input": { "billing_account": "ba-123" }
                },
                {
                  "step_id": "create-dns",
                  "service_slug": "register-dns-zone",
                  "service_owner_name": "networking-team-org",
                  "depends_on": ["create-sub"],
                  "input": {
                    "subscription_id": "${{ steps.create-sub.outputs.subscription_id }}"
                  }
                }
              ]
            }
```

### Client-Side Validation

The action validates the orchestration payload **before** making any API call and fails with a descriptive error if:

- `services` is absent, empty, or has more than 20 items
- Any `step_id` is duplicated, contains invalid characters, or exceeds 64 chars
- Any `service_slug` does not match `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`
- A step has no resolvable service owner
- A `depends_on` entry references a `step_id` that does not exist in the request
- Any `input` is not a JSON object
- `payload` is not valid JSON

### Provider Workflow Integration (Automatic)

Provider service workflows that call `zekt-action` via `repository_dispatch` **require no changes**. When running inside such a workflow, the action automatically reads the orchestration context (`client_payload._zekt`) from the GitHub event file and forwards it to the backend as `orchestration_step_ref`. This links the provider run to the correct orchestration step transparently.

### API Endpoints Used

| Method | Path | When |
|--------|------|------|
| `POST` | `/api/events/receive` | `orchestrate: false` |
| `POST` | `/api/orchestration/submit` | `orchestrate: true` |
| `GET` | `/api/orchestration/{execution_id}/status` | `orchestrate: true` + `wait: true` |

---

## How It Works

1. **OIDC Token Request** — The action requests an OIDC token from GitHub with the `api://zekt` audience
2. **Authenticated Request** — The token is sent to the Zekt API in the `Authorization` header
3. **Event Distribution / Orchestration** — Zekt validates the token and either forwards your event to subscribed consumers, or dispatches the orchestration chain

```
┌─────────────────┐     OIDC Token      ┌─────────────────┐
│                 │ ◄───────────────────│                 │
│  GitHub Actions │                     │  GitHub OIDC    │
│  (Your Workflow)│                     │  Provider       │
└────────┬────────┘                     └─────────────────┘
         │
         │ Event / Orchestration Plan + Bearer Token
         ▼
┌─────────────────┐
│                 │
│    Zekt API     │ ──► Validates token
│                 │ ──► Distributes to consumers / dispatches service chain
└─────────────────┘
```

## Requirements

- **Permissions:** `id-token: write` must be set in your workflow
- **Repository:** Must be enabled in the Zekt platform

## Security

- 🔐 **No secrets to manage** — Authentication is automatic via OIDC
- ✅ **Token masking** — OIDC tokens are masked in logs
- 🔒 **Repository verification** — Backend validates token claims match the repository

## Migrating from Previous Versions

### From v2.x to v3.0.0

✅ **100% backward compatible** — no changes required for existing workflows.

v3.0.0 adds orchestration as an **opt-in** capability. Existing `event-type` + `payload` workflows continue to work without modification.

**Optional: Enable Orchestration**

```yaml
- uses: zekt-dev-org/zekt-action@v3
  with:
    orchestrate: true   # NEW: opt-in orchestration
    payload: |
      { "services": [ ... ] }
```

### From v1 to v2 / v3

**Before (v1):**
```yaml
- uses: zekt-dev-org/zekt-action@v1
  with:
    zekt_run_id: ${{ github.run_id }}
    zekt_payload: '{"data": "example"}'
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

**After (v3):**
```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: zekt-dev-org/zekt-action@v3
    with:
      event-type: 'custom-event'
      payload: '{"data": "example"}'
```

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Support

- 🐛 [Report Issues](https://github.com/zekt-dev-org/zekt-action/issues)
- 💬 [Discussions](https://github.com/zekt-dev-org/zekt-action/discussions)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.


## Features

- 🔐 **Zero Secrets** - No API keys or tokens to configure
- 🚀 **Simple Integration** - Just 1 required input
- ✅ **Automatic Authentication** - Uses GitHub OIDC tokens
- �️ **Shield Encryption** - Optional end-to-end payload encryption (v2.0.2+)
- �📋 **Job Summary** - Writes delivery status to workflow summary
- 📤 **Rich Context** - Automatically includes workflow metadata

## Quick Start

```yaml
name: Deploy Pipeline
on: [push]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # Required for OIDC authentication
      contents: read
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy application
        run: ./deploy.sh
      
      - name: Notify Zekt
        uses: zekt-dev-org/zekt-action@v2.0.2
        with:
          event-type: 'deployment-complete'
          payload: |
            {
              "version": "1.2.3",
              "environment": "production"
            }
```

> ⚠️ **Important:** The `permissions: id-token: write` is required for OIDC authentication to work.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `event-type` | ✅ Yes | - | The type of event to send (e.g., `deployment`, `release`, `build-complete`) |
| `payload` | No | `{}` | JSON payload to send with the event |
| `shield` | No | `false` | Enable end-to-end encryption of payload (requires consumers with Shield enabled) |
| `zekt-api-url` | No | `https://fxdevzektapp.azurewebsites.net` | Zekt API URL (for testing/staging) |

## Outputs

| Output | Description |
|--------|-------------|
| `event-id` | The unique ID of the sent event |
| `status` | Status of the event submission (`success` / `failed`) |
| `consumers-notified` | Number of consumers that will receive this event |

## Usage Examples

### Basic Usage

```yaml
jobs:
  notify:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: zekt-dev-org/zekt-action@v2
        with:
          event-type: 'build-complete'
```

### With Custom Payload

```yaml
- uses: zekt-dev-org/zekt-action@v2
  with:
    event-type: 'deployment'
    payload: |
      {
        "version": "${{ github.sha }}",
        "environment": "production",
        "deployed_by": "${{ github.actor }}"
      }
```

### Capture Outputs

```yaml
- name: Send Event
  id: zekt
  uses: zekt-dev-org/zekt-action@v2
  with:
    event-type: 'release'
    payload: '{"version": "2.0.0"}'

- name: Show Results
  run: |
    echo "Event ID: ${{ steps.zekt.outputs.event-id }}"
    echo "Status: ${{ steps.zekt.outputs.status }}"
    echo "Consumers: ${{ steps.zekt.outputs.consumers-notified }}"
```

### With Shield Encryption (v2.0.2+)

```yaml
- uses: zekt-dev-org/zekt-action@v2.0.2
  with:
    event-type: 'deployment'
    payload: |
      {
        "version": "1.0.0",
        "environment": "production",
        "secrets": {
          "api_key": "sensitive-data"
        }
      }
    shield: true  # Enables end-to-end encryption
```

> 🛡️ **Shield**: Encrypts payload with AES-256-GCM. Only subscribed consumers can decrypt using their private keys.

### Error Handling

```yaml
- name: Send to Zekt
  id: zekt
  uses: zekt-dev-org/zekt-action@v2.0.2
  with:
    event-type: 'notification'
    payload: '{"message": "Hello"}'
  continue-on-error: true

- name: Handle failure
  if: steps.zekt.outputs.status != 'success'
  run: echo "Event delivery failed!"
```

## How It Works

1. **OIDC Token Request**: The action requests an OIDC token from GitHub with the `api://zekt` audience
2. **Authenticated Request**: The token is sent to the Zekt API in the Authorization header
3. **Event Distribution**: Zekt validates the token and forwards your event to subscribed consumers

```
┌─────────────────┐     OIDC Token      ┌─────────────────┐
│                 │ ◄───────────────────│                 │
│  GitHub Actions │                     │  GitHub OIDC    │
│  (Your Workflow)│                     │  Provider       │
└────────┬────────┘                     └─────────────────┘
         │
         │ Event + Bearer Token
         ▼
┌─────────────────┐
│                 │
│    Zekt API     │ ──► Validates token
│                 │ ──► Forwards to consumers
└─────────────────┘
```

## Requirements

- **Permissions**: `id-token: write` must be set in your workflow
- **Repository**: Must be enabled in Zekt platform
- **Runner**: Ubuntu Linux (uses bash scripts)

## Security

- 🔐 **No secrets to manage** - Authentication is automatic via OIDC
- ✅ **Token masking** - OIDC tokens are masked in logs
- 🔒 **Repository verification** - Backend validates token claims match repository

## Migrating from Previous Versions

### From v1 to v2.0.2

**Before (v1):**
```yaml
- uses: zekt-dev-org/zekt-action@v1
  with:
    zekt_run_id: ${{ github.run_id }}
    zekt_payload: '{"data": "example"}'
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

**After (v2.0.2):**
```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: zekt-dev-org/zekt-action@v2.0.2
    with:
      event-type: 'custom-event'
      payload: '{"data": "example"}'
```

### From v2.0.1 to v2.0.2

✅ **Fully backward compatible** - no changes required!

v2.0.2 adds optional Shield encryption. Existing workflows work without modification.

**Optional: Enable Shield**
```yaml
- uses: zekt-dev-org/zekt-action@v2.0.2
  with:
    event-type: 'deployment'
    payload: '{"data": "example"}'
    shield: true  # NEW: Optional encryption
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 🐛 [Report Issues](https://github.com/zekt-dev-org/zekt-action/issues)
- 💬 [Discussions](https://github.com/zekt-dev-org/zekt-action/discussions)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.
