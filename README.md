# Underleaf

A self-hosted, collaborative LaTeX editor — an open-source alternative to Overleaf. Write, compile, and share LaTeX documents in real time from your own infrastructure.

---

## Features

- **Real-time collaboration** — Multiple users edit simultaneously via Yjs CRDT with live cursors and presence indicators
- **Monaco editor** — LaTeX syntax highlighting, autocomplete (`\ref`, `\cite`, environments), and inline diagnostics
- **Integrated PDF preview** — Compile with pdflatex/xelatex/lualatex and view the PDF alongside your source; double-click to jump source ↔ PDF (SyncTeX)
- **File management** — Nested file tree, drag-and-drop upload, folder creation, rename, delete, ZIP export
- **Role-based access** — Owner / Editor / Commenter / Viewer per project, invite links, email invites
- **Comments** — Threaded, file-anchored comments with resolve/re-open flow
- **AI assistant** — Explain compile errors, suggest completions, rewrite selections (requires Anthropic API key)
- **Auth & profiles** — JWT auth, email verification, forgot/reset password, profile page
- **Production-ready infra** — Docker Compose, health/ready endpoints, GitHub Actions CI, Prometheus metrics

---

## Quick Start

### Prerequisites

- Docker & Docker Compose v2+
- Git

### 1. Clone and configure

```bash
git clone https://github.com/<your-org>/underleaf.git
cd underleaf
cp .env.example .env
# Edit .env — at minimum set SECRET_KEY, POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD
```

### 2. Start all services

```bash
docker-compose -f deploy/docker-compose.dev.yml up --build
```

### 3. Open the app

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API + docs | http://localhost:18000/docs |
| MinIO console | http://localhost:19001 |
| RabbitMQ management | http://localhost:15672 |

Register an account, create a project, and click **Compile** to run your first build.

---

## Architecture

```
Browser ──HTTPS+WS──► Frontend (React/Vite :3000)
                          │
                          │ /api proxy
                          ▼
                     Backend (FastAPI :18000)
                     │       │       │
                     ▼       ▼       ▼
                PostgreSQL  MinIO  RabbitMQ
                            │       │
                            │       ▼
                            │    Worker (pdflatex)
                            │       │
                            └───────┘ (PDF artifact upload)

Browser ──WS──► Collab Server (Yjs :11234) ──► Redis
```

| Service | Technology | Role |
|---------|-----------|------|
| Frontend | React 18, Vite, Monaco Editor, Yjs | SPA editor + collaboration UI |
| Backend | FastAPI, SQLAlchemy 2.0, Pydantic v2 | REST API, auth, job dispatch |
| Collab server | Node.js, y-websocket | CRDT document sync |
| Worker | Python, pdflatex | LaTeX compilation sandbox |
| PostgreSQL | v15 | Persistent metadata |
| Redis | v7 | Yjs snapshots, caching |
| MinIO | RELEASE.2024 | File + PDF artifact storage |
| RabbitMQ | v3 | Compile job queue |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for detailed design documentation.

---

## Development Setup (without Docker)

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# Export env vars from .env, then:
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:3000
```

### Collab server

```bash
cd collab-server
npm install
node src/server.ts
```

### Database migrations

```bash
cd backend
alembic upgrade head
# After model changes:
alembic revision --autogenerate -m "describe change"
```

---

## Testing

```bash
# Backend (138 tests)
cd backend && pytest

# Single file or test
cd backend && pytest tests/test_auth.py
cd backend && pytest tests/test_auth.py::test_register

# Frontend (Vitest)
cd frontend && npm test

# All linters
make lint
```

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | JWT signing secret | — (required) |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql+asyncpg://...` |
| `REDIS_URL` | Redis connection URL | `redis://redis:6379` |
| `MINIO_ENDPOINT` | MinIO host:port | `minio:9000` |
| `MINIO_ROOT_USER` | MinIO access key | — (required) |
| `MINIO_ROOT_PASSWORD` | MinIO secret key | — (required) |
| `RABBITMQ_URL` | AMQP connection URL | `amqp://guest:guest@rabbitmq/` |
| `SMTP_HOST` | Email server for verification/reset | — (optional) |
| `SMTP_PORT` | Email server port | `587` |
| `SMTP_USER` | Email credentials | — (optional) |
| `SMTP_PASSWORD` | Email credentials | — (optional) |
| `ANTHROPIC_API_KEY` | Claude API key for AI assistant | — (optional) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT lifetime | `1440` (24h) |

---

## API Reference

Full API documentation is available at `http://localhost:18000/docs` (Swagger UI) when the backend is running.

See [`docs/API.md`](docs/API.md) for a complete endpoint reference.

---

## Project Structure

```
underleaf/
├── backend/              # FastAPI service
│   ├── app/
│   │   ├── api/v1/       # Route handlers (auth, projects, compile, ...)
│   │   ├── core/         # Config, security, database, logging
│   │   ├── models/       # SQLAlchemy ORM models
│   │   ├── schemas/      # Pydantic request/response schemas
│   │   └── services/     # MinIO, RabbitMQ, Redis, email clients
│   ├── alembic/          # Database migrations
│   └── tests/            # pytest test suite (138 tests)
├── frontend/             # React SPA
│   └── src/
│       ├── components/   # Reusable UI (FileTree, PDF viewer, AI panel, ...)
│       ├── pages/        # Route pages (Dashboard, Editor, Profile, ...)
│       ├── services/     # Axios API client
│       └── stores/       # Zustand state (auth)
├── collab-server/        # Yjs WebSocket server
│   └── src/server.ts
├── worker/               # LaTeX compile worker
│   └── compile-worker.py
├── deploy/               # Docker Compose, Dockerfiles
└── docs/                 # Architecture, API, and roadmap docs
```

---

## Roadmap

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the full feature roadmap and improvement plan.

**Next milestone highlights:**
- LaTeX engine selector (pdflatex / xelatex / lualatex per project)
- JWT refresh tokens
- Spell check with nspell
- New project from template
- Snapshot / version history

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). In short:

1. Fork, create a branch (`feature/<desc>` or `bugfix/<desc>`)
2. Run `pre-commit install` after cloning
3. Write tests for any new logic
4. Submit a PR with a clear description and before/after screenshots for UI changes

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(scope):`, `fix(scope):`, `chore(scope):`.

---

## License

[MIT](LICENSE)
