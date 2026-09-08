import logging
import os
import time

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.errors import unhandled_exception

from app.observability import (
    configure_logging,
    metrics,
    new_request_id,
    readiness,
    request_id_var,
)
from app.routers import (
    admin,
    attendance,
    auth,
    faces,
    locations,
    manager,
    manager_attendance,
    member_portal,
    members,
    teams,
)


CORS_ALLOW_ORIGINS = [origin.strip() for origin in os.environ.get("CORS_ALLOW_ORIGINS", "").split(",") if origin.strip()]

configure_logging()
logger = logging.getLogger("app.request")

app = FastAPI(title="Face Attendance API", version="0.1.0")


@app.middleware("http")
async def request_context(request: Request, call_next):
    """
    Correlate, time and log every request. The id is echoed back so a user can
    quote it in a report and an operator can find the exact line in the log.
    """
    request_id = new_request_id(request.headers.get("x-request-id"))
    request.state.request_id = request_id
    token = request_id_var.set(request_id)
    started = time.perf_counter()
    response: Response | None = None
    try:
        response = await call_next(request)
        return response
    finally:
        duration_ms = (time.perf_counter() - started) * 1000
        status_code = response.status_code if response is not None else 500
        # The route template, not the raw path: /manager/attendance/{event_id}
        # keeps metric labels bounded instead of one series per uuid.
        route = request.scope.get("route")
        path = getattr(route, "path", request.url.path)
        metrics.observe(request.method, path, status_code, duration_ms)
        logger.info(
            "request",
            extra={
                "context": {
                    "method": request.method,
                    "path": request.url.path,
                    "route": path,
                    "status": status_code,
                    "duration_ms": round(duration_ms, 1),
                }
            },
        )
        if response is not None:
            response.headers["X-Request-ID"] = request_id
        request_id_var.reset(token)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """
    The API serves evidence photos from its own origin, so anything it returns
    must not be sniffed into an active content type or framed by another site.
    """
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key"],
    expose_headers=["X-Request-ID"],
)
app.include_router(auth.router, prefix="/api/v1")
app.include_router(manager.router, prefix="/api/v1")
app.include_router(manager_attendance.router, prefix="/api/v1")
app.include_router(members.router, prefix="/api/v1")
app.include_router(locations.router, prefix="/api/v1")
app.include_router(locations.assignment_router, prefix="/api/v1")
app.include_router(locations.member_router, prefix="/api/v1")
app.include_router(faces.router, prefix="/api/v1")
app.include_router(attendance.router, prefix="/api/v1")
app.include_router(member_portal.member_router, prefix="/api/v1")
app.include_router(member_portal.manager_router, prefix="/api/v1")
app.include_router(teams.router, prefix="/api/v1")
app.include_router(teams.requests_router, prefix="/api/v1")
app.include_router(teams.member_router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")


# Anything that reaches here is a defect, not a user mistake: record it and give
# back a code instead of the internals.
app.add_exception_handler(Exception, unhandled_exception)


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    """Liveness only: the process is answering. Never touches a dependency, so
    an orchestrator does not restart a healthy API because Postgres blipped."""
    return {"status": "ok", "service": "api"}


@app.get("/ready", tags=["system"])
async def ready(response: Response) -> dict:
    """Readiness: can this instance actually serve traffic right now."""
    is_ready, checks = readiness()
    if not is_ready:
        response.status_code = 503
        logger.warning("readiness failed", extra={"context": {"checks": checks}})
    return {"status": "ready" if is_ready else "degraded", "service": "api", "checks": checks}


@app.get("/metrics", tags=["system"])
async def prometheus_metrics() -> Response:
    """Prometheus exposition. Not routed through the public proxy on purpose."""
    return Response(content=metrics.render(), media_type="text/plain; version=0.0.4; charset=utf-8")


@app.get("/api/v1", tags=["system"])
async def api_root() -> dict[str, str]:
    return {"service": "face-attendance-api", "version": "v1"}
