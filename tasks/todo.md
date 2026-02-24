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

## Remaining Items (Next Steps)
1. Engine selector (pdflatex/xelatex/lualatex per project)
2. Word/character count status bar
3. Spell check (nspell)
4. Join/leave toasts in editor
5. Snapshot history (per compile)
6. Token refresh (JWT refresh tokens)
7. New from template (dashboard)
