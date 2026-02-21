# Baseline Verification

**Phase 0 Baseline Documentation**  
**Last Updated:** 2026-02-03  
**Purpose:** Document the baseline verification script and how to use it.

---

## Verification Script

**File:** `scripts/verify-baseline.js`

**Purpose:** Non-intrusive verification of Phase 0 baseline state.

---

## What It Verifies

### 1. Entry Point Files
- `server.js` - Application entry point
- `app.js` - Express application setup
- `package.json` - Dependencies and scripts

### 2. Configuration Files
- `config/env.js` - Environment variable loader
- `config/env.validate.js` - Environment validation
- `config/constants.js` - Configuration constants
- `config/db.js` - Database adapter

### 3. Environment File
- `.env.example` - Environment variable template
- Validates that all required variables are documented

### 4. Core Directories
- `config/` - Configuration modules
- `websocket/` - WebSocket implementation
- `services/` - Business logic services
- `utils/` - Utility functions
- `http/` - HTTP routes and controllers
- `models/` - Data models
- `docs/` - Documentation

### 5. WebSocket Structure
- `websocket/index.js` - WebSocket entry point
- `websocket/router.js` - Message router
- `websocket/connection/wsServer.js` - WebSocket server
- `websocket/connection/lifecycle.js` - Connection lifecycle
- `websocket/state/` - State storage directory

### 6. Module Importability
- Tests that key modules can be imported (read-only)
- Verifies no syntax errors or missing dependencies
- Does not execute application logic

### 7. Documentation Files
- `docs/env-contract.md` - Environment variable contract
- `docs/config-map.md` - Configuration ownership map
- `docs/runtime-baseline.md` - Runtime baseline
- `docs/websocket-baseline.md` - WebSocket baseline
- `docs/folder-contract.md` - Folder contract

### 8. Environment Validation
- Verifies `config/env.validate.js` is loadable
- Confirms validation function exists

---

## What It Does NOT Do

**The script is NON-INTRUSIVE and will NOT:**

- ❌ Start servers
- ❌ Modify state
- ❌ Touch WebSocket logic
- ❌ Connect to database
- ❌ Change runtime flow
- ❌ Execute application code
- ❌ Modify files
- ❌ Run tests

**It only:**
- ✅ Checks file existence
- ✅ Validates directory structure
- ✅ Imports modules (read-only)
- ✅ Reads documentation files
- ✅ Validates environment file structure

---

## Usage

### Run Verification

```bash
# From backend directory
node scripts/verify-baseline.js

# Or make executable and run directly
chmod +x scripts/verify-baseline.js
./scripts/verify-baseline.js
```

### Expected Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 0 Baseline Verification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Entry Point Files
───────────────────────────────────────────────────────────────────────────────
✓ Entry point exists: server.js
✓ Entry point exists: app.js
✓ Entry point exists: package.json

2. Configuration Files
───────────────────────────────────────────────────────────────────────────────
✓ Config file exists: config/env.js
✓ Config file exists: config/env.validate.js
✓ Config file exists: config/constants.js
✓ Config file exists: config/db.js

[... more sections ...]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Verification Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Passed:  25
Warnings: 0
Failed:  0

✓ Baseline verification PASSED
ℹ All critical files and directories are present.
ℹ Modules are importable (read-only check).
ℹ Documentation is complete.
```

---

## Exit Codes

- **0** - Verification passed (all checks successful)
- **1** - Verification failed (one or more checks failed)

---

## Integration

### Pre-Commit Hook

The verification script can be used as a pre-commit hook to ensure baseline integrity:

```bash
#!/bin/sh
# .git/hooks/pre-commit

node scripts/verify-baseline.js
if [ $? -ne 0 ]; then
  echo "Baseline verification failed. Commit aborted."
  exit 1
fi
```

### CI/CD Pipeline

Include in CI/CD pipeline to verify baseline before deployment:

```yaml
# Example GitHub Actions
- name: Verify Baseline
  run: node scripts/verify-baseline.js
```

---

## When to Run

- **After Phase 0:** Verify baseline is complete
- **Before Refactoring:** Ensure baseline state is known
- **After File Moves:** Verify structure is intact
- **Before Deployment:** Confirm all files present

---

## Notes

- **Read-Only:** Script does not modify any files
- **Non-Intrusive:** Does not execute application logic
- **Fast:** Completes in seconds (no network/DB calls)
- **Safe:** Can be run at any time without side effects

---

## Troubleshooting

### Module Import Errors

If module import fails:
- Check that dependencies are installed (`npm install`)
- Verify file paths are correct
- Check for syntax errors in imported modules

### Missing Files

If files are missing:
- Verify you're in the correct directory (`backend/`)
- Check that Phase 0 documentation was created
- Ensure all required files exist

### False Positives

If verification passes but issues exist:
- Review individual check outputs
- Manually verify file contents
- Check for hidden files or permissions issues

---

## Future Enhancements (Out of Scope for Phase 0)

- Validate file contents (not just existence)
- Check import paths are correct
- Verify environment variable usage matches documentation
- Validate configuration values are within bounds
- Check for circular dependencies

**All of the above are FORBIDDEN in Phase 0.**
