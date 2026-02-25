# Underleaf Improvement Plan

## Status Legend
- [ ] todo  |  [x] done  |  [-] in progress

---

## Priority 1 — Compilation & Output
- [x] Download PDF button
- [x] Structured compile error parsing (file+line+message, clickable)
- [ ] Engine selector (pdflatex/xelatex/lualatex per project)
- [x] Compile duration in logs tab

## Priority 2 — File Management
- [x] File upload drag & drop
- [x] ZIP export (backend + frontend)
- [ ] New from template (dashboard)

## Priority 3 — Editor Quality
- [x] Dynamic \ref/\cite completions from project files
- [ ] Word/character count status bar
- [ ] Spell check (nspell)

## Priority 4 — Collaboration
- [ ] Join/leave toasts
- [ ] Comment threading (reply + resolve)
- [ ] Snapshot history (per compile)
- [x] Yjs persistence to Redis

## Priority 5 — Auth & Access
- [x] Email verification on register
- [x] Profile/settings page
- [ ] Token refresh
- [x] Invite by email
- [x] Forgot/Reset password

## Priority 6 — DevOps
- [x] GET /health and GET /ready endpoints
- [ ] Structured JSON logging
- [x] docker-compose.prod.yml (previously done)
- [x] GitHub Actions CI

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

## Remaining Items (Next Steps)
1. Engine selector (pdflatex/xelatex/lualatex per project)
2. Word/character count status bar
3. Spell check (nspell)
4. Join/leave toasts in editor
5. Snapshot history (per compile)
6. Token refresh (JWT refresh tokens)
7. New from template (dashboard)
