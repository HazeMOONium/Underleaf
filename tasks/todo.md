# Underleaf Improvement Plan

## Status Legend
- [ ] todo  |  [x] done  |  [-] in progress

_Last updated: 2026-03-03 — All planned roadmap items complete._

---

## Priority 1 — Compilation & Output
- [x] Download PDF button
- [x] Structured compile error parsing (file+line+message, clickable)
- [x] Engine selector (pdflatex/xelatex/lualatex/latexmk per project)
- [x] Compile duration in logs tab
- [x] Draft mode
- [x] SyncTeX bidirectional source↔PDF navigation
- [x] Snapshot/version history (auto-created on COMPLETED job, History tab)
- [x] ZIP export (backend + frontend)
- [x] SyncTeX download from output panel
- [x] Compile error log path resolution (`resolveLogFilePath()`)

## Priority 2 — File Management
- [x] File upload drag & drop (text + binary base64)
- [x] MinIO multipart uploads (`upload_file_stream()`, FormData for binary)
- [x] New from template (4 built-in templates on dashboard)
- [x] New Folder button (folder-plus in sidebar)
- [x] File/folder context menu (right-click + ⋮ kebab)
- [x] Duplicate file
- [x] Delete folder
- [x] File tree drag-and-drop reordering (@dnd-kit)

## Priority 3 — Editor Quality
- [x] Dynamic \ref/\cite completions from project files
- [x] Word/character count status bar
- [x] Spell check (nspell Web Worker, en-US/en-GB, LaTeX-aware extractor)
- [x] Vim/Emacs keybinding modes (localStorage-persisted, vim status bar)
- [x] Project-wide search (Ctrl+Shift+F overlay, all .tex/.bib/.sty files)
- [x] Duplicate \label diagnostics (Monaco setModelMarkers)
- [x] Document outline panel (section/subsection navigation)
- [x] LaTeX syntax highlighting + autocomplete
- [x] Monaco LaTeX linting / warnings

## Priority 4 — Collaboration
- [x] Join/leave toasts (react-hot-toast via Yjs awareness)
- [x] Presence overflow (+N avatar badge when >3 collaborators)
- [x] Comment threading (reply + resolve)
- [x] Comment notification emails (BackgroundTasks)
- [x] Yjs Redis persistence (on-connect restore, 60s periodic snapshots, graceful-shutdown flush)
- [x] Collab horizontal scaling (Redis pub/sub relay, origin sentinel)
- [x] Collab cursors (beforeContentClassName pattern)

## Priority 5 — Auth & Access
- [x] Email verification on register
- [x] Profile/settings page
- [x] JWT token refresh (15-min access + 30-day refresh in httpOnly cookie, Axios 401 interceptor)
- [x] Invite by email (token links)
- [x] Forgot/Reset password
- [x] Change password
- [x] RBAC: owner/editor/commenter/viewer roles
- [x] Two-factor auth (TOTP + backup codes, QR setup in ProfilePage, TOTP login step)
- [x] OAuth/SSO: Google + GitHub (state CSRF via Redis, find-or-create by email)

## Priority 6 — AI
- [x] AI assistant panel (Claude API: error explainer, completions, rewrite selection)
- [x] Error explainer auto-triggers after failed compile (streaming SSE)

## Priority 7 — PDF Viewer
- [x] pdfjs-dist v5 viewer (replaced iframe)
- [x] Zoom (Ctrl+scroll)
- [x] Text selection
- [x] SyncTeX double-click PDF→editor
- [x] Forward sync editor→PDF

## Priority 8 — DevOps & Infra
- [x] GET /health and GET /ready endpoints
- [x] Structured JSON logging
- [x] docker-compose.prod.yml (restart:always, non-root users, resource limits, read-only FS)
- [x] GitHub Actions CI
- [x] Prometheus + Grafana (auto-provisioned, ports 19090/13000)
- [x] Kubernetes Helm chart (8 services, nginx Ingress, init containers, K8s Secret)
- [x] Production Dockerfiles (frontend multi-stage nginx, collab-server node:18-alpine)
- [x] MinIO presigned URL caching (Redis 14-min TTL, get_presigned_url_cached())
- [x] Pre-warmed worker pool (WORKER_CONCURRENCY threads, per-job output dirs)

---

## Comprehensive Test Suite ✅ (2026-02-25)
- **138 tests, 138 passing, 0 failing**
- `test_auth.py` — register, login (4 tests)
- `test_auth_edge_cases.py` — email validation, JWT attacks, login edge cases (20 tests)
- `test_auth_new_endpoints.py` — change-password, verify-email, forgot/reset password (13 tests)
- `test_projects.py` — project CRUD (9 tests)
- `test_files.py` — file CRUD, access control (12 tests)
- `test_files_extended.py` — binary upload, ZIP export, rename (12 tests)
- `test_compile.py` — job creation/status/artifact/logs, RabbitMQ failures (14 tests)
- `test_permissions.py` — cross-user access, shared permissions, visibility (11 tests)
- `test_members.py` — list/add/update/remove members, RBAC (14 tests)
- `test_invites.py` — create/list/revoke/preview/accept invites (12 tests)
- `test_comments.py` — create/list/reply/resolve/delete comments (14 tests)
- `test_health.py` — /health and /ready endpoints (4 tests)

### E2E (Playwright)
- **18/18 Playwright tests pass** (auth, editor, compile, collab flows)

---

## Alembic Migrations
| Migration | Description |
|-----------|-------------|
| 001 | Initial schema |
| 002 | RBAC + invites + comments |
| 003 | `email_verified` column |
| 004 | `engine` column on projects |
| 005 | Snapshots table |
| 006 | TOTP: `totp_secret`, `totp_enabled` + `totp_backup_codes` table |
| 007 | OAuth: `oauth_provider`, `oauth_provider_id` on users |

---

## Remaining Items
**ALL ROADMAP ITEMS COMPLETE** — No pending features. The full planned roadmap has been implemented and tested.

Future enhancements to consider:
- Offline/desktop mode (Electron wrapper)
- Custom LaTeX package installation per project
- Export to Word/HTML via pandoc
- Billing/quota tiers for hosted version
