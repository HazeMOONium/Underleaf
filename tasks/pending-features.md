# Underleaf — Feature Status
_Last updated: 2026-03-03 — ALL FEATURES COMPLETE_

## Core Editor & File Management
- [x] Rename files (backend + FileTree double-click)
- [x] Rename projects (Dashboard pencil icon)
- [x] Delete files (FileTree × button)
- [x] Delete projects (Dashboard × button)
- [x] Ctrl+S saves file (prevents browser save-as)
- [x] Interactive file outline with section hyperlinks (DocumentOutline.tsx)
- [x] Monaco editor with LaTeX syntax highlighting + autocomplete
- [x] Integrated PDF preview (pdfjs-dist v5, zoom, text selection)
- [x] Collaboration presence indicators (colored dots, user initials)
- [x] Download non-PDF files (download button in editor header)
- [x] New Folder button (folder-plus icon in FileTree header)
- [x] File/folder context menu (right-click + ⋮ kebab: rename, delete, download, duplicate)
- [x] File tree drag-and-drop (@dnd-kit)
- [x] Duplicate file
- [x] Delete folder
- [x] MinIO multipart uploads (FormData, binary drag-and-drop)

## Compilation & Output
- [x] Engine selector (pdflatex/xelatex/lualatex/latexmk, per-project)
- [x] Draft mode
- [x] Structured compile error parsing (file+line, clickable jump-to-line)
- [x] Compile error log path resolution (resolveLogFilePath)
- [x] Compile duration in logs tab
- [x] Download PDF button
- [x] ZIP export
- [x] SyncTeX bidirectional navigation (PDF double-click → editor line, forward sync)
- [x] SyncTeX download from output panel
- [x] Snapshot/version history (History tab, view/download/label/delete)

## Editor Quality
- [x] Word/character count status bar
- [x] Spell check (nspell Web Worker, en-US/en-GB, LaTeX-aware, status-bar toggle)
- [x] Vim/Emacs keybinding modes (localStorage-persisted, vim status bar)
- [x] Project-wide search (Ctrl+Shift+F)
- [x] Duplicate \label diagnostics
- [x] Monaco LaTeX linting / warnings (unmatched environments, missing \end{document})

## Collaboration
- [x] Join/leave toasts (react-hot-toast)
- [x] Presence overflow (+N badge when >3 collaborators)
- [x] Comment threading (reply + resolve + delete)
- [x] Comment notification emails
- [x] Yjs Redis persistence (60s snapshots, graceful-shutdown flush)
- [x] Collab horizontal scaling (Redis pub/sub relay)
- [x] Collab cursors (beforeContentClassName)

## Auth & Access
- [x] JWT refresh tokens (15-min access + 30-day httpOnly refresh cookie)
- [x] Axios 401 interceptor with request queue
- [x] Email verification on register
- [x] Forgot/reset password
- [x] Change password
- [x] Profile/settings page
- [x] RBAC: owner/editor/commenter/viewer
- [x] Invite by email (token links)
- [x] Two-factor auth (TOTP + backup codes, QR setup, login step)
- [x] OAuth/SSO: Google + GitHub (CSRF state via Redis, find-or-create by email)

## AI
- [x] AI assistant panel (Claude API, error explainer, completions, rewrite, streaming SSE)
- [x] Auto-trigger error explainer on failed compile

## New Project Workflow
- [x] New from template (4 built-in templates on dashboard)

## DevOps & Infra
- [x] GET /health and GET /ready endpoints
- [x] Structured JSON logging
- [x] docker-compose.prod.yml (hardened: non-root, resource limits, read-only FS)
- [x] GitHub Actions CI
- [x] Prometheus + Grafana monitoring
- [x] MinIO presigned URL caching (Redis, 14-min TTL)
- [x] Pre-warmed worker pool (configurable concurrency, per-job output dirs)
- [x] Kubernetes Helm chart (8 services, nginx Ingress, init containers, K8s Secrets)
- [x] Production Dockerfiles (frontend multi-stage nginx, collab-server node:18-alpine)

---

## Summary
**All planned features are complete.** The full Underleaf roadmap — from basic editor and compile pipeline through AI assistant, OAuth/2FA, SyncTeX, Kubernetes deployment, and Playwright E2E tests — has been implemented and verified.
