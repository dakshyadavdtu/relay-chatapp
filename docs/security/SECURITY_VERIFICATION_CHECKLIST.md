# Security verification checklist

Use this after any security-related change or before release to confirm no secrets are in the working tree and guardrails are in place.

---

## 1. Working tree scan (no secrets)

Run from **repo or project root**:

```bash
# MongoDB URIs with real-looking credentials (placeholders like <USER>:<PASSWORD> are OK)
rg -n 'mongodb\+srv://[^"'\''\s]+:[^"'\''\s]+@' . -g '!.git/' 2>/dev/null \
  | grep -v -E '<USER>|<PASSWORD>|<HOST>|<DB>|USER:PASSWORD|placeholder|literal:==' || true
# Expected: empty (no output)

# AWS key pattern
rg -n 'AKIA[0-9A-Z]{16}' . -g '!.git/' 2>/dev/null
# Expected: no matches
```

**Result (Phase 5 final):** rg MongoDB scan PASS (no real URIs); rg AWS scan: no matches.

---

## 2. Gitleaks (CI)

On every push and pull_request, the **secret-scan** job runs:

1. **Gitleaks** — full history and working tree; fails the job if secrets are detected.
2. **rg fallback** — MongoDB URI and AWS key patterns; fails if real-looking credentials are found (placeholders excluded).

Both must pass for CI to be green.

---

## 3. Pre-commit hook (local)

Install so commits are blocked if they contain secrets:

```bash
./scripts/install-git-hooks.sh
```

The hook blocks:

- Staged files: `storage/_data/users.json`, `storage/_data/*.json`, `*.pem`, `*.key`, `*.p12`
- Staged content: `mongodb+srv://` with credentials (not placeholders), `DB_URI=` with real values, `BEGIN PRIVATE KEY`, AWS key pattern

---

## 4. Templates and policy

- **backend/.env.example** — "NEVER COMMIT REAL VALUES" block; `DB_URI` placeholder in comments; `REFRESH_PEPPER` listed; required production vars documented.
- **docs/config/ENV_TEMPLATE.md** — Same warning; `DB_URI` example; production required list includes `REFRESH_PEPPER`.
- **docs/runbooks/SECRETS_POLICY.md** — Where secrets must come from; no secrets in repo.

---

## 5. Quick checklist

- [ ] `rg` scan (MongoDB + AWS) returns no real credentials in working tree.
- [ ] CI **secret-scan** job passes (gitleaks + rg).
- [ ] Pre-commit hook installed (`./scripts/install-git-hooks.sh`).
- [ ] No `.env` or real `DB_URI`/passwords in repo; `backend/.env` is gitignored.
- [ ] Production required vars (including `REFRESH_PEPPER`) documented and injected via env/secret manager.
