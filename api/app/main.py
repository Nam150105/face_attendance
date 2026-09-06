import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.routers import attendance, auth, faces, locations, manager, manager_attendance, members


CORS_ALLOW_ORIGINS = [origin.strip() for origin in os.environ.get("CORS_ALLOW_ORIGINS", "").split(",") if origin.strip()]

app = FastAPI(title="Face Attendance API", version="0.1.0")


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


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "api"}


@app.get("/ready", tags=["system"])
async def ready() -> dict[str, str]:
    return {"status": "ready", "service": "api"}


@app.get("/api/v1", tags=["system"])
async def api_root() -> dict[str, str]:
    return {"service": "face-attendance-api", "version": "v1"}
