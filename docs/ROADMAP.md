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

| # | Feature | Effort | Notes |
|---|---------|--------|-------|
| 1 | **LaTeX engine selector** | S | Dropdown in editor header: pdflatex / xelatex / lualatex. Store preference per-project in `projects.engine` column. Pass to worker via job message. |
| 2 | **Word / character count status bar** | S | Read Monaco model text → count words and characters → display in a small status bar below the editor. Update on ytext observe. |
| 3 | **Join / leave toasts** | XS | Use Yjs awareness change events to detect users joining or leaving. Show a brief `react-hot-toast` notification (e.g. "Alice joined"). |
| 4 | **New project from template** | S | Add a "From template" button on the dashboard. Provide 3–4 built-in templates (article, beamer, report, CV). Creates the project + uploads template files on select. |
| 5 | **New folder button in file tree** | XS | Add a folder-plus icon next to "New File". On click: prompt for name → create `<name>/.gitkeep` via existing file endpoint. |

---

## Editor improvements

### Spell check

Integrate `nspell` (hunspell-compatible JS) for English spell checking in Monaco.

- Register a Monaco `setModelMarkers` provider that runs nspell on the text content of each LaTeX paragraph (ignoring commands, math, and environments)
- Show squiggle underlines + hover suggestions
- Language selector (en-US / en-GB / de / fr / es) stored in user profile
- **Effort**: M (3–4h)

### Enhanced LaTeX diagnostics

Extend the existing LaTeX language registration with more Monaco markers:

- Unmatched `\begin{...}` / `\end{...}` environments
- Missing `\end{document}`
- `$$` / `$` without closing pair
- Unknown commands (via configurable known-command list)
- Duplicate `\label` definitions
- **Effort**: M (3–4h)

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

### Comment notification emails

Send email notifications when:

- Someone comments on a file in your project
- Someone replies to your comment
- A thread you're participating in is resolved
- Requires email service to be configured (SMTP env vars)
- **Effort**: M (3–4h)

### Presence improvements

- Show a list of active collaborators in the editor header (avatars with initials)
- Display "X users online" when > 3 collaborators
- Per-file awareness (show who is viewing which file)
- **Effort**: S (2–3h)

---

## Auth & access

### JWT refresh tokens

Current tokens are 24-hour access tokens with no refresh mechanism. Add:

- Short-lived access tokens (15 min)
- Long-lived refresh tokens (30 days) stored in httpOnly cookies
- `POST /auth/refresh` endpoint
- Silent token refresh in the Axios interceptor
- **Effort**: M (3–5h)

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

### Compile with bibliography (latexmk)

Replace single `pdflatex` invocation with `latexmk -pdf`:

- Automatically handles multiple passes, BibTeX, and index generation
- More reliable for complex documents with citations and cross-references
- Add `-bibtex` flag and multi-pass configuration
- **Effort**: S (1–2h)

### Compile error linking to files

When parsing structured errors from pdflatex output, resolve relative file paths (e.g. `./sections/intro.tex`) to the project's file tree. Show clickable file:line links in the error panel that navigate the editor to the error location.

Currently partial — implement full resolution for multi-file projects.

- **Effort**: S (2–3h)

### Draft / fast compile mode

Add a "Draft compile" option that runs pdflatex with `-draftmode` (skips PDF generation) for fast syntax checking, then a full compile when the user wants the PDF.

- **Effort**: XS (< 1h)

---

## Infrastructure & DevOps

### Structured JSON logging

Replace the current request logger with structured JSON logs:

- Include `request_id`, `user_id`, `method`, `path`, `status`, `duration_ms`
- Use `structlog` or Python's `logging` with `json_formatter`
- Enables Loki / Elasticsearch ingestion
- **Effort**: S (1–2h)

### Prometheus metrics dashboard

A Grafana dashboard is implied by the Prometheus middleware already wired in `main.py`. Create:

- `grafana/dashboards/underleaf.json` — pre-built Grafana dashboard
- Key panels: request rate, p50/p95/p99 latency, compile job throughput, error rate, active WebSocket connections
- Add to `docker-compose.dev.yml` (Grafana + Prometheus services)
- **Effort**: M (3–4h)

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

### Backend connection pooling

Switch from per-request SQLAlchemy connections to a properly sized pool:

- Configure `pool_size`, `max_overflow`, `pool_pre_ping`
- Add `asyncpg` pool stats to Prometheus metrics
- **Effort**: XS (< 1h)

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
