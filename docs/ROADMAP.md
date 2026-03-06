# Roadmap

This document tracks planned features, quality improvements, and technical debt for Underleaf.

Items are grouped by theme and ordered by priority within each group.

---

## Table of Contents

- [Future / exploratory](#future--exploratory)
- [Completed features](#completed-features)

---

## Future / exploratory

All originally planned roadmap items are complete. The following are larger or more speculative features for later consideration.

| Feature | Description |
|---------|-------------|
| **Git integration** | Automatically commit each compile snapshot to a Git repo. Push/pull from GitHub/GitLab. Browse history as git log. |
| **Template marketplace** | Community-contributed project templates. Upload, browse, and fork templates from a gallery. |
| **VS Code extension** | Thin client that bridges a local VS Code instance to a remote Underleaf project for full offline editing with sync. |
| **Full-text search** | Index LaTeX AST across all project files. Search for `\label`, `\cite`, section titles, arbitrary text. |
| **Export to Word/HTML** | Use Pandoc to convert compiled LaTeX to DOCX or HTML for sharing with non-LaTeX users. |
| **Multi-compiler images** | Support TeXLive full, TeXLive minimal, and Tectonic as separate worker images. User selects compiler image per project. |
| **Quotas & billing** | Per-user or per-team storage and compile quotas. Usage dashboards. Optional Stripe billing for hosted deployments. |
| **SAML / LDAP SSO** | Enterprise SSO integration for institutional deployments. |
| **Mobile app** | Read-only viewer and lightweight editing for tablets via a React Native wrapper. |
| **Electron desktop app** | Offline-capable desktop wrapper with local compile fallback. |

---

## Completed features

All features below have been implemented and are available in the current release.

### Auth & access
- ✅ JWT auth — HS256 access tokens (15 min), httpOnly refresh tokens (30 days), Axios 401 interceptor with request queue
- ✅ Email verification on register
- ✅ Forgot / reset password
- ✅ Change password
- ✅ Profile / settings page
- ✅ Role-based access control — owner / editor / commenter / viewer
- ✅ Invite links — token-based, configurable expiry and max-uses
- ✅ **Two-factor authentication (TOTP)** — pyotp, QR code setup in ProfilePage, backup codes, 2FA login step (migration 006)
- ✅ **OAuth / SSO** — Google + GitHub; state CSRF via Redis; find-or-create by email; OAuthCallbackPage (migration 007)

### Editor quality
- ✅ Monaco editor with LaTeX syntax highlighting and `\ref`/`\cite`/environment autocomplete
- ✅ Document outline panel (section/subsection navigation)
- ✅ Word / character count status bar
- ✅ Duplicate `\label` diagnostics (Monaco squiggle)
- ✅ Enhanced LaTeX diagnostics — unmatched `\begin/\end`, missing `\end{document}`, unclosed `$$`/`$`
- ✅ **Spell check** — nspell Web Worker, en-US/en-GB dictionaries, LaTeX-aware text extractor, CodeAction quick-fix suggestions + "Ignore word", status-bar toggle + locale selector
- ✅ **Vim / Emacs keybindings** — mode selector in editor header, localStorage-persisted, vim status bar
- ✅ **Project-wide search** — Ctrl+Shift+F overlay, searches all `.tex/.bib/.sty` files, click to navigate

### File management
- ✅ Drag-and-drop file upload (text + binary base64)
- ✅ **Multipart uploads** — `POST /projects/:id/files/stream` for large binary files; frontend uses `FormData`
- ✅ New project from template — 4 built-in templates (article, beamer, report, CV)
- ✅ New folder button — folder-plus in sidebar, `.gitkeep` pattern
- ✅ File/folder context menu — right-click + ⋮ kebab: rename, delete, download, duplicate
- ✅ Duplicate file
- ✅ Delete folder (with confirmation)
- ✅ File tree drag-and-drop reorganization (`@dnd-kit`)
- ✅ ZIP export

### Collaboration
- ✅ Real-time CRDT editing — Yjs + y-monaco + MonacoBinding
- ✅ Collab cursors — `beforeContentClassName` CSS spans
- ✅ Presence indicators — colored avatars with initials
- ✅ **Presence overflow** — `+N` badge when >3 collaborators online, tooltip with hidden names
- ✅ **Join / leave toasts** — `react-hot-toast` on awareness change
- ✅ Threaded comments anchored to file:line (create, reply, resolve, delete)
- ✅ Comment notification emails — new comment → owner; reply → parent author; resolved → root author
- ✅ Yjs Redis persistence — on-connect restore, 60s periodic snapshots, graceful-shutdown flush
- ✅ **Collab horizontal scaling** — Redis pub/sub relay; `origin='redis-relay'` sentinel; 3 Redis clients per process

### Compile pipeline
- ✅ Compile pipeline — RabbitMQ → worker → pdflatex → MinIO PDF
- ✅ **Engine selector** — pdflatex / xelatex / lualatex / latexmk per project (migration 004)
- ✅ **Draft compile mode** — "Draft" button sends `-draftmode` flag for fast syntax checking
- ✅ latexmk integration — worker uses latexmk when available, falls back to direct engine
- ✅ SyncTeX — `-synctex=1` flag; `.synctex.gz` upload; source ↔ PDF bidirectional navigation
- ✅ Structured compile error parsing — file:line extraction, clickable jumps in output panel
- ✅ **Compile error path resolution** — `resolveLogFilePath()` resolves `./sections/foo.tex` log paths against the project file tree (exact → suffix → basename)
- ✅ Compile duration display in logs tab
- ✅ **Snapshot / version history** — auto-created per COMPLETED job; History tab (view PDF, download, rename label, delete); migration 005

### PDF viewer
- ✅ pdfjs-dist v5 embedded viewer (replaced iframe)
- ✅ Zoom (Ctrl+scroll)
- ✅ Text selection
- ✅ SyncTeX double-click PDF → editor line
- ✅ Forward sync editor cursor → PDF highlight

### Infrastructure & DevOps
- ✅ Health (`/health`) and readiness (`/ready`) endpoints
- ✅ Structured JSON logging — all request fields as top-level JSON keys
- ✅ SQLAlchemy connection pool — `pool_size=10`, `max_overflow=20`, `pool_pre_ping=True`
- ✅ MinIO presigned URL caching — `get_presigned_url_cached()`, Redis 14-min TTL; `GET /compile/jobs/:id/artifact-url`
- ✅ **Multipart MinIO uploads** — `upload_file_stream()` streams directly without loading into memory
- ✅ GitHub Actions CI — backend pytest + black + flake8; frontend tsc + eslint; 18 Playwright E2E tests
- ✅ Prometheus + Grafana — auto-provisioned in dev compose; pre-built dashboard (request rate, latency, error rate, compile throughput)
- ✅ Production Docker Compose hardening — `restart: always`, non-root users, `read_only: true`, resource limits, required-secret validation
- ✅ Production Dockerfiles — frontend multi-stage (node:20 build → nginx:1.25-alpine), collab-server (node:18-alpine tsc build)
- ✅ **Pre-warmed worker pool** — `WORKER_CONCURRENCY` threads, each with own RabbitMQ connection; per-job `OUTPUT_DIR/{job_id}/` to prevent concurrent file races
- ✅ **Kubernetes Helm chart** — `deploy/helm/underleaf/`; 8 services (PostgreSQL/Redis/MinIO/RabbitMQ StatefulSets + Backend/Collab/Worker/Frontend Deployments); nginx Ingress; backend init containers for wait-for-deps + `alembic upgrade head`; all secrets via K8s Secret

### AI
- ✅ AI assistant panel — Claude API (explain error, completions, rewrite selection), streaming SSE
- ✅ Error explainer auto-triggers after failed compile
