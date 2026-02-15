# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Underleaf is a self-hosted collaborative LaTeX platform (Overleaf alternative). It uses a microservices architecture: a FastAPI backend, React frontend, Yjs collaboration server, and a containerized LaTeX compilation worker, connected via PostgreSQL, Redis, MinIO (S3), and RabbitMQ.

## Common Commands

### Full Stack (Docker Compose)
```bash
docker-compose -f deploy/docker-compose.dev.yml up --build
```

### Install Dependencies
```bash
make install                          # both backend + frontend
cd backend && pip install -r requirements.txt
cd frontend && npm install
```

### Run Services Individually
```bash
# Backend (requires venv + env vars from .env.example)
cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend
cd frontend && npm run dev            # http://localhost:3000

# Collab server
cd collab-server && npm install && node src/server.ts
```

### Testing
```bash
cd backend && pytest                  # all backend tests
cd backend && pytest tests/test_auth.py          # single test file
cd backend && pytest tests/test_auth.py::test_register  # single test
cd frontend && npm test               # vitest (frontend)
```

Backend tests use SQLite in-memory, override the DB dependency via `conftest.py` fixtures (`client`, `db_session`, `test_user`, `auth_headers`).

### Linting & Formatting
```bash
make lint                             # runs all linters
cd backend && black . && flake8 .     # Python
cd frontend && npm run lint           # ESLint
```

### Database Migrations (Alembic)
```bash
cd backend
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```

### Build Frontend
```bash
cd frontend && npm run build          # tsc + vite build
```

## Architecture

### Service Communication
```
Browser → Frontend (React/Vite :3000) → /api proxy → Backend (FastAPI :8000) → PostgreSQL
                                                   ↘ MinIO (file storage)
                                                   ↘ RabbitMQ → Worker (pdflatex)
         Frontend ←→ Collab Server (Yjs WebSocket :1234) ←→ Redis
```

### Backend (`backend/`)
- **Framework**: FastAPI with SQLAlchemy 2.0 ORM, Pydantic v2 schemas
- **Entry point**: `app/main.py` — mounts routes, middleware (logging, CORS, metrics)
- **API routes**: `app/api/v1/` — `auth.py` (JWT auth), `projects.py` (CRUD + files), `compile.py` (job submission)
- **Models**: `app/models/models.py` — User, Project, ProjectFile, Permission, CompileJob
- **Services**: `app/services/` — `minio_service.py`, `rabbitmq_service.py`, `redis_service.py`
- **Config**: `app/core/config.py` (Pydantic Settings from env), `security.py` (JWT/bcrypt), `database.py`, `logging.py`, `metrics.py`
- **Migrations**: `alembic/versions/`
- **Auth**: JWT HS256 tokens via OAuth2 password flow; password hashing with bcrypt

### Frontend (`frontend/`)
- **Framework**: React 18 + TypeScript, Vite build
- **State**: Zustand (`stores/auth.ts`), TanStack React Query for server state
- **Routing**: React Router v6 in `App.tsx`
- **Editor**: Monaco Editor with Yjs CRDT sync (`y-websocket`)
- **API client**: Axios with token interceptors (`services/api.ts`)
- **Pages**: `LoginPage`, `RegisterPage`, `DashboardPage` (project list), `EditorPage` (editor + compile + PDF preview)

### Collab Server (`collab-server/`)
- Yjs WebSocket server (`y-websocket`) for real-time CRDT document sync
- Runs on port 1234 (11234 in Docker)

### Worker (`worker/`)
- Python RabbitMQ consumer (`compile-worker.py`) that runs `pdflatex` in a sandboxed container
- Downloads source files from MinIO, compiles, uploads PDF artifact back to MinIO
- Runs as unprivileged user (UID 1001), 120s timeout

### Compilation Flow
1. Frontend calls `POST /api/v1/compile/jobs` with project ID
2. Backend creates CompileJob record (PENDING), publishes message to RabbitMQ
3. Worker consumes message, downloads files from MinIO, runs pdflatex
4. Worker uploads PDF to MinIO, updates job status to COMPLETED/FAILED

### Docker Compose Dev Ports
| Service    | Host Port | Notes                    |
|------------|-----------|--------------------------|
| PostgreSQL | 15432     |                          |
| Redis      | 16379     |                          |
| MinIO      | 19000     | Console at 19001         |
| RabbitMQ   | 5672      | Management UI at 15672   |
| Backend    | 18000     | OpenAPI docs at /docs    |
| Collab     | 11234     |                          |
| Frontend   | 3000      | Vite dev proxy to backend|

## Code Style

- **Python**: Black (line-length 100, target py311), flake8, mypy. asyncio_mode=auto for pytest.
- **TypeScript**: Prettier (single quotes, trailing commas es5, 2-space indent, 100 char width), ESLint with React hooks/refresh plugins.
- **Commits**: Conventional Commits format — `feat(scope):`, `fix(scope):`, `chore(scope):`
- **Branches**: `feature/<short-desc>` or `bugfix/<short-desc>`
- **Pre-commit hooks**: configured in `.pre-commit-config.yaml` (black, flake8, prettier). Run `pre-commit install` after cloning.
