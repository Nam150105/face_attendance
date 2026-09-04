from fastapi import FastAPI


app = FastAPI(title="Face Attendance Face AI", version="0.1.0")


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "face-ai"}


@app.get("/ready", tags=["system"])
async def ready() -> dict[str, str]:
    return {"status": "not_configured", "service": "face-ai"}
