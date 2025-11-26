# Zekt Event Publisher

[![Build Status](https://github.com/zekt-dev-org/zekt-action/workflows/Build%20and%20Test/badge.svg)](https://github.com/zekt-dev-org/zekt-action/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Send custom event payloads from GitHub workflows to the Zekt orchestration platform. This action enables provider workflows to communicate custom data to consumer repositories through the Zekt event distribution system.

## Features

- ✅ **Simple Integration** - Just 3 required inputs to get started
- ✅ **Payload Validation** - Automatic JSON validation and size checking (512 KB limit)
- ✅ **Smart Warnings** - Alerts at 80% payload capacity (400 KB)
- ✅ **Automatic Retries** - Exponential backoff for transient failures
- ✅ **Multi-Step Support** - Register multiple events from the same workflow
- ✅ **Type Safe** - Built with TypeScript for reliability
- ✅ **Secure** - Pre-commit hooks prevent token leaks

## Quick Start

```yaml
name: CI Pipeline
on: [push]

jobs:
  build-and-notify:
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
                "failed": 0
              },
              "coverage": "87%"
            }
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `zekt_run_id` | ✅ Yes | - | GitHub workflow run ID. Use `${{ github.run_id }}` |
| `zekt_payload` | ✅ Yes | - | Custom JSON payload (max 512 KB) |
| `github_token` | ✅ Yes | - | GitHub token. Use `${{ secrets.GITHUB_TOKEN }}` |
| `zekt_step_id` | No | `default` | Unique step identifier for multiple actions in same workflow |
| `zekt_api_url` | No | `https://api.zekt.dev/api/zekt/register-run` | API endpoint (override for testing) |

## Outputs

| Output | Description |
|--------|-------------|
| `success` | Whether the payload was successfully registered (`true`/`false`) |
| `run_id` | The workflow run ID that was registered |
| `step_id` | The step ID that was registered |
| `error_message` | Error message if registration failed (empty on success) |

## Usage Examples

### Basic Usage

```yaml
- uses: zekt-dev-org/zekt-action@v1
  with:
    zekt_run_id: ${{ github.run_id }}
    zekt_payload: '{"status": "success", "version": "1.2.3"}'
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Multiple Steps in Same Workflow

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Build
        run: npm run build
      
      - name: Notify build complete
        uses: zekt-dev-org/zekt-action@v1
        with:
          zekt_run_id: ${{ github.run_id }}
          zekt_step_id: ${{ github.job }}-build
          zekt_payload: '{"status": "built", "artifact": "build-123.tar.gz"}'
          github_token: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Deploy
        run: ./deploy.sh
      
      - name: Notify deploy complete
        uses: zekt-dev-org/zekt-action@v1
        with:
          zekt_run_id: ${{ github.run_id }}
          zekt_step_id: ${{ github.job }}-deploy
          zekt_payload: '{"status": "deployed", "environment": "production"}'
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Complex Payload with Multi-line YAML

```yaml
- uses: zekt-dev-org/zekt-action@v1
  with:
    zekt_run_id: ${{ github.run_id }}
    zekt_payload: |
      {
        "build": {
          "status": "success",
          "duration_seconds": 142,
          "artifact_url": "https://example.com/artifact.tar.gz"
        },
        "tests": {
          "passed": 156,
          "failed": 0,
          "coverage": "94.2%"
        },
        "metadata": {
          "branch": "${{ github.ref_name }}",
          "commit": "${{ github.sha }}",
          "actor": "${{ github.actor }}"
        }
      }
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Error Handling

```yaml
- name: Send to Zekt
  id: zekt
  uses: zekt-dev-org/zekt-action@v1
  with:
    zekt_run_id: ${{ github.run_id }}
    zekt_payload: '{"data": "example"}'
    github_token: ${{ secrets.GITHUB_TOKEN }}
  continue-on-error: true

- name: Handle Zekt failure
  if: steps.zekt.outputs.success != 'true'
  run: |
    echo "Failed to send to Zekt: ${{ steps.zekt.outputs.error_message }}"
    # Continue with workflow or fail
```

## Payload Size Limits

- **Maximum:** 512 KB (524,288 bytes)
- **Warning threshold:** 400 KB (80% of maximum)
- The action will automatically warn you if your payload exceeds 400 KB
- Payloads over 512 KB will be rejected

## Error Handling & Retries

The action automatically retries failed requests:
- **Max retries:** 3 attempts
- **Backoff strategy:** Exponential (1s, 2s, 4s)
- **Retryable errors:** 5xx server errors, 429 rate limits, network failures
- **Non-retryable errors:** 401 unauthorized, 403 forbidden, 400 bad request

## Security

- ⚠️ **Never log your GitHub token** - The action automatically redacts tokens from error messages
- ✅ Pre-commit hooks scan for potential token leaks
- ✅ Tokens are only used in Authorization headers
- ✅ Error messages sanitize sensitive information

## Development

### Prerequisites

- Node.js 20.x
- npm

### Setup

```bash
# Clone repository
git clone https://github.com/zekt-dev-org/zekt-action.git
cd zekt-action

# Install dependencies
npm install

# Run tests
npm test

# Build action
npm run build

# Run linter
npm run lint

# Format code
npm run format
```

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Coverage must be >90%
```

### Building

```bash
# Compile TypeScript and bundle with dependencies
npm run build

# IMPORTANT: Commit dist/index.js
git add dist/index.js
git commit -m "build: update bundle"
```

⚠️ **Critical:** The `dist/index.js` file MUST be committed to Git for the action to work.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Build the action (`npm run build`)
6. Commit your changes (pre-commit hooks will run)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 📖 [Full Specification](SPECIFICATION.md)
- 🐛 [Report Issues](https://github.com/zekt-dev-org/zekt-action/issues)
- 💬 [Discussions](https://github.com/zekt-dev-org/zekt-action/discussions)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.
