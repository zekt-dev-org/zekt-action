# Security Policy

## GitHub Token Protection

This repository implements multiple layers of security to prevent accidental token leaks to GitHub.

### Pre-Commit Hook Protection

A Husky pre-commit hook (`.husky/pre-commit`) automatically blocks commits containing potential GitHub token leaks.

**Protected patterns:**
- GitHub token formats: `ghp_*`, `gho_*`, `ghs_*`, `ghu_*` (each with 36 alphanumeric characters)
- Logging calls with token variables: `console.log()`, `core.info()`, `core.debug()`, `core.warning()`, `core.error()`
- Direct logging of `GITHUB_TOKEN` or `github_token` variables

**Files checked:**
- `src/` - Production TypeScript source code
- `action.yml` - Action configuration
- `package.json` - Dependencies and scripts

**Files excluded:**
- `dist/` - Bundled webpack code (contains redaction utilities and test strings)
- `tests/` - Test files (contains safe mock tokens like `ghp_test123`)
- `node_modules/` - Third-party dependencies

### Token Handling Best Practices

1. **Authorization Header Only**
   - The GitHub token is passed only in the `Authorization: Bearer <token>` HTTP header
   - Never included in request body, URL parameters, or logs
   - Location: `src/api-client.ts`

2. **Error Message Redaction**
   - All error messages are processed through `redactSensitiveInfo()` before logging
   - Replaces actual token values with `[REDACTED]` placeholders
   - Location: `src/utils.ts`

3. **Environment Variables**
   - Token is accessed via GitHub Actions `core.getInput('github_token')` only
   - Never hardcoded or stored in configuration files
   - Location: `src/run.ts`

4. **No Mock Tokens in Source**
   - Mock tokens (`ghp_test123`, etc.) appear only in test files
   - Production code contains no test tokens or placeholder values
   - All references to token patterns in source code are in regex patterns for detection/redaction

### Git Security Verification

```bash
# Verify no actual tokens are committed (safe to run)
git grep -i "ghp_[a-z0-9]\{36\}" -- ':!tests' ':!node_modules' ':!dist'

# All matches should be regex patterns (detection) or redaction functions (utils.ts)
```

### Testing Token Redaction

Token redaction is covered by comprehensive tests in `tests/utils.test.ts`:

- ✅ `redactSensitiveInfo()` redacts `ghp_*` tokens
- ✅ `redactSensitiveInfo()` redacts `gho_*` tokens
- ✅ `redactSensitiveInfo()` redacts `ghs_*` tokens
- ✅ `redactSensitiveInfo()` redacts `ghu_*` tokens
- ✅ `redactSensitiveInfo()` redacts Bearer tokens in Authorization headers
- ✅ Token strings are removed from error messages before logging

Run tests with: `npm test`

### Deployment Considerations

1. **Never commit `.env` files** - Already configured in `.gitignore`
2. **Use GitHub Secrets** - Store `GITHUB_TOKEN` as a repository secret
3. **Verify logs in Actions** - Check that token values don't appear in GitHub Actions logs
4. **Review PRs carefully** - Use pre-commit hook message as guide for manual review

### Release Process

1. All commits must pass pre-commit security checks
2. Use semantic versioning: `git tag vX.Y.Z`
3. Push tags to GitHub: `git push --tags`
4. GitHub Actions workflows handle building and publishing

### Questions or Security Issues?

If you discover a potential security issue:
1. Do NOT create a public GitHub issue
2. Follow GitHub's responsible disclosure policy
3. Use GitHub's security advisory system to report privately

---

**Last Updated:** 2024
**Zekt Action Version:** 1.0.0
