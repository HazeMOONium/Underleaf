# Underleaf Implementation Plan

## Current Status
- **Phase 1: Foundation & Infrastructure** - ✅ COMPLETE
- **Phase 2: Backend Core API** - ✅ COMPLETE
- **Phase 3: Collaboration Service** - ✅ COMPLETE (basic)
- **Phase 4: Compile Worker** - ✅ COMPLETE
- **Phase 5: Frontend Editor** - ✅ COMPLETE (MVP)
- **Phase 7: Monitoring** - ✅ COMPLETE (logging & health checks)

## Project Overview
Self-hosted collaborative LaTeX platform (Overleaf clone) with real-time collaboration, compile workers, and cloud-native architecture.

---

## Implementation Strategy

### Core Principle: Bottom-Up Foundation
Start with infrastructure and build outward:
1. **Infrastructure First** → Database, storage, messaging
2. **Backend Core** → API, auth, file management
3. **Collaboration Layer** → Real-time sync
4. **Compile System** → Worker and job queue
5. **Frontend** → Editor and UI
6. **Advanced Features** → AI, Git, monitoring

---

## Phase 1: Foundation & Infrastructure

### 1.1 Project Structure Setup
- [X] Create directory structure:
  ```
  /backend          # FastAPI application
  /frontend         # React SPA
  /collab-server    # Yjs websocket server
  /worker           # Compile worker Docker image
  /deploy           # Docker Compose & K8s manifests
  /docs             # Design docs, API contracts
  /tests            # Shared test utilities
  ```
- [X] Initialize Python backend with FastAPI
- [X] Initialize Node.js for collab-server
- [X] Initialize React frontend with TypeScript
- [X] Set up `pyproject.toml` and `package.json` with proper dependencies
- [X] Configure Prettier, ESLint, Black, Flake8

### 1.2 Docker Compose Development Environment
- [X] Create `deploy/docker-compose.dev.yml`
- [X] Add services: postgres, redis, minio, rabbitmq
- [X] Configure networking between services
- [X] Add health checks for all services
- [X] Create `.env.example` with all required variables

### 1.3 Database Setup (PostgreSQL)
- [X] Define SQLAlchemy models in `backend/app/models/`
  - [X] User (id, email, hashed_password, role, created_at)
  - [X] Project (id, owner_id, title, visibility, settings, created_at)
  - [X] ProjectFile (id, project_id, path, blob_ref, size, updated_at)
  - [X] Permission (project_id, user_id, role)
  - [X] CompileJob (id, project_id, status, logs_ref, artifact_ref, created_at, finished_at)
- [X] Set up Alembic for migrations
- [X] Create initial migration

### 1.4 Object Storage Setup (MinIO)
- [X] Configure MinIO bucket: `underleaf-files`
- [X] Create MinIO client utility in backend
- [X] Implement file upload/download methods

### 1.5 Message Queue Setup (RabbitMQ)
- [X] Configure RabbitMQ connection in backend
- [X] Define queues: `compile_jobs`, `job_results`
- [X] Create message schemas (Pydantic models)

---

## Phase 2: Backend Core API

### 2.1 Authentication System
- [X] Implement JWT token generation/validation
- [X] Create auth endpoints:
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh`
  - `GET  /api/v1/auth/me`
- [X] Add password hashing with bcrypt
- [X] Implement session management

### 2.2 Project Management
- [X] CRUD endpoints for projects:
  - `POST   /api/v1/projects` - Create project
  - `GET    /api/v1/projects` - List user projects
  - `GET    /api/v1/projects/{id}` - Get project details
  - `PATCH  /api/v1/projects/{id}` - Update project
  - `DELETE /api/v1/projects/{id}` - Delete project
- [X] Implement project ownership and permissions

### 2.3 File Management
- [X] Implement file CRUD:
  - `GET    /api/v1/projects/{id}/files` - List files
  - `GET    /api/v1/projects/{id}/files/*path` - Get file
  - `PUT    /api/v1/projects/{id}/files/*path` - Create/update file
  - `DELETE /api/v1/projects/{id}/files/*path` - Delete file
- [X] Integrate with MinIO for blob storage
- [X] Implement file tree structure

### 2.4 Compile Job Endpoints
- [X] `POST /api/v1/projects/{id}/compile` - Submit compile job
- [X] `GET  /api/v1/compile/{job_id}/status` - Get job status
- [X] `GET  /api/v1/compile/{job_id}/artifact` - Download PDF
- [X] Implement job status tracking (pending, running, completed, failed)

---

## Phase 3: Collaboration Service

### 3.1 Yjs WebSocket Server
- [ ] Set up `y-websocket` server or custom implementation
- [ ] Configure Redis for presence and persistence
- [ ] Implement connection handling and room management

### 3.2 Document Persistence
- [ ] Implement CRDT state snapshots to PostgreSQL
- [ ] Add periodic snapshot saving (e.g., every 5 minutes)
- [ ] Handle document loading and restoration

### 3.3 Presence System
- [ ] Track user cursor positions
- [ ] Display active users in editor
- [ ] Handle user join/leave events

---

## Phase 4: Compile Worker System

### 4.1 Worker Docker Image
- [X] Create `worker/Dockerfile`
- [X] Include: LaTeX distribution (TeX Live or Tectonic)
- [X] Set up inner sandbox environment
- [X] Configure resource limits (CPU, memory, disk)

### 4.2 Compile Orchestrator
- [X] Create job submission handler
- [X] Implement job validation (file size, timeout)
- [X] Set up RabbitMQ consumer for compile jobs

### 4.3 Security Policies
- [X] Disable `\write18` and shell-escape by default
- [X] Implement file pattern validation
- [X] Add compile timeout enforcement
- [X] Configure read-only filesystem with overlay

### 4.4 Artifact Management
- [X] Store compiled PDFs in MinIO
- [X] Capture and store compile logs
- [X] Implement artifact retrieval endpoint

---

## Phase 5: Frontend Editor

### 5.1 React Application Setup
- [X] Set up React with TypeScript and Vite
- [X] Configure routing with React Router
- [X] Set up state management (Zustand or React Query)
- [X] Add authentication context

### 5.2 Editor Component
- [X] Integrate Monaco Editor or CodeMirror
- [X] Add LaTeX syntax highlighting
- [X] Implement file tree sidebar
- [X] Create tab system for multiple files

### 5.3 Real-time Collaboration UI
- [X] Connect to Yjs websocket
- [X] Display remote cursors
- [X] Show active collaborators
- [X] Handle connection status

### 5.4 Compile Integration
- [X] Add compile button with loading state
- [X] Display compile status and progress
- [X] Show PDF preview (embedded viewer)
- [X] Display compile errors with line references

### 5.5 Project Dashboard
- [X] Create project list view
- [X] Add project creation modal
- [X] Implement settings panel
- [X] Add file upload/download

---

## Phase 6: Git Integration (Phase B)

### 6.1 Git Service
- [ ] Implement Git commands (init, add, commit, push, pull)
- [ ] Create Git remote management
- [ ] Add SSH key management for remotes

### 6.2 Snapshot Export
- [ ] `POST /api/v1/projects/{id}/snapshot/export` - Export to Git
- [ ] `POST /api/v1/projects/{id}/snapshot/import` - Import from Git
- [ ] Implement webhook for Git push events

---

## Phase 7: Monitoring & Observability (Phase C)

### 7.1 Logging
- [X] Integrate structured logging (JSON format)
- [X] Set up log aggregation (ELK or Loki)
- [X] Add request ID tracking

### 7.2 Metrics
- [ ] Add Prometheus metrics endpoint
- [ ] Track: compile duration, success rate, queue depth
- [ ] Create Grafana dashboards

### 7.3 Health Checks
- [X] Implement `/health` endpoints for all services
- [X] Add readiness and liveness probes
- [X] Configure Docker health checks

---

## Phase 8: Security Hardening (Phase C)

### 8.1 Worker Sandbox
- [ ] Implement gVisor or Kata Containers
- [ ] Configure seccomp filters
- [ ] Set up AppArmor profiles
- [ ] Add network isolation (no egress)

### 8.2 Rate Limiting
- [ ] Add API rate limiting
- [ ] Implement per-user quotas
- [ ] Configure compile limits

### 8.3 RBAC
- [ ] Implement owner/editor/viewer roles
- [ ] Add permission checks on all endpoints
- [ ] Create admin endpoints

---

## Phase 9: Advanced Features (Phase D-F)

### 9.1 AI Assistant (Phase E)
- [ ] Create AI service endpoint
- [ ] Implement LaTeX suggestion generation
- [ ] Add safety filtering for prompts
- [ ] Set up rate limiting

### 9.2 Search (Phase D)
- [ ] Implement full-text search
- [ ] Add LaTeX AST indexer
- [ ] Create search UI

### 9.3 Offline Support (Phase D)
- [ ] Implement service worker
- [ ] Add IndexedDB for local storage
- [ ] Handle sync on reconnection

---

## Implementation Order Summary

| Priority | Component | Phase |
|----------|-----------|-------|
| 1 | Project structure & Docker Compose | 1 |
| 2 | Database models & migrations | 1 |
| 3 | MinIO & RabbitMQ integration | 1 |
| 4 | Auth system (JWT) | 2 |
| 5 | Project & file CRUD | 2 |
| 6 | Compile job endpoints | 2 |
| 7 | Yjs websocket server | 3 |
| 8 | Document persistence | 3 |
| 9 | Worker Docker image | 4 |
| 10 | Compile orchestration | 4 |
| 11 | React frontend | 5 |
| 12 | Editor integration | 5 |
| 13 | Git integration | 6 |
| 14 | Monitoring/logging | 7 |
| 15 | Security hardening | 8 |
| 16 | AI features | 9 |

---

## Tech Stack Summary

| Layer | Technology |
|-------|------------|
| Frontend | React, Monaco Editor, Yjs |
| Backend | FastAPI (Python), SQLAlchemy |
| Database | PostgreSQL |
| Cache/Presence | Redis |
| Object Storage | MinIO |
| Message Queue | RabbitMQ |
| Collaboration | Yjs, y-websocket |
| Container Runtime | Docker, gVisor/Kata |
| CI/CD | GitHub Actions |

---

## Notes

- Start with Phase 1-2 to get a working MVP
- Each phase should produce working code, not just documentation
- Run integration tests at each phase boundary
- Use feature flags for incomplete features
- Document API contracts in `docs/openapi.md`
