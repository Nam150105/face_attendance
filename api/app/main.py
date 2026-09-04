import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import attendance, auth, faces, locations, manager, members


CORS_ALLOW_ORIGINS = [origin.strip() for origin in os.environ.get("CORS_ALLOW_ORIGINS", "").split(",") if origin.strip()]

app = FastAPI(title="Face Attendance API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(auth.router, prefix="/api/v1")
app.include_router(manager.router, prefix="/api/v1")
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
