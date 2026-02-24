from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from uuid import uuid4
import time

from app.core.config import get_settings
from app.core.logging import get_logger, request_id_var
from app.core.metrics import http_requests_total, http_request_duration_seconds, metrics
from app.api.v1 import auth, projects, compile, ai, members, invites, comments

logger = get_logger(__name__)
settings = get_settings()


class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid4())
        request_id_var.set(request_id)
        
        start_time = time.time()
        response = await call_next(request)
        duration = time.time() - start_time
        
        http_requests_total.labels(
            method=request.method,
            path=request.url.path,
            status=response.status_code
        ).inc()
        
        http_request_duration_seconds.labels(
            method=request.method,
            path=request.url.path
        ).observe(duration)
        
        logger.info(
            f"{request.method} {request.url.path} {response.status_code} {duration:.3f}s",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration": duration,
                "request_id": request_id
            }
        )
        
        return response

app = FastAPI(
    title=settings.APP_NAME,
    description="Self-hosted collaborative LaTeX platform - Backend API",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(LoggingMiddleware)

app.include_router(auth.router, prefix=settings.API_V1_PREFIX)
app.include_router(projects.router, prefix=settings.API_V1_PREFIX)
app.include_router(compile.router, prefix=settings.API_V1_PREFIX)
app.include_router(ai.router, prefix=settings.API_V1_PREFIX)
app.include_router(members.router, prefix=settings.API_V1_PREFIX)
app.include_router(invites.project_invites_router, prefix=settings.API_V1_PREFIX)
app.include_router(invites.public_invites_router, prefix=settings.API_V1_PREFIX)
app.include_router(comments.router, prefix=settings.API_V1_PREFIX)


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/ready")
async def ready_check():
    """Readiness probe — verifies DB and Redis are reachable."""
    import asyncio
    from fastapi.responses import JSONResponse
    from app.core.database import engine
    from app.services.redis_service import redis_service

    errors: list[str] = []

    # Check PostgreSQL
    try:
        with engine.connect() as conn:
            from sqlalchemy import text
            conn.execute(text("SELECT 1"))
    except Exception as exc:
        errors.append(f"db: {exc}")

    # Check Redis (attempt a GET on a sentinel key; any response = reachable)
    try:
        await asyncio.wait_for(redis_service.get("__ready__"), timeout=2.0)
    except Exception as exc:
        errors.append(f"redis: {exc}")

    if errors:
        return JSONResponse(status_code=503, content={"status": "not ready", "errors": errors})
    return {"status": "ready"}


@app.get("/metrics")
async def metrics_endpoint(request: Request):
    return await metrics(request)
