# Changelog

All notable changes to the Zekt Action will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/zekt-dev-org/zekt-action/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/zekt-dev-org/zekt-action/releases/tag/v1.0.0
