# Zekt Event Action

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Send workflow events to the Zekt broker for distribution to consumers. **No secrets required** - uses GitHub's built-in OIDC for authentication.

## Features

- 🔐 **Zero Secrets** - No API keys or tokens to configure
- 🚀 **Simple Integration** - Just 1 required input
- ✅ **Automatic Authentication** - Uses GitHub OIDC tokens
- 📋 **Job Summary** - Writes delivery status to workflow summary
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
        uses: zekt-dev-org/zekt-action@v2
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
| `zekt-api-url` | No | `https://zekt-customer-api.azurewebsites.net` | Zekt API URL (for testing/staging) |

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

### Error Handling

```yaml
- name: Send to Zekt
  id: zekt
  uses: zekt-dev-org/zekt-action@v2
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

## Migrating from v1

If you were using v1 with secrets:

**Before (v1):**
```yaml
- uses: zekt-dev-org/zekt-action@v1
  with:
    zekt_run_id: ${{ github.run_id }}
    zekt_payload: '{"data": "example"}'
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

**After (v2):**
```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: zekt-dev-org/zekt-action@v2
    with:
      event-type: 'custom-event'
      payload: '{"data": "example"}'
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 🐛 [Report Issues](https://github.com/zekt-dev-org/zekt-action/issues)
- 💬 [Discussions](https://github.com/zekt-dev-org/zekt-action/discussions)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.
