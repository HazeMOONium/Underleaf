# API Reference

Base URL: `http://localhost:18000/api/v1`

All endpoints that require authentication expect an `Authorization: Bearer <token>` header.

Interactive documentation is available at `http://localhost:18000/docs` (Swagger UI) and `http://localhost:18000/redoc`.

---

## Table of Contents

- [Authentication](#authentication)
- [Projects](#projects)
- [Files](#files)
- [Compile](#compile)
- [Snapshots](#snapshots)
- [Members](#members)
- [Invites](#invites)
- [Comments](#comments)
- [AI](#ai)
- [System](#system)

---

## Authentication

### POST /auth/register

Create a new account. Sends a verification email if SMTP is configured.

**Request body**
```json
{ "email": "user@example.com", "password": "minimum6chars" }
```

**Response** `201`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "role": "user",
  "is_active": true,
  "email_verified": false,
  "created_at": "2026-01-01T00:00:00Z"
}
```

---

### POST /auth/verify-email

Verify email address using the token from the verification email.

**Request body**
```json
{ "token": "verification-token-from-email" }
```

**Response** `200`
```json
{ "message": "Email verified successfully" }
```

---

### POST /auth/login

Authenticate and receive a JWT access token. Sets an httpOnly `refresh_token` cookie.

If the account has 2FA enabled, returns a session token instead of a JWT.

**Request body** (form data or JSON)
```json
{ "username": "user@example.com", "password": "yourpassword" }
```

**Response** `200` — 2FA disabled
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer"
}
```

**Response** `200` — 2FA enabled
```json
{
  "requires_2fa": true,
  "session_token": "short-lived-session-token"
}
```

---

### POST /auth/refresh

Rotate the refresh token and issue a new access token. Reads the refresh token from the httpOnly `refresh_token` cookie.

**Auth**: cookie only (no Bearer header required)

**Response** `200`
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer"
}
```

**Errors**
- `401` — missing, invalid, or expired refresh token

---

### POST /auth/logout

Revoke the current refresh token and clear the cookie.

**Auth**: required

**Response** `200`
```json
{ "message": "Logged out successfully" }
```

---

### GET /auth/me

Get the currently authenticated user.

**Auth**: required

**Response** `200`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "role": "user",
  "is_active": true,
  "email_verified": true,
  "totp_enabled": false,
  "created_at": "2026-01-01T00:00:00Z"
}
```

---

### PUT /auth/me/password

Change the authenticated user's password.

**Auth**: required

**Request body**
```json
{ "current_password": "old", "new_password": "new-minimum-6-chars" }
```

**Response** `200`
```json
{ "message": "Password changed successfully" }
```

**Errors**
- `400` — current password incorrect
- `400` — new password too short

---

### POST /auth/forgot-password

Request a password reset email.

**Request body**
```json
{ "email": "user@example.com" }
```

**Response** `200` — always returns 200 (no email enumeration)
```json
{ "message": "If the email exists, a reset link has been sent" }
```

---

### POST /auth/reset-password

Reset password using the token from the reset email.

**Request body**
```json
{ "token": "reset-token", "new_password": "new-minimum-6-chars" }
```

**Response** `200`
```json
{ "message": "Password reset successfully" }
```

**Errors**
- `400` — invalid or expired token

---

### POST /auth/2fa/enable

Generate a TOTP secret and return a QR code URI. 2FA is not yet active until verified.

**Auth**: required

**Response** `200`
```json
{
  "secret": "BASE32SECRET",
  "qr_uri": "otpauth://totp/Underleaf:user@example.com?secret=...&issuer=Underleaf"
}
```

---

### POST /auth/2fa/verify

Confirm 2FA setup by submitting a live TOTP code. Activates 2FA and returns one-time backup codes.

**Auth**: required

**Request body**
```json
{ "code": "123456" }
```

**Response** `200`
```json
{
  "message": "2FA enabled",
  "backup_codes": ["abc123", "def456", "..."]
}
```

**Errors**
- `400` — invalid TOTP code

---

### POST /auth/2fa/disable

Disable 2FA. Requires a valid TOTP code or backup code.

**Auth**: required

**Request body**
```json
{ "code": "123456" }
```

**Response** `200`
```json
{ "message": "2FA disabled" }
```

---

### POST /auth/2fa/login

Exchange the session token (from a 2FA-gated login) + TOTP code for a full JWT.

**Request body**
```json
{ "session_token": "...", "code": "123456" }
```

**Response** `200`
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer"
}
```

**Errors**
- `401` — invalid or expired session token
- `400` — invalid TOTP code

---

### GET /auth/oauth/{provider}

Initiate OAuth login. Redirects the browser to the provider's authorization page.

Supported providers: `google`, `github`

**Response** `302` — redirect to provider

---

### GET /auth/oauth/{provider}/callback

OAuth callback endpoint. Validates state, exchanges the authorization code for a user profile, finds or creates a local account, and issues a JWT.

**Response** `302` — redirect to `/auth/callback?token=<jwt>`

**Errors**
- `400` — invalid or missing state parameter
- `500` — provider API error

---

## Projects

### GET /projects

List all projects accessible to the authenticated user (owned + shared).

**Auth**: required

**Response** `200`
```json
[
  {
    "id": "uuid",
    "title": "My Paper",
    "owner_id": "uuid",
    "engine": "pdflatex",
    "created_at": "2026-01-01T00:00:00Z"
  }
]
```

---

### POST /projects

Create a new project. Optionally create from a built-in template.

**Auth**: required

**Request body**
```json
{ "title": "My New Project", "template": "article" }
```

`template` is optional. Available values: `article`, `beamer`, `report`, `cv`. Defaults to a minimal blank template.

**Response** `201` — same shape as GET /projects item

---

### GET /projects/{project_id}

Get a single project by ID.

**Auth**: required (must be owner or have permission)

**Response** `200` — same shape as GET /projects item

---

### PATCH /projects/{project_id}

Update project title or engine.

**Auth**: required (owner only)

**Request body** (all fields optional)
```json
{ "title": "Updated Title", "engine": "xelatex" }
```

Available engines: `pdflatex`, `xelatex`, `lualatex`, `latexmk`

**Response** `200` — updated project

---

### DELETE /projects/{project_id}

Delete a project and all its files, jobs, snapshots, permissions, and MinIO objects.

**Auth**: required (owner only)

**Response** `204`

---

### GET /projects/{project_id}/export/zip

Download all project files as a ZIP archive.

**Auth**: required (viewer+ role)

**Response** `200` — `application/zip` stream

---

## Files

### GET /projects/{project_id}/files

List all files in a project.

**Auth**: required (viewer+ role)

**Response** `200`
```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "path": "main.tex",
    "content_type": "text/plain",
    "size": 1234,
    "created_at": "...",
    "updated_at": "..."
  }
]
```

---

### POST /projects/{project_id}/files

Create or update a text file.

**Auth**: required (editor+ role)

**Request body**
```json
{ "path": "sections/intro.tex", "content": "\\section{Introduction}\n..." }
```

**Response** `200` — file metadata object

---

### POST /projects/{project_id}/files/upload

Upload a binary file (images, fonts, etc.) encoded as base64.

**Auth**: required (editor+ role)

**Request body**
```json
{
  "path": "figures/diagram.png",
  "content_base64": "<base64-encoded-bytes>",
  "content_type": "image/png"
}
```

**Response** `200` — file metadata object

---

### POST /projects/{project_id}/files/stream

Upload a binary file via multipart form data. Preferred for large files (>5 MB).

**Auth**: required (editor+ role)

**Request**: `multipart/form-data`
- `file` — the file to upload
- `path` — destination path in the project

**Response** `200` — file metadata object

---

### GET /projects/{project_id}/files/{file_path}

Read the content of a text file, or get a presigned download URL for binary files.

**Auth**: required (viewer+ role)

**Response** `200`
- For text files:
```json
{ "path": "main.tex", "content": "\\documentclass{article}..." }
```
- For binary files: `307 Redirect` to a 15-minute presigned MinIO URL

---

### PATCH /projects/{project_id}/files/{file_path}

Rename a file (move to a new path).

**Auth**: required (editor+ role)

**Request body**
```json
{ "new_path": "sections/introduction.tex" }
```

**Response** `200` — updated file metadata

---

### DELETE /projects/{project_id}/files/{file_path}

Delete a file.

**Auth**: required (editor+ role)

**Response** `204`

---

## Compile

### POST /compile/jobs

Submit a new compile job for a project.

**Auth**: required (editor+ role for the project)

**Request body**
```json
{ "project_id": "uuid", "draft": false }
```

`draft: true` passes `-draftmode` to the engine for fast syntax checking without PDF output.

**Response** `201`
```json
{
  "id": "uuid",
  "project_id": "uuid",
  "status": "pending",
  "engine": "pdflatex",
  "draft": false,
  "created_at": "..."
}
```

---

### GET /compile/jobs/{job_id}

Get full compile job details.

**Auth**: required (must have access to the job's project)

**Response** `200`
```json
{
  "id": "uuid",
  "project_id": "uuid",
  "requester_id": "uuid",
  "status": "completed",
  "engine": "pdflatex",
  "draft": false,
  "pdf_key": "artifacts/uuid/output.pdf",
  "duration_seconds": 3.14,
  "created_at": "...",
  "finished_at": "..."
}
```

---

### GET /compile/jobs/{job_id}/status

Poll job status. Lightweight endpoint for the frontend polling loop. Auto-creates a Snapshot when the job transitions to `completed`.

**Auth**: required

**Response** `200`
```json
{ "status": "pending" | "running" | "completed" | "failed" }
```

---

### GET /compile/jobs/{job_id}/artifact

Download the compiled PDF. Redirects to a presigned MinIO URL.

**Auth**: required

**Response** `307 Redirect` → PDF download URL

**Errors**
- `404` — job not completed or PDF not available

---

### GET /compile/jobs/{job_id}/artifact-url

Return a cached presigned URL for direct browser-to-MinIO PDF streaming. Requires `MINIO_PUBLIC_URL` to be configured; falls back to blob streaming otherwise.

**Auth**: required

**Response** `200`
```json
{ "url": "http://minio:9000/artifacts/uuid/output.pdf?X-Amz-Signature=..." }
```

---

### GET /compile/jobs/{job_id}/synctex

Download the SyncTeX file (`.synctex.gz`) for source ↔ PDF position mapping.

**Auth**: required

**Response** `307 Redirect` → `.synctex.gz` download URL

---

### GET /compile/jobs/{job_id}/logs

Get raw pdflatex output log.

**Auth**: required

**Response** `200`
```json
{
  "log": "This is pdfTeX, Version 3.141592...\n..."
}
```

---

## Snapshots

Snapshots are auto-created after each successful compile. They record the PDF artifact and a human-readable label.

### GET /projects/{project_id}/snapshots

List all snapshots for a project in reverse-chronological order.

**Auth**: required (viewer+ role)

**Response** `200`
```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "compile_job_id": "uuid",
    "label": "2026-03-01 14:23",
    "artifact_ref": "artifacts/uuid/output.pdf",
    "created_at": "..."
  }
]
```

---

### GET /projects/{project_id}/snapshots/{snapshot_id}/artifact

Stream the historical PDF for a snapshot.

**Auth**: required (viewer+ role)

**Response** `200` — `application/pdf` stream (or `307 Redirect` to presigned URL)

---

### PATCH /projects/{project_id}/snapshots/{snapshot_id}

Rename the snapshot label.

**Auth**: required (editor+ role)

**Request body**
```json
{ "label": "First submission draft" }
```

**Response** `200` — updated snapshot object

---

### DELETE /projects/{project_id}/snapshots/{snapshot_id}

Delete a snapshot record (does not delete the underlying PDF artifact).

**Auth**: required (editor+ role)

**Response** `204`

---

## Members

### GET /projects/{project_id}/members

List all members (owner + collaborators) for a project.

**Auth**: required (must be a member)

**Response** `200`
```json
[
  {
    "user_id": "uuid",
    "email": "owner@example.com",
    "role": "owner"
  },
  {
    "user_id": "uuid",
    "email": "collab@example.com",
    "role": "editor"
  }
]
```

---

### POST /projects/{project_id}/members

Add a collaborator by email.

**Auth**: required (owner only)

**Request body**
```json
{ "email": "collab@example.com", "role": "editor" }
```

Roles: `editor` | `commenter` | `viewer`

**Response** `201` — member object

**Errors**
- `404` — user with that email not found
- `409` — user is already a member

---

### PATCH /projects/{project_id}/members/{user_id}

Update a collaborator's role.

**Auth**: required (owner only)

**Request body**
```json
{ "role": "viewer" }
```

**Response** `200` — updated member object

---

### DELETE /projects/{project_id}/members/{user_id}

Remove a collaborator from the project.

**Auth**: required (owner only)

**Response** `204`

---

## Invites

### POST /projects/{project_id}/invites

Create a shareable invite link.

**Auth**: required (owner only)

**Request body**
```json
{
  "role": "editor",
  "expires_at": "2026-03-01T00:00:00Z",
  "max_uses": 10
}
```

All fields optional except `role`.

**Response** `201`
```json
{
  "id": "uuid",
  "project_id": "uuid",
  "token": "abc123...",
  "role": "editor",
  "expires_at": null,
  "max_uses": null,
  "use_count": 0,
  "created_by": "uuid"
}
```

---

### GET /projects/{project_id}/invites

List all active invite links for a project.

**Auth**: required (owner only)

**Response** `200` — array of invite objects

---

### DELETE /projects/{project_id}/invites/{invite_id}

Revoke an invite link.

**Auth**: required (owner only)

**Response** `204`

---

### GET /invites/{token}

Preview an invite without accepting it. Used to show project details on the invite acceptance page.

**Auth**: not required

**Response** `200`
```json
{
  "project_title": "My Paper",
  "role": "editor",
  "inviter_email": "owner@example.com"
}
```

**Errors**
- `404` — invalid or expired token

---

### POST /invites/{token}/accept

Accept an invite and join the project.

**Auth**: required (the joining user)

**Response** `200` — member object with the granted role

**Errors**
- `404` — invalid, expired, or exhausted token
- `409` — already a member

---

## Comments

### GET /projects/{project_id}/comments

List all comments for a project, optionally filtered by file path.

**Auth**: required (commenter+ role)

**Query params**
- `file_path` (optional) — filter by file

**Response** `200`
```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "author_id": "uuid",
    "author_email": "user@example.com",
    "file_path": "main.tex",
    "line": 42,
    "content": "Should cite Smith 2024 here",
    "parent_id": null,
    "resolved": false,
    "created_at": "...",
    "updated_at": "..."
  }
]
```

---

### POST /projects/{project_id}/comments

Create a comment (or reply to an existing one). Sends an email notification via `BackgroundTasks` if SMTP is configured.

**Auth**: required (commenter+ role)

**Request body**
```json
{
  "file_path": "main.tex",
  "line": 42,
  "content": "Should cite Smith 2024 here",
  "parent_id": null
}
```

**Response** `201` — comment object

---

### PATCH /projects/{project_id}/comments/{comment_id}

Update comment content or resolve/re-open. Sends a resolution notification if `resolved` changes to `true`.

**Auth**: required (comment author or owner)

**Request body** (all fields optional)
```json
{
  "content": "Updated text",
  "resolved": true
}
```

**Response** `200` — updated comment object

---

### DELETE /projects/{project_id}/comments/{comment_id}

Delete a comment.

**Auth**: required (comment author or owner)

**Response** `204`

---

## AI

### POST /ai/assist

Request AI assistance from Claude. Streams the response as Server-Sent Events.

**Auth**: required

**Request body**
```json
{
  "mode": "explain_error" | "suggest" | "rewrite",
  "context": "surrounding LaTeX or error log",
  "selection": "selected text (for rewrite mode)",
  "file_content": "full file content (for context)"
}
```

**Response** `200` — `text/event-stream`

Each SSE event:
```
data: {"delta": "partial response text"}
```

Final event:
```
data: {"done": true}
```

**Errors**
- `503` — `ANTHROPIC_API_KEY` not configured

---

## System

### GET /health

Liveness check. Always returns 200 if the process is running.

**Auth**: not required

**Response** `200`
```json
{ "status": "healthy" }
```

---

### GET /ready

Readiness check. Verifies connectivity to PostgreSQL and Redis.

**Auth**: not required

**Response** `200` — all dependencies reachable
```json
{ "status": "ready" }
```

**Response** `503` — one or more dependencies unavailable
```json
{
  "status": "not ready",
  "errors": ["database: connection refused", "redis: timeout"]
}
```

---

### GET /metrics

Prometheus metrics endpoint.

**Auth**: not required

**Response** `200` — Prometheus text format (request counts, latencies, compile throughput, etc.)
