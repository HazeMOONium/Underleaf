# Underleaf

A self-hosted, collaborative LaTeX editor — an open-source alternative to Overleaf. Write, compile, and share LaTeX documents in real time from your own infrastructure.

---

## Features

- **Real-time collaboration** — Multiple users edit simultaneously via Yjs CRDT with live cursors, presence indicators, and join/leave toasts
- **Monaco editor** — LaTeX syntax highlighting, autocomplete (`\ref`, `\cite`, environments), inline diagnostics, duplicate `\label` detection, spell check (en-US/en-GB), Vim/Emacs keybindings, project-wide search (Ctrl+Shift+F)
- **Integrated PDF preview** — Compile with pdflatex/xelatex/lualatex/latexmk and view the PDF alongside your source; double-click to jump source ↔ PDF (SyncTeX)
- **Compile pipeline** — Engine selector per project, draft mode, structured error parsing with clickable file:line jumps, version history (snapshot per compile)
- **File management** — Nested file tree with drag-and-drop, folder creation, rename, delete, duplicate, context menu, multipart binary upload, ZIP export
- **Role-based access** — Owner / Editor / Commenter / Viewer per project, invite links, email invites, threaded file-anchored comments with notifications
- **AI assistant** — Explain compile errors, suggest completions, rewrite selections (requires Anthropic API key; streams via SSE)
- **Auth & security** — JWT with refresh tokens (httpOnly cookie), email verification, forgot/reset password, two-factor authentication (TOTP + backup codes), OAuth/SSO via Google and GitHub
- **Production-ready infra** — Docker Compose (dev + hardened prod), Kubernetes Helm chart, health/ready endpoints, Prometheus + Grafana monitoring, GitHub Actions CI

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
| Prometheus | http://localhost:19090 |
| Grafana | http://localhost:13000 |

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
                            │    Worker (pdflatex/xelatex/lualatex/latexmk)
                            │       │
                            └───────┘ (PDF + SyncTeX artifact upload)

Browser ──WS──► Collab Server (Yjs :11234) ──► Redis (pub/sub + snapshots)
```

| Service | Technology | Role |
|---------|-----------|------|
| Frontend | React 18, Vite, Monaco Editor, Yjs | SPA editor + collaboration UI |
| Backend | FastAPI, SQLAlchemy 2.0, Pydantic v2 | REST API, auth, job dispatch |
| Collab server | Node.js, y-websocket | CRDT document sync, Redis pub/sub relay |
| Worker | Python, pdflatex/latexmk | LaTeX compilation sandbox (pre-warmed pool) |
| PostgreSQL | v15 | Persistent metadata |
| Redis | v7 | Yjs snapshots, caching, pub/sub relay, OAuth CSRF state |
| MinIO | RELEASE.2024 | File + PDF + SyncTeX artifact storage |
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

# E2E (Playwright — 18 tests)
cd frontend && npx playwright test

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
| `MINIO_PUBLIC_URL` | Public MinIO URL for presigned URLs | — (optional, falls back to proxied streaming) |
| `RABBITMQ_URL` | AMQP connection URL | `amqp://guest:guest@rabbitmq/` |
| `FRONTEND_URL` | Frontend origin (for CORS + OAuth callbacks) | `http://localhost:3000` |
| `SMTP_HOST` | Email server for verification/reset/notifications | — (optional) |
| `SMTP_PORT` | Email server port | `587` |
| `SMTP_USER` | Email credentials | — (optional) |
| `SMTP_PASSWORD` | Email credentials | — (optional) |
| `ANTHROPIC_API_KEY` | Claude API key for AI assistant | — (optional) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT access token lifetime | `15` |
| `WORKER_CONCURRENCY` | Number of parallel compile workers | `2` |
| `GOOGLE_CLIENT_ID` | Google OAuth2 client ID | — (optional) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth2 client secret | — (optional) |
| `GITHUB_CLIENT_ID` | GitHub OAuth2 client ID | — (optional) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth2 client secret | — (optional) |

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
│   │   ├── api/v1/       # Route handlers (auth, projects, compile, members, invites, comments, ai, snapshots)
│   │   ├── core/         # Config, security, database, logging, metrics
│   │   ├── models/       # SQLAlchemy ORM models
│   │   ├── schemas/      # Pydantic request/response schemas
│   │   └── services/     # MinIO, RabbitMQ, Redis, email clients
│   ├── alembic/          # Database migrations (001–007)
│   └── tests/            # pytest test suite (138 tests)
├── frontend/             # React SPA
│   ├── Dockerfile        # Multi-stage: node:20 build → nginx:1.25-alpine
│   └── src/
│       ├── components/   # Reusable UI (FileTree, PDF viewer, AI panel, spell check, ...)
│       ├── pages/        # Route pages (Dashboard, Editor, Profile, OAuthCallback, ...)
│       ├── services/     # Axios API client
│       ├── stores/       # Zustand state (auth)
│       └── workers/      # Web Workers (spell check)
├── collab-server/        # Yjs WebSocket server
│   ├── Dockerfile        # node:18-alpine
│   └── src/server.ts     # Redis pub/sub relay + persistence
├── worker/               # LaTeX compile worker
│   └── compile-worker.py # Pre-warmed pool, pdflatex/xelatex/lualatex/latexmk
├── deploy/
│   ├── docker-compose.dev.yml   # Full dev stack
│   ├── docker-compose.prod.yml  # Hardened production compose
│   ├── helm/underleaf/          # Kubernetes Helm chart (8 services)
│   ├── prometheus/              # Prometheus config
│   └── grafana/                 # Auto-provisioned dashboards
└── docs/                 # Architecture, API, and roadmap docs
```

---

## Deploying to Kubernetes

A Helm chart is included for Kubernetes deployments:

```bash
# Install with custom values
helm install underleaf deploy/helm/underleaf/ \
  --set secrets.secretKey=<secret> \
  --set secrets.postgresPassword=<pg-password> \
  --set secrets.minioRootPassword=<minio-password> \
  --set ingress.host=underleaf.example.com
```

The chart provisions:
- StatefulSets for PostgreSQL, Redis, MinIO, RabbitMQ
- Deployments for Backend, Frontend, Collab Server, Worker
- nginx Ingress routing `/api` → backend, `/ws-collab` → collab, `/` → frontend
- Backend init containers for dependency health-checks and `alembic upgrade head`
- All secrets via Kubernetes Secret

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
