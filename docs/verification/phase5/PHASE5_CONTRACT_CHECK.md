# Phase 5.5: Contract Enforcement Check

The `verify:contract` script compares `backend/CONTRACT.json` with `myfrontend/frontend/src/contracts/coverage.json` and fails if coverage is incomplete or handler files are missing.

## What it checks

1. **WS incoming types** — Every backend `websocket.incomingMessageTypes` type exists in `coverage.websocket.incoming`.
2. **WS outgoing types** — Every backend `websocket.outgoingMessageTypes` type exists in `coverage.websocket.outgoing`.
3. **HTTP endpoints** — Every backend HTTP endpoint exists in `coverage.http`. Chat-related endpoints (e.g. `/me`, `/chats`, `/chat`, `/sessions/*`, `/admin/*`) must be present.
4. **Handler files** — For entries with `handled: true`, if `handlerPath` includes a path like `src/...`, that file must exist.

## How to run

From the frontend root:

```bash
cd myfrontend/frontend
npm run verify:contract
```

Or from the project root:

```bash
cd myfrontend/frontend && npm run verify:contract
```

## Expected output

- **Pass:** `Contract coverage verification PASSED.`
- **Fail:** Lists missing types/endpoints or missing handler files, exits with code 1.

## CI integration

Add to your CI pipeline (e.g. GitHub Actions):

```yaml
- name: Verify contract coverage
  run: npm run verify:contract
  working-directory: myfrontend/frontend
```

## Simulating a failure (do not commit)

To confirm the script fails when coverage is broken:

1. **Missing WS type:** Temporarily remove a type from `coverage.json` (e.g. delete the `ROOM_MESSAGE` key from `websocket.outgoing`). Run `npm run verify:contract` — it should fail.
2. **Missing handler file:** Temporarily change a `handlerPath` to a non-existent file (e.g. `"src/lib/nonexistent.js"`). Run `npm run verify:contract` — it should fail.
3. Restore the changes before committing.
