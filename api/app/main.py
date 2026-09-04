from fastapi import FastAPI

from app.routers import auth, faces, locations, manager, members


app = FastAPI(title="Face Attendance API", version="0.1.0")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(manager.router, prefix="/api/v1")
app.include_router(members.router, prefix="/api/v1")
app.include_router(locations.router, prefix="/api/v1")
app.include_router(locations.assignment_router, prefix="/api/v1")
app.include_router(locations.member_router, prefix="/api/v1")
app.include_router(faces.router, prefix="/api/v1")


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "api"}


@app.get("/ready", tags=["system"])
async def ready() -> dict[str, str]:
    return {"status": "ready", "service": "api"}


@app.get("/api/v1", tags=["system"])
async def api_root() -> dict[str, str]:
    return {"service": "face-attendance-api", "version": "v1"}
