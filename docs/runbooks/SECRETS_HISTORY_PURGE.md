# Purging leaked secrets from Git history (critical)

If secrets were ever committed, they remain in history until you rewrite it. Redacting files in the current commit is not enough—anyone with a clone or access to history can still see the old content.

---

## 1. Determine if secrets were ever committed

**Note:** In the commands below, replace `<YOUR_DB_USER>`, `<YOUR_PASSWORD>`, `<YOUR_CLUSTER_HOST>` with the actual literal strings you need to search for (e.g. a leaked DB username, password, or cluster host). Do not commit real values in this file.

Run from your **repository root** (the directory that contains `backend/` or your project root):

```bash
# Paths relative to repo root — adjust if your layout differs (e.g. backend/ at root vs. project/backend/)
git log -p -- backend/verify-realtime-delivery.md backend/scripts/verify-delivery-fix.sh backend/.env backend/storage/_data/users.json 2>/dev/null \
  | rg -n "<YOUR_DB_USER>|<YOUR_PASSWORD>|<YOUR_CLUSTER_HOST>|mongodb\+srv://" || echo "No matches in history"
```

Or search the entire history for the secret string:

```bash
git log -p --all -S "<YOUR_DB_USER>" 2>/dev/null | rg -n "<YOUR_DB_USER>|<YOUR_PASSWORD>|<YOUR_CLUSTER_HOST>" || echo "No matches"
```

- **If you see matches:** history rewrite is **required**. Proceed to section 2.
- **If "No matches":** secrets were not committed in this repo’s history. You can skip rewrite but should still rotate any credentials that may have been exposed elsewhere (e.g. from a different clone or copy).

### Scan result (this repo)

When this procedure was prepared, the following was run from the repo root:

```bash
git log -p -- backend/verify-realtime-delivery.md backend/scripts/verify-delivery-fix.sh backend/.env backend/storage/_data/users.json 2>/dev/null \
  | rg -n "<YOUR_DB_USER>|<YOUR_PASSWORD>|<YOUR_CLUSTER_HOST>|mongodb\+srv://" || echo "No matches in history"
```

**Output:** `No matches in history`

```bash
git log -p --all -S "<YOUR_DB_USER>" 2>/dev/null | rg -n "<YOUR_DB_USER>|<YOUR_PASSWORD>|<YOUR_CLUSTER_HOST>" || echo "No matches"
```

**Output:** (exit code 1, no output) — no occurrences in full history.

So **no secret patterns were found in the scanned history** for this clone. Replace `<YOUR_DB_USER>`, `<YOUR_PASSWORD>`, `<YOUR_CLUSTER_HOST>` with the literal strings you need to search for (e.g. your DB username, password, cluster host). If your clone has different history (e.g. you committed the sensitive files in another branch or repo), run the scan again and perform the rewrite if needed.

---

## 2. Tool: git filter-repo (recommended)

[git-filter-repo](https://github.com/newren/git-filter-repo) is the recommended way to rewrite history. Install it (e.g. `pip install git-filter-repo` or your system package manager).

### 2.1 Backup before rewriting

```bash
# From repo root
git tag backup-before-secrets-purge
git branch backup-before-secrets-purge
# Optional: push backup to a remote so you have an off-site copy
# git push origin backup-before-secrets-purge
```

### 2.2 Replacements file (redact literal strings)

Create a file `replacements.txt` in the repo root (or a temp dir) with one replacement per line. Use `literal:` so the search is exact (no regex). **Replace the placeholders below with the actual leaked strings you need to redact** (never commit real credentials here):

```
literal:<LEAKED_DB_USERNAME>==><REDACTED_USER>
literal:<LEAKED_PASSWORD>==><REDACTED_PASSWORD>
literal:<LEAKED_CLUSTER_HOST>==><REDACTED_HOST>
```

To replace a full MongoDB URI with a placeholder (single line; adjust the literal to match the exact string that appeared in history):

```
literal:mongodb+srv://<USER>:<PASSWORD>@<HOST>/<DB>==>mongodb+srv://<USER>:<PASSWORD>@<HOST>/<DB>?<OPTIONS>
```

If the URI appears with small variations (e.g. different options), add one `literal:...==>...` line per variant, or run multiple passes.

### 2.3 Remove sensitive paths from history

These paths must never appear in history; remove them entirely (so every commit that had them will no longer contain those files):

- `backend/.env`
- `backend/storage/_data/users.json`
- `backend/storage/_data/` (and everything under it)

### 2.4 Exact filter-repo commands

Run from the **repository root** (directory that contains `backend/`). Paths are relative to repo root.

```bash
# 1) Replace literal strings in all files (using replacements.txt from current dir)
git filter-repo --replace-text replacements.txt --force

# 2) Remove sensitive paths from all history (invert: keep everything except these)
git filter-repo --invert-paths --path backend/.env --path backend/storage/_data/users.json --path backend/storage/_data/ --force
```

To do both in one pass (replace text and remove paths):

```bash
git filter-repo --replace-text replacements.txt \
  --invert-paths --path backend/.env --path backend/storage/_data/users.json --path backend/storage/_data/ \
  --force
```

**Important:** `--force` is required when running filter-repo on a repo that already has a filter-repo run or on the current clone. Only run this on a **fresh clone** or after backing up; it rewrites all commits.

### 2.5 If your repo root is not the project root

If your repo has the project under a subdirectory (e.g. `project/backend/`), use those paths:

```bash
git filter-repo --replace-text replacements.txt \
  --invert-paths --path project/backend/.env --path project/backend/storage/_data/users.json --path project/backend/storage/_data/ \
  --force
```

---

## 3. Alternative: BFG Repo-Cleaner

If you prefer [BFG](https://rtyley.github.io/bfg-repo-cleaner/):

- **Replace strings:** BFG does not do generic text replacement; it is focused on passwords in files. For simple replacement you can use `git filter-branch` with a tree filter (slower and less safe than filter-repo) or stick with filter-repo for replacements.
- **Delete files from history:** BFG can remove files by name:
  - Create a file listing paths to delete (e.g. `paths-to-delete.txt` with `backend/.env`, `backend/storage/_data/users.json`), then:
  - `bfg --delete-files paths-to-delete.txt` (exact syntax see BFG docs; often `--delete-files` with globs).

For this procedure we recommend **git filter-repo** for both replacement and path removal.

---

## 4. After rewrite: cleanup and verification

### 4.1 Remove backup refs (if any)

```bash
git for-each-ref --format="%(refname)" refs/original/
# If any refs appear, delete them:
git for-each-ref --format="%(refname)" refs/original/ | xargs -r -n1 git update-ref -d
```

### 4.2 Expire reflog and run GC

```bash
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### 4.3 Re-scan full history (must be zero matches)

```bash
git log -p --all 2>/dev/null | rg "<YOUR_DB_USER>|<YOUR_PASSWORD>|<YOUR_CLUSTER_HOST>" || echo "No matches (clean)"
```

You must see **No matches (clean)**. If any match appears, repeat the replacement step with the correct literal string or path.

### 4.4 Confirm sensitive paths are gone from history

```bash
git log -p --all -- backend/.env backend/storage/_data/ 2>/dev/null | head -20
# Should show no content (or “no commits”); those paths must not exist in any commit.
```

---

## 5. Force-push and collaborator instructions

History rewrite changes commit SHAs. All branches that contained the old history must be force-pushed; collaborators must reclone or reset.

### 5.1 Force-push (after rewrite)

```bash
# Replace origin and main with your remote and default branch name
git push origin --force --all
git push origin --force --tags
```

If you created a backup tag/branch and pushed it, consider deleting it from the remote after everyone has moved to the new history (or keep it only on a private backup remote).

### 5.2 Collaborators

- **Do not** `git pull` on an existing clone that still has the old history—it will merge or create a mess.
- **Reclone** the repo into a new directory and use that, or:
  - `git fetch origin`
  - `git reset --hard origin/main` (or the branch they use), accepting that local commits on the old history are lost unless re-applied.

---

## 6. Summary

| Step | Action |
|------|--------|
| 1 | Run the detection commands; if secrets appear in history, rewrite is required. |
| 2 | Backup: `git tag` and/or `git branch` (and optionally push). |
| 3 | Create `replacements.txt` with `literal:old==>new` for each secret string (and full URI if desired). |
| 4 | Run `git filter-repo --replace-text replacements.txt --invert-paths --path backend/.env --path backend/storage/_data/users.json --path backend/storage/_data/ --force`. |
| 5 | Expire reflog, run `git gc --prune=now --aggressive`. |
| 6 | Re-scan history; confirm zero matches. |
| 7 | Force-push all branches and tags; tell collaborators to reclone or reset. |
| 8 | Rotate the exposed credentials (MongoDB password, etc.) in the live system. |

**Constraints:** Do not delete or rewrite history beyond the sensitive paths and the literal replacements above. The backup branch/tag lets you recover if something goes wrong.
