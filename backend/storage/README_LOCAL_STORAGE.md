# Local runtime storage

The `_data/` directory under this folder is used at runtime for:

- **uploads** — `_data/uploads/` (user-uploaded images; served at `/uploads`)
- **file-backed message store (dev only)** — `_data/messages.json` when `MESSAGE_STORE=file` and `NODE_ENV !== 'production'`. Production must use MongoDB only; the app throws at startup if file store is requested in production.

**Do not commit `_data/` or its contents.** It is ignored via `backend/.gitignore`.  
Create `_data/uploads` locally with `mkdir -p backend/storage/_data/uploads` if needed.
