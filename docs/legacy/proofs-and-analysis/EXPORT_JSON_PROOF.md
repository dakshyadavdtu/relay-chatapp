# Export JSON Bug — Phase 1 Proof Note

**Bug:** Settings → Preferences → Export Chat History: PDF downloads; JSON never downloads (or PDF still downloads when JSON is selected).

**Goal:** Prove the exact failure point with hard evidence.

---

## 1. Code Verification (Done)

### Frontend — Preferences export UI
- **File:** `myfrontend/frontend/src/features/settings_ui/PreferencesPage.jsx`
- **State:** `exportFormat` is `useState("pdf")`; Format options call `setExportFormat("pdf")` / `setExportFormat("json")`.
- **handleExport:** `const fn = exportFormat === "json" ? exportChatJson : exportChatPdf`; then `await fn(backendChatId)`.
- **Conclusion:** When user selects "JSON Data" and clicks "Start Export", `exportFormat` should be `"json"` and `exportChatJson(backendChatId)` should be called.

### Frontend — API
- **File:** `myfrontend/frontend/src/features/chat/api/chat.api.js`
- **exportChatJson:** Builds URL `{origin}/api/export/chat/{encodeURIComponent(chatId)}.json` and `fetch(url, { method: "GET", credentials: "include" })`.
- **exportChatPdf:** Same pattern with `.pdf`.
- **Conclusion:** JSON export should request a URL ending in `.json`; PDF in `.pdf`.

### Backend — Routes
- **File:** `backend/http/routes/export.routes.js`
- **Routes:**
  - `GET /chat/:chatId.json` → `exportController.exportChatJson`
  - `GET /chat/:chatId.pdf`  → `exportController.exportChatPdf`
- **Mount:** `backend/http/index.js`: `httpRouter.use('/export', exportRoutes);`
- **App mount:** `backend/app.js`: `app.use('/api', httpRouter);`
- **Full paths:** `GET /api/export/chat/:chatId.json` and `GET /api/export/chat/:chatId.pdf`.

### Backend — Controller
- **File:** `backend/http/controllers/export.controller.js`
- **exportChatJson:** Sets `Content-Type: application/json`, `Content-Disposition: attachment; filename="chat_...json"`, sends JSON body.
- **exportChatPdf:** Sets `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="chat_...pdf"`, pipes PDF.

---

## 2. TEMP Debug Logs Added (Remove in Phase 2)

- **PreferencesPage.jsx** (in `handleExport`):
  - `[export] exportFormat=`
  - `[export] fn=` (exportChatJson vs exportChatPdf)
  - `[export] backendChatId=`
- **chat.api.js** (in `exportChatJson`):
  - `[export] exportChatJson URL=`
  - `[export] exportChatJson res.status= ... Content-Type= ... Content-Disposition=`
- **export.controller.js** (in both handlers):
  - `[export] hit exportChatJson` / `[export] hit exportChatPdf` with `{ chatId, userId }`

---

## 3. Reproduction — Fill After Running

**Steps:** Open Settings → Preferences → Export Chat History → select **JSON Data** → click **Start Export**.

### 3.1 URL actually called when JSON is selected
```
(Fill from DevTools → Network: select the export request, copy Request URL)
```
**Example expected:** `http://localhost:5173/api/export/chat/direct%3Auser1%3Auser2.json` (or your origin + path ending in `.json`).

### 3.2 Frontend console logs (when JSON selected, Start Export clicked)
```
[export] exportFormat= ???
[export] fn= ???
[export] backendChatId= ???
[export] exportChatJson URL= ???   (only if fn was exportChatJson)
[export] exportChatJson res.status= ??? Content-Type= ??? Content-Disposition= ???
```

### 3.3 Backend server logs
```
[export] hit exportChatJson ???   OR   [export] hit exportChatPdf ???
```
(Only one should appear per request.)

### 3.4 Response headers for the export request
```
Content-Type: ???
Content-Disposition: ???
```

---

## 4. Root Cause (Single Most Likely)

**To be set after reproduction.** Pick one:

- **A. State not updating:** `exportFormat` stays `"pdf"` when user selects JSON (e.g. stale closure, or dialog remount resetting state) → frontend always calls `exportChatPdf` and requests `.pdf`.
- **B. Wrong URL:** Frontend requests `.pdf` even when `exportFormat === "json"` (bug in URL construction or wrong function reference).
- **C. Backend route not hit:** Request has `.json` but backend matches `.pdf` or 404 (routing/ordering or proxy stripping extension).
- **D. Backend returns wrong content:** `exportChatJson` is hit but response has `Content-Type: application/pdf` or PDF body (controller bug).
- **E. Download handling:** Response is correct JSON but frontend treats it as PDF or filename/Blob handling forces PDF download (e.g. wrong `a.download` or blob type).

**Most likely from code review:** **A** (exportFormat not updating when JSON is selected) or **E** (download/filename handling). Reproduction will confirm which.

---

## 5. Next Step (Phase 2)

- Remove all TEMP debug logs (marked with "TEMP Phase 1 debug: remove in Phase 2").
- Fix the root cause identified above.
