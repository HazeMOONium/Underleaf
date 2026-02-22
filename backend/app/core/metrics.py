from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from fastapi import Request
from fastapi.responses import Response

http_requests_total = Counter(
    "http_requests_total",
    "Total number of HTTP requests",
    ["method", "path", "status"]
)

http_request_duration_seconds = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "path"]
)

compile_jobs_total = Counter(
    "compile_jobs_total",
    "Total number of compile jobs"
)

compile_jobs_failed = Counter(
    "compile_jobs_failed",
    "Total number of failed compile jobs"
)


async def metrics(request: Request):
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
