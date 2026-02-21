# Canonical Chat Paths (Architecture Guardrail)

The only chat UI used at runtime is under **`src/features/chat/`**. Legacy duplicate UI was quarantined under `src/_legacy_components_chat_DO_NOT_USE/` and must never be imported.

## Running the guard

From the frontend root (`myfrontend/frontend`):

```bash
npm run check:chat-paths
```

This runs `scripts/check_no_components_chat_imports.sh`, which scans all `.js`/`.jsx`/`.ts`/`.tsx` under `src/` (excluding paths under `docs/`) for any import of `components/chat` or `@/components/chat`.

- **Success:** Exit 0, prints `OK: No imports of components/chat in src (js/jsx/ts/tsx, excluding docs).`
- **Failure:** Exit 1, prints the list of files that still import the legacy path.

## If the check fails

1. **Do not** add or restore imports from `src/components/chat` or `@/components/chat`. That path was renamed to `src/_legacy_components_chat_DO_NOT_USE/` and is intentionally unimportable.

2. **Fix the failing file:** Use the canonical chat UI from `src/features/chat/` instead:
   - Chat root: `src/features/chat` (default export is ChatRoot)
   - Sidebar: `src/features/chat/ui/Sidebar`
   - ChatWindow: `src/features/chat/ui/ChatWindow`
   - GroupInfoPanel: `src/features/chat/ui/GroupInfoPanel`

3. If you intentionally need to reference the legacy folder (e.g. for a one-off migration or doc), do not add an import in source; the guard is there to keep the legacy tree unused. Prefer copying or moving code into `src/features/chat/` if it is still needed.

See also: `docs/FIXC_VERIFICATION.md` for how canonical chat was verified and how the guard was introduced.
