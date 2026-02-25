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
│ File management   │      │                     │
└──┬────┬────┬──────┘      └──────────┬──────────┘
   │    │    │                        │
   │    │    │  AMQP                  │ Redis snapshots
   │    │    └──────────────┐         │
   │    │                   ▼         ▼
   │    │          ┌───────────┐  ┌───────┐
   │    │          │ RabbitMQ  │  │ Redis │
   │    │          └─────┬─────┘  └───────┘
   │    │                │
   │    │                ▼
   │    │        ┌──────────────┐
   │    │        │ Worker        │
   │    │        │ pdflatex/     │
   │    │        │ xelatex/      │
   │    │        │ lualatex      │
   │    │        └──────┬────────┘
   │    │               │ PDF upload
   │    │               ▼
   │    └──────────► MinIO (S3)
   │                (files + PDFs)
   ▼
PostgreSQL
(metadata, auth, jobs)
```

---

## Service responsibilities

### Frontend (`frontend/`)

- **Framework**: React 18 + TypeScript, Vite 5
- **Editor**: Monaco Editor with custom LaTeX language registration, `\ref`/`\cite` completions, environment autocomplete
- **Collaboration**: `y-websocket` provider + `y-monaco` `MonacoBinding` for CRDT-backed editing
- **State**: Zustand for auth; TanStack React Query for server state (projects, files, compile jobs)
- **Routing**: React Router v6 — `/login`, `/register`, `/`, `/projects/:id`, `/profile`, `/verify-email`
- **PDF viewer**: `pdfjs-dist` v5 embedded directly (no iframe) for zoom, text selection, and SyncTeX double-click
- **API client**: Axios with JWT Bearer interceptor (`services/api.ts`)

Key components:
| Component | Purpose |
|-----------|---------|
| `EditorPage.tsx` | Main editor: file tree, Monaco, PDF panel, compile output |
| `DashboardPage.tsx` | Project list with search, create, delete, rename, ZIP export |
| `FileTree.tsx` | Nested file browser with `@dnd-kit` drag-and-drop |
| `DocumentOutline.tsx` | Live LaTeX section outline with click-to-navigate |
| `AIPanel.tsx` | Claude AI assistant panel (error explain, completions, rewrite) |

### Backend (`backend/app/`)

- **Framework**: FastAPI with async SQLAlchemy 2.0 (asyncpg driver), Pydantic v2
- **Entry point**: `main.py` — CORS, request logging, Prometheus metrics middleware, route registration
- **Auth**: JWT HS256 via `python-jose`, bcrypt password hashing via `passlib`
- **API routes** in `api/v1/`:
  - `auth.py` — register, verify email, login, me, change password, forgot/reset password
  - `projects.py` — project CRUD + file CRUD + ZIP export
  - `compile.py` — job submit, status, artifact, SyncTeX, logs
  - `members.py` — RBAC member management
  - `invites.py` — shareable invite links
  - `comments.py` — threaded file-anchored comments
  - `ai.py` — Claude API proxy with streaming SSE

### Collab Server (`collab-server/src/server.ts`)

- **Runtime**: Node.js with `y-websocket` WebSocket server
- **Document scope**: one `Y.Doc` per `project-{id}` room; texts keyed by file path (`ydoc.getText(filePath)`)
- **Redis persistence**: on client connect, restore snapshot; on disconnect / every 60 seconds, snapshot to Redis key `ydoc:{roomName}`; graceful-shutdown flush
- **Port**: 1234 (dev), 11234 (Docker)

### Worker (`worker/compile-worker.py`)

- **Queue**: consumes AMQP messages from `compile_jobs` queue
- **Sandbox**: unprivileged user (UID 1001), 120-second timeout, `\write18` disabled
- **Flow**: download all project files from MinIO → run `pdflatex -synctex=1 -interaction=nonstopmode` → upload PDF + `.synctex.gz` to MinIO → update job status in PostgreSQL via REST call to backend → acknowledge message
- **Error handling**: structured error extraction from pdflatex stdout (file, line, message)

---

## Data models

### Users

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `email` | String | Unique |
| `hashed_password` | String | bcrypt |
| `role` | Enum | `user` \| `admin` |
| `is_active` | Boolean | Default true |
| `email_verified` | Boolean | Default false |
| `verification_token` | String | Nullable |
| `reset_token` | String | Nullable |
| `reset_token_expires` | DateTime | Nullable |
| `created_at` | DateTime | |

### Projects

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `title` | String | |
| `owner_id` | UUID | FK → Users |
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
| `engine` | String | `pdflatex` / `xelatex` / `lualatex` |
| `pdf_key` | String | MinIO key for PDF |
| `synctex_key` | String | MinIO key for `.synctex.gz` |
| `log_output` | Text | Raw pdflatex stdout |
| `error_message` | String | Extracted error |
| `duration_seconds` | Float | |
| `created_at` / `finished_at` | DateTime | |

---

## Authentication & authorization

### JWT flow

```
POST /api/v1/auth/login
  → validate email + bcrypt password
  → issue HS256 JWT (24h default)
  → client stores token in localStorage
  → all requests: Authorization: Bearer <token>
```

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

User cursors are broadcast via `provider.awareness` with the user's email and a deterministic HSL color (`toHsla(clientId)`). Rendered in Monaco via `beforeContentClassName` CSS spans.

### Redis persistence

The collab server snapshots each `Y.Doc` as a binary state vector to Redis key `ydoc:{projectId}` on:
- Client disconnect (if no other clients remain)
- Every 60 seconds (periodic)
- SIGTERM / SIGINT (graceful shutdown)

On reconnect, the snapshot is restored before the client completes the sync handshake.

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
   │                      │                     │  run pdflatex   │
   │                      │                     │                 │
   │                      │  PATCH job status   │  upload PDF     │
   │                      │◄────────────────────┼─────────────────┤
   │  status=COMPLETED    │                     │                 │
   │◄─────────────────────┤                     │                 │
   │                      │                     │                 │
   │  GET /jobs/{id}/artifact → redirect to MinIO presigned URL   │
```

---

## File storage

All file blobs are stored in MinIO (S3-compatible). The backend stores only metadata (path, size, MIME type) in PostgreSQL and the MinIO object key.

Object key convention:
- Project files: `projects/{project_id}/{file_path}`
- Compiled PDFs: `artifacts/{job_id}/output.pdf`
- SyncTeX files: `artifacts/{job_id}/output.synctex.gz`

File access uses short-lived (15-minute) presigned URLs generated by the backend on demand. No direct MinIO access from browsers.

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
