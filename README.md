# System architecture — local, self-hosted Overleaf clone (production-grade)

# 1 — Top-level architecture (diagram)

```mermaid
flowchart LR
  subgraph Clients
    Browser[Web SPA (monaco/codemirror)]
    VSCodeExt[VS Code extension]
    CLI[CLI / Git client]
  end

  subgraph Edge
    Proxy[Ingress Proxy (nginx/Traefik)]
    Auth[Auth Service (OIDC/JWT)]
  end

  subgraph App
    API[Backend API (REST/GraphQL)]
    Collab[Collaboration Service (CRDT: yjs / y-websocket)]
    ProjectSvc[Project Service / File Index]
    GitSync[Git Integration Service]
    CompileQ[Compile Job Queue]
    WorkerPool[Compile Workers (sandboxed)]
    AI[AI Service (LLM hooks, safety)]
    Search[Full-Text Search / AST Indexer]
  end

  subgraph Data
    PG[(Postgres metadata)]
    Redis[(Redis: presence, cache, CRDT persistence)]
    MinIO[(Object store: PDFs, artifacts, files)]
    MQ[(Message queue: RabbitMQ / NATS)]
    Logs[(ELK / Loki)]
    Metrics[(Prometheus + Grafana)]
  end

  Browser -->|HTTPS + WS| Proxy
  VSCodeExt -->|HTTPS + WS| Proxy
  CLI -->|git/http| Proxy
  Proxy --> Auth
  Proxy --> API
  API --> Collab
  Collab --> Redis
  API --> ProjectSvc
  ProjectSvc --> MinIO
  API --> GitSync
  API --> CompileQ
  CompileQ --> MQ
  MQ --> WorkerPool
  WorkerPool --> MinIO
  WorkerPool --> Logs
  WorkerPool --> Metrics
  API --> AI
  AI --> Redis
  API --> Search
  API --> PG
  API --> Redis
```

---

# 2 — Components & responsibilities (with recommended stack)

Keep components small and testable. recommended stacks are pragmatic — swap for your preference.

**Client**

* Web SPA: React + Monaco (or CodeMirror) with CRDT bindings (Yjs).
* Features: editor, live preview, comments, version view, compile button.
* VS Code extension that bridges local files → remote platform (thin client).

**Ingress & Auth**

* Reverse proxy: nginx or Traefik (TLS, HTTP/2, WebSocket proxying).
* Auth: OAuth2 / OpenID Connect + JWT. Support local accounts and SSO. 2FA support.
* RBAC: owner/editor/viewer roles per project.

**Backend API**

* Framework: FastAPI (Python) or Express/Node/Go. Expose REST and GraphQL where needed.
* Responsibilities: projects, users, compile job submission, artifact retrieval, billing/quota, admin.
* Stateless; scale horizontally.

**Collaboration Service**

* CRDT engine: Yjs with y-websocket (WebSocket server).
* Persistence: snapshot CRDT document state to Redis or Postgres periodically.
* Presence: Redis for presence + cursor positions.
* Offline-first: clients can operate offline and merge via CRDT when back online.

**Project Service + Storage**

* Metadata: Postgres (projects, users, permissions, commits).
* File blobs & artifacts: S3-compatible object store (MinIO for local).
* Project layout: store canonical file tree + references to object storage.

**Git Integration**

* Git service: automatically commit snapshots or expose git endpoints.
* Sync flows: push/pull from remote Git providers, and local export/import.

**Compile Job Queue & Worker Pool**

* Job queue: RabbitMQ, NATS or Redis Streams.
* Worker pool: containerized compile workers. Workers consume jobs and run compilation in a sandbox, produce artifacts to MinIO and logs to central logging.
* Pre-warmed pool: keep a pool of prepared containers to reduce latency.

**Worker sandboxing**

* Container runtime: Docker + strong isolation layer (gVisor or Kata containers).
* Hardening: run as unprivileged user, seccomp filter, AppArmor profile, cgroups (resource limits), no network or egress via proxy whitelist, read-only mounts except a small writable overlay, disable shell-escape.
* Build environment: latexmk/pdflatex/tectonic etc. Use multiple compile images for TeXlive vs Tectonic.

**AI Service**

* Small microservice that offers:

  * grammar/citation suggestions.
  * latex snippet generation (natural language → LaTeX), code completion.
  * template generation.
* Safety: RAG use with curated docs; output filter that strips or refuses to generate system commands or arbitrary code.
* Implementation: local LLM models (if offline) or proxied to provider with prompt-safety layer.

**Search & Indexing**

* Index LaTeX AST or plain text into Elasticsearch or Postgres full-text for fast search (sections, labels, citations).
* AST diffing for semantic diffs.

**Logging & Monitoring**

* Centralized logs: Loki/ELK.
* Metrics: Prometheus + Grafana.
* Tracing: OpenTelemetry.

---

# 3 — Data model (core tables, simplified)

```
Users(id, email, hashed_pw, role, created_at)
Projects(id, owner_id, title, visibility, settings, created_at)
ProjectFiles(id, project_id, path, latest_blob_ref, size, updated_at)
Snapshots(id, project_id, commit_sha, author_id, message, created_at)
CompileJobs(id, project_id, snapshot_id, requester_id, status, logs_ref, artifact_ref, created_at, finished_at)
Permissions(project_id, user_id, role)
AIRequests(id, user_id, project_id, prompt_hash, response_ref, created_at)
```

---

# 4 — API surface (examples)

* `POST /api/v1/auth/login` — issue JWT
* `GET  /api/v1/projects` — list
* `POST /api/v1/projects` — create
* `GET  /api/v1/projects/:id/files/*path` — fetch file
* `PUT  /api/v1/projects/:id/files/*path` — save file (or CRDT persistence)
* `POST /api/v1/projects/:id/compile` — enqueue compile job
* `GET  /api/v1/compile/:job_id/status`
* `GET  /api/v1/compile/:job_id/artifact` — download PDF
* `POST /api/v1/projects/:id/snapshot` — create snapshot / git commit
* `POST /api/v1/ai/suggest` — AI suggestions (rate limited / audited)

---

# 5 — Sandbox & security rules (must-have)

* **No arbitrary shell execution:** disable `\write18` and other TeX shell escape flags by default. If needed, explicitly whitelist safe commands and run in an isolated context.
* **Container isolation:** workers run in unprivileged containers with gVisor/Kata for kernel isolation. Drop capabilities.
* **Resource limits:** enforce CPU, memory, disk, and process count limits via cgroups.
* **Filesystem:** read-only base images, writable ephemeral overlay with strict size cap.
* **No direct outbound:** network disabled by default; if network is required (package fetch during build), run in a proxied egress with URL allowlist and request logging.
* **Timeouts & watchdogs:** compilation timeouts and emergency kill on resource abuse.
* **Audit & retention:** store compile logs, stdout/stderr, and a redacted version of build outputs for auditing. Retain artifacts per policy.
* **Input sanitization:** reject files with suspicious patterns (e.g., suspicious format convertors) in CI safety checks.
* **Static analysis on templates:** run sandbox tests and escape fuzzing in CI for every compile image or template published.

---

# 6 — Local vs production deployment modes

**Local (single-machine)**

* Docker Compose:

  * API, Collab server, Redis, Postgres, MinIO, RabbitMQ, one worker.
* Good for dev, demos, and local self-host.

**Team / Production**

* Kubernetes:

  * API horizontal autoscaling, StatefulSets for collab servers, worker pools as node pools with different resource classes, MinIO in distributed mode, Postgres with high availability.
* Ingress via Traefik or nginx-ingress, cert-management (cert-manager).
* Use PodSecurityPolicies or OPA Gatekeeper to enforce runtime restrictions.

---

# 7 — CI/CD, testing, and safety pipeline

* **Source control:** git for platform code; store challenge/compile images and templates in a private registry.
* **CI checks for compile images / templates:**

  * Run escape tests (fuzzing), check resource usage, static analysis for suspicious commands.
* **Automated build & registry:** GitHub Actions / GitLab CI build images and push to registry.
* **Canary deploys:** roll new worker images to staging and run tests before production promotion.
* **Security reviews:** regular pentests on control plane and worker images.

---

# 8 — AI safety & infra (if you include AI)

* **Prompt safety & filtering:** always run AI output through a filter that blocks system-level instructions and potential shell commands.
* **Context limits:** only feed public or curated doc snippets to the model; do not include project files that contain private keys or passwords.
* **Audit logs:** store prompts & responses (with user consent) for debugging and abuse detection.
* **Rate-limits & quota:** set per-user rate limits for AI requests.
* **Local models vs cloud:** for local/offline-first options, use small local models or private LLM deployments (e.g., Llama2, Mistral). For cloud, proxy requests via your AI Service to centralize filtering.

---

# 9 — Phased implementation plan (ordered milestones)

Phase A — **MVP (local self-hosted, minimal infra)**

* Web editor (Monaco/CM) + local file saving
* Basic CRDT collaboration (Yjs + y-websocket)
* Compile button using a simple, single worker Docker container (no network)
* Postgres + MinIO for files and artifacts
* Basic auth and permissions
* Local deploy: Docker Compose

Phase B — **Stability, persistence & Git**

* Persist CRDT snapshots to Postgres/Redis
* Implement snapshot → Git commit export & import
* Add compile job queue and worker pool
* Add centralized logs & metrics

Phase C — **Security & scaling**

* Harden worker sandbox (gVisor/Kata, seccomp, AppArmor)
* Pre-warmed worker pool and job backpressure
* Add monitoring dashboards & alerting
* Add role-based access and auditing

Phase D — **Features & UX polish**

* Real-time preview, template marketplace, version diff UI
* VS Code extension thin client
* Semantic search & AST diffs
* Offline-first improvements and conflict handling

Phase E — **AI & advanced features**

* AI-assisted authoring (local model or proxied cloud)
* Citation lookup, DOI auto-fill, grammar & style suggestions
* Prompt safety and ML telemetry
* Plugin system for diagram rendering, export pipelines, and submission automation

Phase F — **Enterprise / multi-tenant**

* Multi-tenant org support, quotas, SSO (SAML/OIDC), backup & DR strategy
* HA deployment patterns & regional deployments

---

# 10 — Acceptance criteria for each phase (quality checklist)

For each deliverable check:

* Functional correctness: editor saves/loads files reliably; compilation produces PDF.
* Security: worker cannot reach internet and cannot access host files; resource limits enforced.
* Stability: CRDT merges cleanly after network partition; artifacts recoverable.
* Observability: logs + metrics available and actionable.
* Reproducibility: same project snapshot produces same PDF in CI/staging.

---

# 11 — Suggested concrete technologies (summary)

* Frontend: React + Monaco editor, Yjs for CRDT
* Backend: FastAPI (Python) or Node.js (Express / NestJS)
* DB: Postgres
* Cache/presence: Redis
* Queue: RabbitMQ or NATS
* Object store: MinIO (S3 compatible)
* Container runtime: Docker with gVisor/Kata (workers)
* CI: GitHub Actions / GitLab CI
* Monitoring: Prometheus + Grafana, Loki
* Logging: Loki or ELK
* CRDT server: y-websocket (or your own WebSocket server using yjs)
* AI: local LLM runtime (for offline) or proxied API with safety filter

---

# 12 — Risks & mitigation (quick)

* **TeX escapes & arbitrary code:** mitigate by disabling shell-escape and strict sandboxing. Run CI escape checks for templates.
* **CRDT merge surprises:** use well-tested Yjs and store snapshots; implement manual merge UI for conflicts.
* **Large projects / heavy builds:** use separate node pool for heavy builds and enforce quotas.
* **Privacy/PII in AI prompts:** strip sensitive content and require opt-in for storing prompts.