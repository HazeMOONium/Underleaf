# Underleaf — Pending Features Plan
_Last updated: 2026-02-23_

## Already Done (from user's list)
- [x] Rename files (backend + FileTree double-click)
- [x] Rename projects (Dashboard pencil icon)
- [x] Delete files (FileTree × button)
- [x] Delete projects (Dashboard × button)
- [x] Ctrl+S saves file (prevents browser save-as)
- [x] Interactive file outline with section hyperlinks (DocumentOutline.tsx)
- [x] Monaco editor with LaTeX syntax highlighting + autocomplete
- [x] Integrated PDF preview (iframe in right panel)
- [x] Collaboration presence indicators (colored dots, user initials)
- [x] Download non-PDF files (download button in editor header)

---

## ✅ Completed in This Session

All items below have been implemented and the build passes (`tsc + vite build`).

---

## Remaining Work (Advanced / Future)

### 1. ✅ Create Folders via UI
**Status:** PARTIAL (folders auto-created from paths; no explicit "New Folder" button)
**Plan:**
- Add a "New Folder" button (folder+ icon) next to "New File" in the FileTree header
- On click: prompt for folder name → create a file `<folder-name>/.gitkeep` via the existing PUT file endpoint
- FileTree already renders folders from path structure, so this will just work
**Files:** `frontend/src/components/FileTree.tsx`
**Effort:** Small (1–2h)

---

### 2. ✅ File/Folder Context Menu
**Status:** MISSING
**Plan:**
- Add right-click context menu (or kebab ⋮ icon on hover) to each file and folder row in FileTree
- File menu options: Rename, Delete, Download, Duplicate
- Folder menu options: New File Here, New Subfolder, Rename, Delete
- Use a small custom dropdown (no heavy library needed)
**Files:** `frontend/src/components/FileTree.tsx`
**Effort:** Medium (2–3h)

---

### 3. ✅ Monaco LaTeX Linting / Warnings
**Status:** PARTIAL (syntax highlighting + autocomplete done; no diagnostics)
**Plan:**
- Register a Monaco `setModelMarkers` diagnostic provider for LaTeX
- Rules to flag as warnings/errors:
  - Unmatched `\begin{...}` / `\end{...}` environments
  - Missing `\end{document}`
  - Unknown/misspelled common commands (via known-command list)
  - `$$` or `$` without closing pair
- Show squiggle underlines + hover tooltips
**Files:** `frontend/src/utils/latexLanguage.ts`, `frontend/src/pages/EditorPage.tsx`
**Effort:** Medium (3–4h)

---

### 4. ✅ PDF ↔ Editor SyncTeX
**Status:** PARTIAL (PDF preview integrated; no bidirectional sync)
**Plan:**
- **Step 1 — Worker**: Run pdflatex with `-synctex=1`; upload the `.synctex.gz` file to MinIO alongside the PDF
- **Step 2 — Backend**: Add endpoint `GET /api/v1/compile/{job_id}/synctex` to download the `.synctex.gz`
- **Step 3 — Frontend**: Replace `<iframe>` PDF viewer with `react-pdf` (or PDF.js directly) for fine-grained control
  - Parse `.synctex.gz` in the browser (using a WASM synctex parser or a lightweight JS parser)
  - On double-click in PDF: map (page, x, y) → (file, line) → jump editor to that line
  - On cursor move in editor: map (file, line) → (page, x, y) → highlight in PDF (forward sync, optional)
**Files:**
- `worker/compile-worker.py` — add `-synctex=1` flag
- `backend/app/api/v1/compile.py` — add synctex endpoint
- `frontend/src/pages/EditorPage.tsx` — replace iframe with react-pdf, add sync logic
**Effort:** Large (6–8h)

---

### 5. ✅ AI Assistant
**Status:** MISSING
**Plan:**
- Use the Anthropic Claude API (claude-sonnet-4-6 or claude-haiku-4-5)
- **Backend:**
  - New router: `backend/app/api/v1/ai.py`
  - Endpoint: `POST /api/v1/ai/assist` — accepts `{context: string, request: string, file_content: string}`
  - Features:
    - **Explain error**: given a pdflatex error log, explain what's wrong and suggest a fix
    - **Complete/suggest**: given cursor position and surrounding LaTeX, suggest next content
    - **Rewrite/improve**: improve selected LaTeX text (grammar, clarity)
  - Streams the response via SSE for real-time output
  - Requires `ANTHROPIC_API_KEY` env var
- **Frontend:**
  - AI panel/sidebar toggled by toolbar button (robot icon)
  - Three modes: Error Explainer, Inline Suggest, Rewrite Selection
  - Error Explainer auto-triggers after a failed compile and shows explanation
  - Inline suggest: user highlights text or places cursor → clicks "Suggest" → AI completes
  - Response displayed in a streaming chat bubble
**Files:**
- `backend/app/api/v1/ai.py` (new)
- `backend/app/main.py` — register router
- `frontend/src/components/AIPanel.tsx` (new)
- `frontend/src/pages/EditorPage.tsx` — integrate AIPanel
- `frontend/src/services/api.ts` — add AI API calls
- `.env.example` — add `ANTHROPIC_API_KEY`
**Effort:** Large (6–8h)

---

### 6. Git Repo Cleanup — REQUIRED
**Status:** MISSING (local repo has uncommitted changes + trash files)
**Plan:**
- [ ] Audit all untracked/modified files (`git status`)
- [ ] Identify and delete genuinely unused/trash files (build artifacts, temp files, scratch files)
- [ ] Stage and commit in logical groups:
  - `feat(backend): file rename and delete endpoints`
  - `feat(frontend): file tree with rename, delete, folder support`
  - `feat(frontend): Monaco LaTeX syntax highlighting and autocomplete`
  - `feat(frontend): document outline panel`
  - `feat(frontend): collaboration presence indicators`
  - `chore: clean up project structure and remove build artifacts`
- [ ] Push all commits to remote (main branch)
**Effort:** Medium (1–2h)

---

## Implementation Order

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| 1 | Git repo cleanup | Medium | Unblocks collaboration |
| 2 | Create folder UI | Small | Quick win |
| 3 | File/folder context menu | Medium | Quick win |
| 4 | Monaco LaTeX linting | Medium | Editor quality |
| 5 | PDF SyncTeX sync | Large | Power user feature |
| 6 | AI assistant | Large | Flagship feature |

---

## Notes
- Architecture: Underleaf is **server-based** (not P2P). Backend + DB + MinIO + RabbitMQ must be hosted. Friends access via browser — no setup needed on their end. Free hosting options: Oracle Cloud free tier, Fly.io, or a home server exposed via Cloudflare Tunnel.
- AI feature requires `ANTHROPIC_API_KEY` — user brings their own key. No ongoing cost from Underleaf itself.
- SyncTeX requires a browser-side WASM or JS parser; consider `synctex-js` or `@dxgui/synctex-js` npm packages.
