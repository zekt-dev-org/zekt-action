# Changelog

All notable changes to the Zekt Action will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.2] - 2026-01-23

### Added
- **Shield Encryption** - Optional end-to-end payload encryption using hybrid cryptography (AES-256-GCM + RSA-OAEP)
- New `shield` input parameter (optional, default: `false`)
- POST `/api/shield/keys` endpoint integration to fetch consumer public keys
- Automatic workflow path extraction from GitHub context
- Shield envelope structure for encrypted payloads
- TypeScript migration from bash composite action
- Node.js 20 runtime (replacing bash scripts)
- Comprehensive type definitions for all API contracts
- Enhanced error handling with specific Shield-related error messages
- Job summary now shows Shield status

### Changed
- **Action runtime**: Changed from `composite` (bash) to `node20` (JavaScript)
- **API client**: Migrated from `curl` to `@actions/http-client`
- **OIDC handling**: Now uses `core.getIDToken()` instead of manual curl
- **Payload processing**: Native JSON handling instead of `jq`
- Action is now built with `@vercel/ncc` (bundled JavaScript)
- API URL default updated to `https://fxdevzektapp.azurewebsites.net`

### Dependencies
- Added `@actions/core` ^1.10.1
- Added `@actions/github` ^6.0.0
- Added `@actions/http-client` ^2.2.0
- Added `node-rsa` ^1.1.1
- Added TypeScript development toolchain

### Security
- Shield encryption uses industry-standard cryptography:
  - AES-256-GCM for symmetric encryption
  - RSA-OAEP with SHA-256 for key encryption
  - Unique AES key generated per event
  - Automatic key masking in logs

### Backward Compatibility
✅ **100% backward compatible** with v2.0.1 - Shield is opt-in only

### Migration
No changes required when upgrading from v2.0.1 to v2.0.2.
To use Shield encryption, add `shield: true` to your workflow.

## [2.0.0] - 2025-12-05

### ⚠️ BREAKING CHANGES
- **Complete rewrite** - Action is now a composite action using bash scripts
- **Zero-secret authentication** - Uses GitHub OIDC tokens instead of `GITHUB_TOKEN`
- **New inputs** - `event-type` (required), `payload`, `zekt-api-url` replace old inputs
- **New outputs** - `event-id`, `status`, `consumers-notified` replace old outputs
- **Required permission** - Workflows must set `permissions: id-token: write`
- **Removed TypeScript** - No longer a Node.js action

### Added
- GitHub OIDC authentication for zero-secret usage
- Automatic OIDC token request and handling
- Token masking in workflow logs
- Job summary with event delivery details
- Rich workflow context sent with each event (repository, actor, sha, ref, workflow)
- New API endpoint: `POST /api/events/receive`

### Removed
- TypeScript source code and bundled JavaScript
- `zekt_run_id`, `zekt_step_id`, `zekt_payload`, `github_token` inputs
- `success`, `run_id`, `step_id`, `error_message` outputs
- Node.js tooling (package.json, tsconfig.json, Jest, etc.)
- Pre-commit hooks (no longer needed)
- Coverage requirements and unit tests

### Migration Guide
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

## [1.0.0] - 2025-11-26

### Added
- Initial release of Zekt Action
- Send custom JSON payloads from GitHub workflows to Zekt backend
- Payload validation (max 512 KB)
- Warning at 80% payload capacity (400 KB)
- Automatic retry logic with exponential backoff (max 3 attempts)
- Support for multiple steps in same workflow via `zekt_step_id`
- Comprehensive error handling and user-friendly error messages
- Pre-commit hooks to prevent GitHub token leaks
- TypeScript implementation with full type safety
- Jest test suite with >90% coverage
- GitHub Actions workflows for CI/CD
- Integration tests
- Detailed documentation and usage examples

### Security
- Token redaction in error messages
- Pre-commit hooks scan for token patterns
- Secure Authorization header handling
- No token logging anywhere in codebase

[Unreleased]: https://github.com/zekt-dev-org/zekt-action/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/zekt-dev-org/zekt-action/releases/tag/v2.0.0
[1.0.0]: https://github.com/zekt-dev-org/zekt-action/releases/tag/v1.0.0
