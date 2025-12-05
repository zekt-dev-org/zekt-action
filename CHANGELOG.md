# Changelog

All notable changes to the Zekt Action will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
