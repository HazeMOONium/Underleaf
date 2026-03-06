# Architecture

This document describes the system design of Underleaf.

---

## Table of Contents

- [High-level overview](#high-level-overview)
- [Service responsibilities](#service-responsibilities)
- [Data models](#data-models)
- [Authentication & authorization](#authentication--authorization)
- [Real-time collaboration](#real-time-collaboration)
- [Compile pipeline](#compile-pipeline)
- [File storage](#file-storage)
- [Key design decisions](#key-design-decisions)

---

## High-level overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser                                                         │
│  React SPA (Vite :3000)                                         │
│  Monaco Editor ──Yjs── y-websocket                              │
└──────────┬──────────────────────────┬───────────────────────────┘
           │ REST /api/*              │ WebSocket ws://collab
           ▼                          ▼
┌──────────────────┐      ┌─────────────────────┐
│ Backend           │      │ Collab Server        │
│ FastAPI :18000    │      │ y-websocket :11234   │
│                   │      │                     │
│ Auth, CRUD        │      │ Yjs document sync   │
│ Compile jobs      │      │ Presence / cursors  │
│ Snapshots         │      │ Redis pub/sub relay │
│ File management   │      │                     │
└──┬────┬────┬──────┘      └──────────┬──────────┘
   │    │    │                        │
   │    │    │  AMQP                  │ Redis pub/sub + snapshots
   │    │    └──────────────┐         │
   │    │                   ▼         ▼
   │    │          ┌───────────┐  ┌───────┐
   │    │          │ RabbitMQ  │  │ Redis │
   │    │          └─────┬─────┘  └───────┘
   │    │                │
   │    │                ▼
   │    │        ┌──────────────────┐
   │    │        │ Worker pool       │
   │    │        │ (N threads)       │
   │    │        │ pdflatex/         │
   │    │        │ xelatex/          │
   │    │        │ lualatex/latexmk  │
   │    │        └──────┬────────────┘
   │    │               │ PDF + .synctex.gz upload
   │    │               ▼
   │    └──────────► MinIO (S3)
   │                (files + PDFs + SyncTeX)
   ▼
PostgreSQL
(metadata, auth, jobs, snapshots)
```

---

## Service responsibilities

### Frontend (`frontend/`)

- **Framework**: React 18 + TypeScript, Vite 5
- **Editor**: Monaco Editor with custom LaTeX language registration, `\ref`/`\cite` completions, environment autocomplete, duplicate `\label` diagnostics, spell check via Web Worker (nspell), Vim/Emacs keybinding modes
- **Collaboration**: `y-websocket` provider + `y-monaco` `MonacoBinding` for CRDT-backed editing
- **State**: Zustand for auth; TanStack React Query for server state (projects, files, compile jobs)
- **Routing**: React Router v6 — `/login`, `/register`, `/`, `/projects/:id`, `/profile`, `/verify-email`, `/auth/callback`
- **PDF viewer**: `pdfjs-dist` v5 embedded directly (no iframe) for zoom, text selection, and SyncTeX double-click
- **API client**: Axios with JWT Bearer interceptor and 401 refresh-token retry queue (`services/api.ts`)

Key components:
| Component | Purpose |
|-----------|---------|
| `EditorPage.tsx` | Main editor: file tree, Monaco, PDF panel, compile output, history tab |
| `DashboardPage.tsx` | Project list with search, create from template, delete, rename, ZIP export |
| `FileTree.tsx` | Nested file browser with `@dnd-kit` drag-and-drop, context menu, multipart upload |
| `DocumentOutline.tsx` | Live LaTeX section outline with click-to-navigate |
| `AIPanel.tsx` | Claude AI assistant panel (error explain, completions, rewrite, SSE streaming) |
| `ProfilePage.tsx` | Change password, TOTP 2FA setup (QR code), connected OAuth providers |
| `OAuthCallbackPage.tsx` | Handles OAuth redirect, exchanges token, redirects to dashboard |
| `spellChecker.ts` | Main-thread spell check orchestrator (debounce, markers, CodeActions) |
| `spellCheckWorker.ts` | Web Worker: loads nspell dictionary, checks words, returns markers |
| `latexTextExtractor.ts` | Strips LaTeX markup to isolate prose text for spell checking |

### Backend (`backend/app/`)

- **Framework**: FastAPI with async SQLAlchemy 2.0 (asyncpg driver), Pydantic v2
- **Entry point**: `main.py` — CORS, request logging, Prometheus metrics middleware, route registration
- **Auth**: JWT HS256 via `python-jose`, bcrypt password hashing via `passlib`; TOTP via `pyotp`
- **API routes** in `api/v1/`:
  - `auth.py` — register, verify email, login, me, change password, forgot/reset password, JWT refresh, 2FA (enable/verify/disable/login), OAuth (redirect + callback)
  - `projects.py` — project CRUD + file CRUD + ZIP export + template creation
  - `compile.py` — job submit, status, artifact, artifact-url, SyncTeX, logs
  - `members.py` — RBAC member management
  - `invites.py` — shareable invite links
  - `comments.py` — threaded file-anchored comments with email notifications
  - `ai.py` — Claude API proxy with streaming SSE
  - `snapshots.py` — version history: list, stream artifact, rename label, delete

### Collab Server (`collab-server/src/server.ts`)

- **Runtime**: Node.js with `y-websocket` WebSocket server
- **Document scope**: one `Y.Doc` per `project-{id}` room; texts keyed by file path (`ydoc.getText(filePath)`)
- **Redis persistence**: on client connect, restore snapshot; on disconnect / every 60 seconds, snapshot to Redis key `ydoc:{roomName}`; graceful-shutdown flush
- **Horizontal scaling**: Redis pub/sub relay — each instance subscribes to a per-room channel and re-broadcasts Yjs updates to other instances. An `origin='redis-relay'` sentinel prevents re-publication loops. Uses 3 separate Redis clients: persistence, pub, sub.
- **Port**: 1234 (dev), 11234 (Docker)

### Worker (`worker/compile-worker.py`)

- **Pool**: `WORKER_CONCURRENCY` threads (default 2), each with its own RabbitMQ connection and channel; pre-warmed at startup for zero cold-start on new jobs
- **Queue**: consumes AMQP messages from `compile_jobs` queue
- **Sandbox**: unprivileged user (UID 1001), 120-second timeout, `\write18` disabled
- **Per-job isolation**: each job writes to `OUTPUT_DIR/{job_id}/` to prevent concurrent-job file races
- **Flow**: download all project files from MinIO → run engine (`pdflatex`/`xelatex`/`lualatex` with `-synctex=1 -interaction=nonstopmode`, or `latexmk`) → upload PDF + `.synctex.gz` to MinIO → update job status in PostgreSQL via REST call to backend → acknowledge message
- **Error handling**: structured error extraction from pdflatex stdout (file, line, message)

---

## Data models

### Users

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `email` | String | Unique |
| `hashed_password` | String | bcrypt (nullable for pure-OAuth accounts) |
| `role` | Enum | `user` \| `admin` |
| `is_active` | Boolean | Default true |
| `email_verified` | Boolean | Default false |
| `verification_token` | String | Nullable |
| `reset_token` | String | Nullable |
| `reset_token_expires` | DateTime | Nullable |
| `totp_secret` | String | Nullable; base32 TOTP secret |
| `totp_enabled` | Boolean | Default false |
| `oauth_provider` | String | Nullable; `google` or `github` |
| `oauth_provider_id` | String | Nullable; provider user ID |
| `created_at` | DateTime | |

### TotpBackupCodes

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `user_id` | UUID | FK → Users |
| `code_hash` | String | bcrypt-hashed backup code |
| `used` | Boolean | Default false |

### Projects

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `title` | String | |
| `owner_id` | UUID | FK → Users |
| `engine` | String | `pdflatex` / `xelatex` / `lualatex` / `latexmk`; default `pdflatex` |
| `created_at` | DateTime | |

### ProjectFiles

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `project_id` | UUID | FK → Projects |
| `path` | String | e.g. `main.tex`, `sections/intro.tex` |
| `content_type` | String | MIME type |
| `size` | Integer | bytes |
| `minio_key` | String | Object storage key |
| `created_at` / `updated_at` | DateTime | |

### Permissions

| Column | Type | Notes |
|--------|------|-------|
| `project_id` | UUID | FK → Projects |
| `user_id` | UUID | FK → Users |
| `role` | Enum | `editor` \| `commenter` \| `viewer` |

The project owner always has implicit `owner` access; `Permissions` rows cover non-owner collaborators.

### ProjectInvites

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `project_id` | UUID | FK → Projects |
| `token` | String | Unique URL-safe token |
| `role` | Enum | Role granted on accept |
| `expires_at` | DateTime | Nullable |
| `max_uses` | Integer | Nullable |
| `use_count` | Integer | |
| `created_by` | UUID | FK → Users |

### Comments

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `project_id` | UUID | FK → Projects |
| `author_id` | UUID | FK → Users |
| `file_path` | String | Anchored to file |
| `line` | Integer | Anchored to line |
| `content` | Text | |
| `parent_id` | UUID | FK → Comments (threading) |
| `resolved` | Boolean | |
| `created_at` / `updated_at` | DateTime | |

### CompileJobs

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `project_id` | UUID | FK → Projects |
| `requester_id` | UUID | FK → Users |
| `status` | Enum | `pending` \| `running` \| `completed` \| `failed` |
| `engine` | String | `pdflatex` / `xelatex` / `lualatex` / `latexmk` |
| `draft` | Boolean | Draft mode (skips PDF generation) |
| `pdf_key` | String | MinIO key for PDF |
| `synctex_key` | String | MinIO key for `.synctex.gz` |
| `log_output` | Text | Raw pdflatex stdout |
| `error_message` | String | Extracted error |
| `duration_seconds` | Float | |
| `created_at` / `finished_at` | DateTime | |

### Snapshots

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `project_id` | UUID | FK → Projects |
| `compile_job_id` | UUID | FK → CompileJobs; unique constraint (idempotent) |
| `label` | String | Human-readable name; defaults to timestamp |
| `artifact_ref` | String | MinIO key for the PDF |
| `created_at` | DateTime | |

Snapshots are auto-created in `GET /compile/jobs/:id/status` when the job transitions to COMPLETED. The unique constraint on `compile_job_id` makes concurrent creation idempotent.

---

## Authentication & authorization

### JWT flow

```
POST /api/v1/auth/login
  → validate email + bcrypt password (+ TOTP code if 2FA enabled)
  → issue HS256 access token (15 min, in response body)
  → issue refresh token (30 days, in httpOnly cookie "refresh_token")
  → store refresh token in Redis: refresh_token:{token} → user_id (TTL=30d)

All requests: Authorization: Bearer <access_token>

POST /api/v1/auth/refresh
  → read refresh token from httpOnly cookie
  → validate against Redis
  → rotate: delete old Redis key, issue new access token + refresh token
  → Axios 401 interceptor queues concurrent 401s while refresh in flight
```

### Two-factor authentication (TOTP)

```
POST /auth/2fa/enable  → generate TOTP secret, return base32 + QR URI
POST /auth/2fa/verify  → confirm setup with a live TOTP code; activate 2FA; return backup codes
POST /auth/2fa/disable → disable with current TOTP code
POST /auth/2fa/login   → exchange session_token (from password login) + TOTP code for JWT
```

When 2FA is enabled, `POST /auth/login` responds with `{requires_2fa: true, session_token: "..."}` instead of a JWT. The frontend routes to the TOTP step.

### OAuth / SSO

```
GET /auth/oauth/{provider}           → redirect to Google/GitHub with state (CSRF token in Redis)
GET /auth/oauth/{provider}/callback  → validate state, exchange code for profile
                                      → find-or-create user by email
                                      → issue JWT + refresh token
                                      → redirect to /auth/callback?token=<jwt>
```

Supported providers: `google`, `github`. State tokens are stored in Redis with a 10-minute TTL.

### RBAC

Roles in descending privilege order:

| Role | Can edit files | Can comment | Can manage members | Can compile |
|------|---------------|-------------|-------------------|-------------|
| `owner` | yes | yes | yes | yes |
| `editor` | yes | yes | no | yes |
| `commenter` | no | yes | no | no |
| `viewer` | no | no | no | no |

Role checks happen in route handlers via `get_current_user` + permission lookup. Owners are detected by comparing `project.owner_id == current_user.id`; other roles from the `Permissions` table.

---

## Real-time collaboration

### Document model

Each project has a single `Y.Doc` shared across all clients. Text content for each file lives in a named `Y.Text` within that doc:

```typescript
const ydoc = new Y.Doc()
const ytext = ydoc.getText('main.tex')  // keyed by file path
const binding = new MonacoBinding(ytext, model, new Set([editor]))
```

When a user switches files, the `MonacoBinding` is destroyed and recreated with the new `ytext`. The `Y.Doc` persists for the project session lifetime.

### Seeding

When a user opens a file for the first time (CRDT text length = 0), the frontend seeds the ytext from the backend file content. This ensures newly invited collaborators see the correct content.

### Presence

User cursors are broadcast via `provider.awareness` with the user's email and a deterministic HSL color (`toHsla(clientId)`). Rendered in Monaco via `beforeContentClassName` CSS spans. The presence bar caps at 3 peer avatars + a `+N` overflow badge with a tooltip listing hidden names. Join/leave events fire `react-hot-toast` notifications.

### Redis persistence

The collab server snapshots each `Y.Doc` as a binary state vector to Redis key `ydoc:{projectId}` on:
- Client disconnect (if no other clients remain)
- Every 60 seconds (periodic timer)
- SIGTERM / SIGINT (graceful shutdown)

On reconnect, the snapshot is restored before the client completes the sync handshake.

### Horizontal scaling

Multiple collab server instances are supported via Redis pub/sub:
- Each instance publishes incoming Yjs updates to a per-room Redis channel
- All instances subscribe and re-broadcast to their local WebSocket clients
- An `origin='redis-relay'` sentinel on re-broadcast messages prevents looping
- Three separate Redis clients per process: one for persistence, one for pub, one for sub

---

## Compile pipeline

```
Frontend                Backend              RabbitMQ          Worker
   │                      │                     │                 │
   │  POST /compile/jobs  │                     │                 │
   ├─────────────────────►│                     │                 │
   │                      │ CREATE CompileJob   │                 │
   │                      │   status=PENDING    │                 │
   │                      ├────────────────────►│                 │
   │  { job_id, status }  │  publish message    │                 │
   │◄─────────────────────┤                     │                 │
   │                      │                     │  consume job    │
   │  poll GET /jobs/{id}/status                │◄────────────────┤
   │  every 2s            │                     │                 │
   │                      │                     │  download files │
   │                      │                     │  from MinIO     │
   │                      │                     │                 │
   │                      │                     │  run engine     │
   │                      │                     │  (-synctex=1)   │
   │                      │                     │                 │
   │                      │  PATCH job status   │  upload PDF +   │
   │                      │◄────────────────────┼─.synctex.gz─────┤
   │  status=COMPLETED    │                     │                 │
   │◄─────────────────────┤                     │                 │
   │  (auto-creates Snapshot)                   │                 │
   │                      │                     │                 │
   │  GET /jobs/{id}/artifact-url → cached presigned MinIO URL    │
```

### Compile error linking

Log paths emitted by pdflatex (e.g. `./sections/foo.tex`) are resolved against the project's file tree using `resolveLogFilePath()` — exact match → suffix match → basename match. Matched errors are rendered as clickable links in the output panel that jump the editor to the correct file and line.

---

## File storage

All file blobs are stored in MinIO (S3-compatible). The backend stores only metadata (path, size, MIME type) in PostgreSQL and the MinIO object key.

Object key convention:
- Project files: `projects/{project_id}/{file_path}`
- Compiled PDFs: `artifacts/{job_id}/output.pdf`
- SyncTeX files: `artifacts/{job_id}/output.synctex.gz`

**Presigned URL caching**: `minio_service.get_presigned_url_cached()` caches presigned URLs in Redis for 14 minutes (validity window is 15 minutes) to avoid re-signing on every poll cycle. The `GET /compile/jobs/:id/artifact-url` endpoint returns `{url}` for direct browser-to-MinIO streaming when `MINIO_PUBLIC_URL` is set.

**Multipart uploads**: Binary files are uploaded via `POST /projects/:id/files/stream` using `multipart/form-data` (`UploadFile`), which streams directly to MinIO without loading the full file into memory.

---

## Key design decisions

**Why Yjs CRDT over OT?**
Yjs is battle-tested, has first-class Monaco integration via `y-monaco`, and handles offline merges naturally. The trade-off (larger state vectors) is acceptable for document editing.

**Why RabbitMQ over Redis Streams?**
RabbitMQ provides message acknowledgment guarantees and dead-letter queues, which are important for compilation jobs that should not be silently lost. Redis Streams would work equally well and reduce infrastructure complexity.

**Why MinIO instead of local disk?**
MinIO abstracts file storage behind an S3-compatible API, making it trivial to swap for AWS S3 or compatible services in production without code changes.

**Why SQLite in tests?**
Backend tests use `aiosqlite` in-memory databases for isolation and speed. The test `conftest.py` patches `get_db` to use a fresh SQLite DB per test session. Some PostgreSQL-specific features (native enum types) are stubbed.

**Monorepo vs multi-repo?**
Single monorepo keeps all services versioned together, simplifying local development and CI. Each service has its own `Dockerfile` and can be deployed independently.

**Why pre-warmed worker threads?**
A thread pool (configurable via `WORKER_CONCURRENCY`) eliminates cold-start latency on burst compile requests. Each thread holds its own RabbitMQ connection; per-job `OUTPUT_DIR/{job_id}/` directories prevent file races under concurrency.
