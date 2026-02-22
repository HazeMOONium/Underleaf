# Contributing

Thank you for helping build this self-hosted collaborative LaTeX platform. This document explains how to get the code, run the project locally, fix bugs, add features, and open high-quality pull requests.

**Quick links**
- Issue tracker: `https://github.com/<org>/<repo>/issues`
- Code of Conduct: `CODE_OF_CONDUCT.md`
- Security reporting: `SECURITY.md`

---

## Table of contents
- [Before you start](#before-you-start)
- [Project layout](#project-layout)
- [Requirements](#requirements)
- [Quick start (Docker Compose)](#quick-start-docker-compose)
- [Run services individually (dev)](#run-services-individually-dev)
- [Database migrations](#database-migrations)
- [Testing](#testing)
- [Style & linting](#style--linting)
- [Working on features](#working-on-features)
- [Pull request process](#pull-request-process)
- [How to report bugs or suggest features](#how-to-report-bugs-or-suggest-features)
- [Security & responsible disclosure](#security--responsible-disclosure)
- [Contacts & communication](#contacts--communication)

---

## Before you start
* Read the `README.md` for the project purpose and architecture overview.
* Read and follow the `CODE_OF_CONDUCT.md`.
* Open an issue first for any non-trivial feature or breaking change — we prefer discussing scope before code.

---

## Project layout (top-level)
- backend → FastAPI service (Python)
- frontend → React SPA (Monaco/CodeMirror)
- collab-server → Yjs websocket server (or integrated in backend)
- worker → Compile worker Docker image
- deploy → docker-compose and Kubernetes manifests
- docs → design docs, API contracts, contributor guides

---

## Requirements
Install the following on your machine for local development:

- Docker & Docker Compose (v2+)
- Node.js (18+)
- Python 3.11+ (only for running backend locally without Docker)
- `make` (optional, convenient targets)
- (Optional) `psql` for DB introspection

We provide a `.env.example` — copy to `.env` and fill values before `docker-compose up`.

---

## Quick start (Docker Compose - recommended for contributors)

1. Clone the repo:
```bash
git clone https://github.com/<org>/<repo>.git
cd <repo>
cp .env.example .env
# Edit .env if necessary
```
2. docker compose -f deploy/docker-compose.dev.yml up --build
3. Open:
    - Frontend: http://localhost:3000
    - Backend API: http://localhost:8000 (OpenAPI at /docs)
    - Collaboration WS: ws://localhost:1234 (if using y-websocket)
4. Compile a test project:
    - Create a new project in the UI and press Compile — the job will be queued and a worker will run the compilation in an isolated container. Artifacts (PDF) are stored in MinIO.

---

## Run services individually (for development)
### Backend (run without Docker)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# set environment variables (see .env.example)
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Collaboration server (Yjs)
If we use `y-websocket`:
```bash
cd collab-server
npm install
node server.js
```
### Worker (compile)
Worker is designed to run in Docker; you can run a dev worker locally via:
```bash
# build image
docker build -t latex-worker:dev -f worker/Dockerfile .
# run a single worker
docker run --rm --env-file .env -v $(pwd)/worker/sandbox:/sandbox latex-worker:dev
```
The worker listens to the job queue and runs compilation jobs in an inner sandbox.

---
## Database migrations
We use Alembic for migrations.

From backend:
```bash
# generate migration (after changing models)
alembic revision --autogenerate -m "describe change"
# apply
alembic upgrade head
```
If running in Docker Compose, the `db` service will be available as `postgres:5432` and migrations can run via the backend service entrypoint.

---
## Testing
- Backend tests: `cd backend && pytest`

- Frontend tests: `cd frontend && npm test` (or `npm run test:ci`)

- Linting: run `make lint` (or `cd backend && black . && flake8 .` and `cd frontend && npm run lint`)

Write unit tests for new backend logic and basic integration tests for compile flows (mock the queue where appropriate).

---
## Style & linting
### Python

- Format: `black`
- Type checking: `mypy` (optional)
- Lint: `flake8`

### JavaScript / TypeScript

- Format: `prettier`
- Lint: `eslint` (config included)

Add a `pre-commit` configuration; run `pre-commit install` after cloning.

---

## Working on features
1. Create an issue with the feature summary and proposed design. Link any relevant architecture docs in `/docs`.
2. Branch naming: `feature/<short-desc>` or `bugfix/<short-desc>`. Use hyphens, keep it short.
3. Implement incrementally. Add tests for logic and basic integration tests for user-visible changes.
4. Add or update docs in `/docs` and update `README.md` where relevant.
5. Add migration files if DB schema changes.

---
## Pull request process

* Open a PR from your branch to main (or develop if we use branching strategy).
* PR checklist (add as checklist in PR description):
    * Linked issue
    * Tests added / updated
    * Lint passes locally
    * Security considerations documented
    * DB migrations included (if needed)

* Use descriptive PR titles and include before/after screenshots for UI changes.

* At least one approving review required; two approvals for critical infra changes.

* Squash or rebase to keep history tidy (we use conventional commits — see below).

**Commit messages**
Follow Conventional Commits (https://www.conventionalcommits.org/):
```java
feat(scope): short description
fix(scope): short description
chore(ci): tweak pipeline
```

---

## How to report bugs or suggest features
* Create an issue. Use templates:
    * `bug_report.md` (steps to reproduce, logs, env)
    * `feature_request.md` (motivation, acceptance criteria)
* Provide minimal reproduction steps and any relevant logs (`backend` logs, `worker` stack traces).

---

## Security & responsible disclosure
Do **not** post security issues publicly. See `SECURITY.md` for the contact email and disclosure process. For serious findings (sandbox escape, secret leak), include steps to reproduce and any logs but only share via the secure channel listed in `SECURITY.md`.

---

## Onboarding for new contributors
- Read `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.
- Run the Docker Compose environment and verify you can create a project and perform a compile.
- Check open issues labeled `good first issue` for a low-risk start.

---

## Additional guidelines
- Keep PRs reasonably sized: prefer multiple small PRs to one giant change.
- Document API changes in `docs/openapi.md` (or commit OpenAPI JSON/YAML).
- Tag breaking changes clearly in PR description.

---

Thanks again — contributions make this platform better. If anything in this guide is unclear or out of date, open an issue labeled `meta:contributing`.
