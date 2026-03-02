# Roadmap

This document tracks planned features, quality improvements, and technical debt for Underleaf.

Items are grouped by theme and ordered by priority within each group. Effort estimates assume a single focused developer.

---

## Table of Contents

- [Near-term (next sprint)](#near-term-next-sprint)
- [Editor improvements](#editor-improvements)
- [Collaboration](#collaboration)
- [Auth & access](#auth--access)
- [Compile pipeline](#compile-pipeline)
- [Infrastructure & DevOps](#infrastructure--devops)
- [Performance & scalability](#performance--scalability)
- [Future / exploratory](#future--exploratory)

---

## Near-term (next sprint)

High value, low effort items that can be shipped quickly.

| # | Feature | Effort | Status |
|---|---------|--------|--------|
| 1 | **LaTeX engine selector** | S | ✅ Done — migration 004, engine column, PATCH route, worker reads engine |
| 2 | **Word / character count status bar** | S | ✅ Done — 22px status bar below Monaco, updates on ytext observe |
| 3 | **Join / leave toasts** | XS | ✅ Done — awareness change handler, tracks names, react-hot-toast |
| 4 | **New project from template** | S | ✅ Done — 4 templates (article, beamer, report, CV), modal on dashboard |
| 5 | **New folder button in file tree** | XS | ✅ Done — folder-plus button in sidebar header, modal prompt |

---

## Editor improvements

### Spell check

Integrate `nspell` (hunspell-compatible JS) for English spell checking in Monaco.

- Register a Monaco `setModelMarkers` provider that runs nspell on the text content of each LaTeX paragraph (ignoring commands, math, and environments)
- Show squiggle underlines + hover suggestions
- Language selector (en-US / en-GB / de / fr / es) stored in user profile
- **Effort**: M (3–4h)

### ~~Enhanced LaTeX diagnostics~~ ✅ Done

Duplicate `\label` detection added to `registerLatexDiagnostics`. Existing checks already covered: unmatched `\begin/\end`, missing `\end{document}`, unclosed `$$`/`$`.

### File/folder context menu

Replace the current inline rename/delete buttons with a right-click context menu (or hover ⋮ kebab):

- File: Rename, Delete, Download, Duplicate
- Folder: New File Here, New Subfolder, Rename, Delete All
- Custom lightweight dropdown — no heavy library required
- **Effort**: M (2–3h)

### Multi-cursor find & replace

Expose Monaco's built-in find/replace widget with a keyboard shortcut (Ctrl+H) and project-wide file search (Ctrl+Shift+F) across all project files.

- **Effort**: S (1–2h)

### Vim / Emacs keybindings

Add a keybinding mode selector in user preferences. Monaco has built-in support for `monaco-vim` and `monaco-emacs` packages.

- **Effort**: S (1–2h)

---

## Collaboration

### Snapshot / version history

Track a history of compile events as "snapshots":

- Each successful compile creates a `Snapshot` record pointing to the compiled PDF
- Version history panel in the editor shows a timeline
- Click a snapshot → view the PDF from that point in time
- "Restore" button re-uploads the snapshot's files as the current version
- **Backend**: new `Snapshot` model + API endpoints
- **Effort**: L (6–8h)

### ~~Comment notification emails~~ ✅ Done

Notifications sent via `BackgroundTasks` (no-op when SMTP not configured):
- New top-level comment → project owner notified
- Reply → parent comment's author notified
- Thread resolved → root comment author notified

### ~~Presence improvements~~ ✅ Done

Presence bar capped at 3 peer avatars + overflow `+N` badge with tooltip listing hidden names.

---

## Auth & access

### ~~JWT refresh tokens~~ ✅ Done

Access tokens reduced to 15 min; long-lived refresh tokens (30 days) in httpOnly cookie.
`POST /auth/refresh` rotates the token. Axios interceptor retries on 401 with queuing.
CORS updated to specific origins (required for `withCredentials`).

### Two-factor authentication (TOTP)

Add TOTP-based 2FA:

- `POST /auth/2fa/enable` — generate TOTP secret + QR code
- `POST /auth/2fa/verify` — confirm setup with a code
- Login flow: after password, prompt for 6-digit TOTP code if 2FA enabled
- Backup codes (10 single-use codes)
- **Effort**: L (6–8h)

### OAuth / SSO login

Add Google and GitHub OAuth2 login:

- Redirect to provider → callback → create/link account
- Store provider + provider user ID in Users table
- Allow linking multiple providers to one account
- **Effort**: L (6–8h)

---

## Compile pipeline

### Pre-warmed worker pool

Current architecture: one worker container, cold start per job. Improve:

- Keep N worker containers alive (configurable pool size)
- Workers listen on the queue and process jobs immediately (no container spin-up delay)
- Scale pool based on queue depth (auto-scaling via Docker API or Kubernetes HPA)
- **Effort**: L (8–12h)

### ~~Compile with bibliography (latexmk)~~ ✅ Done

Worker detects `latexmk` availability at runtime (`shutil.which`) and uses it when present (`-pdf`/`-xelatex`/`-lualatex` flags). Falls back to direct engine invocation otherwise.

### Compile error linking to files

When parsing structured errors from pdflatex output, resolve relative file paths (e.g. `./sections/intro.tex`) to the project's file tree. Show clickable file:line links in the error panel that navigate the editor to the error location.

Currently partial — implement full resolution for multi-file projects.

- **Effort**: S (2–3h)

### ~~Draft / fast compile mode~~ ✅ Done

"Draft" button added to editor header — sends `draft: true` flag, worker passes `-draftmode` to the engine for fast syntax checking without PDF generation.

---

## Infrastructure & DevOps

### ~~Structured JSON logging~~ ✅ Done

`JSONFormatter` emits all extra fields as top-level JSON keys (`method`, `path`, `status`, `duration` ms, `request_id`). `LoggingMiddleware` logs a clean `"request"` message with structured extras.

### ~~Prometheus metrics dashboard~~ ✅ Done

`deploy/grafana/dashboards/underleaf.json` — pre-built dashboard with panels:
request rate, p50/p95/p99 latency, error rate, compile throughput, stat tiles.
Prometheus (port 19090) and Grafana (port 13000) added to `docker-compose.dev.yml`.
Grafana auto-provisions the datasource and dashboard on startup.

### Production Docker Compose hardening

Review `deploy/docker-compose.prod.yml` for production readiness:

- Non-root users for all containers
- Read-only filesystem where possible
- Secret management (Docker secrets or env file encryption)
- Resource limits (`mem_limit`, `cpu_quota`)
- Restart policies
- **Effort**: M (2–3h)

### Kubernetes Helm chart

For teams wanting to deploy to Kubernetes:

- Helm chart with configurable replicas, ingress, TLS, persistent volumes
- HPA for backend and worker pods
- NetworkPolicy to restrict pod-to-pod traffic
- **Effort**: XL (16–24h)

---

## Performance & scalability

### ~~Backend connection pooling~~ ✅ Done

`database.py` now uses `pool_size=10`, `max_overflow=20`, `pool_timeout=30`, `pool_pre_ping=True`.

### MinIO multipart uploads

For large files (images, fonts > 5MB), use MinIO's multipart upload API instead of loading the entire file into memory. This reduces backend peak memory usage.

- **Effort**: S (2–3h)

### CDN / object storage presigned URL caching

Cache presigned URLs in Redis for the duration of their validity (15 min) to avoid re-signing the same object on every page load.

- **Effort**: S (1–2h)

### Collab server horizontal scaling

The current Yjs WebSocket server is single-process. For multiple instances:

- Use `y-redis` (official package) to synchronize `Y.Doc` state across multiple collab server instances via Redis pub/sub
- Each instance reads/writes from the same Redis cluster
- Enables load balancing WebSocket connections across instances
- **Effort**: M (3–5h)

---

## Future / exploratory

These are larger or more speculative features for later consideration.

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

---

## Completed features

For reference, major features already shipped:

- JWT auth, email verification, forgot/reset password, change password, profile page
- Project CRUD with file management (create, read, update, delete, rename, ZIP export)
- Monaco Editor with LaTeX syntax highlighting, `\ref`/`\cite`/environment autocomplete
- Real-time collaboration: Yjs CRDT + y-monaco + collab cursors + presence
- Yjs Redis persistence (on-connect restore, 60s periodic snapshots, graceful shutdown)
- Role-based access: owner / editor / commenter / viewer
- Invite links (token-based, expiry, max uses)
- Threaded comments anchored to file:line
- Compile pipeline: RabbitMQ → worker → pdflatex → MinIO PDF
- SyncTeX: source ↔ PDF bidirectional navigation (double-click in PDF → jump to editor line)
- pdfjs-dist v5 PDF viewer with zoom, text selection, Ctrl+scroll zoom
- Structured compile error parsing: clickable file:line jumps in output panel
- Compile duration display, PDF download button, ZIP export
- Drag-and-drop file upload (text and binary)
- File tree drag-and-drop reorganization (`@dnd-kit`)
- AI assistant panel (Claude API: error explainer, completions, rewrite)
- Document outline panel (section/subsection navigation)
- Health (`/health`) and readiness (`/ready`) endpoints
- GitHub Actions CI (backend pytest + black + flake8; frontend tsc + eslint)
- 138-test backend test suite covering all API surface areas
- **LaTeX engine selector** — pdflatex / xelatex / lualatex per project (migration 004)
- **Word / character count status bar** — live counts below Monaco editor
- **Join / leave toasts** — react-hot-toast on collaborator join/leave via Yjs awareness
- **New project from template** — 4 built-in templates on dashboard
- **New folder button** — folder-plus in sidebar, `.gitkeep` pattern
- **latexmk integration** — worker uses latexmk when available, falls back to direct engine
- **Draft compile mode** — "Draft" button in header, `-draftmode` flag skips PDF generation
- **Duplicate `\label` diagnostics** — Monaco squiggle for duplicate label keys
- **Presence overflow badge** — `+N` avatar badge when >3 collaborators online
- **Structured JSON logging** — all request fields as top-level JSON keys (`method`, `path`, `status`, `duration`)
- **SQLAlchemy connection pool** — `pool_size=10`, `max_overflow=20`, `pool_timeout=30`
