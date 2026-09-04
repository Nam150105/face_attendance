from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile

from app.auth import CurrentUser, require_role
from app.services.attendance import check_in, check_out, my_history, my_state


router = APIRouter(prefix="/attendance", tags=["attendance"])


@router.post("/check-in")
async def check_in_route(
    location_id: UUID = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    gps_accuracy_meters: float = Form(...),
    idempotency_key: str = Form(..., min_length=8, max_length=200),
    reason: str | None = Form(default=None, max_length=500),
    image: UploadFile = File(...),
    user: CurrentUser = Depends(require_role("MEMBER")),
) -> dict:
    return check_in(user, location_id, latitude, longitude, gps_accuracy_meters, idempotency_key, reason, await image.read(10 * 1024 * 1024 + 1), image.content_type or "image/jpeg")


@router.post("/check-out")
async def check_out_route(
    latitude: float = Form(...),
    longitude: float = Form(...),
    gps_accuracy_meters: float = Form(...),
    idempotency_key: str = Form(..., min_length=8, max_length=200),
    image: UploadFile = File(...),
    user: CurrentUser = Depends(require_role("MEMBER")),
) -> dict:
    return check_out(user, latitude, longitude, gps_accuracy_meters, idempotency_key, await image.read(10 * 1024 * 1024 + 1), image.content_type or "image/jpeg")


@router.get("/me/state")
def my_state_route(user: CurrentUser = Depends(require_role("MEMBER"))) -> dict:
    return my_state(user)


@router.get("/me")
def my_history_route(limit: int = Query(default=20, ge=1, le=100), user: CurrentUser = Depends(require_role("MEMBER"))) -> list[dict]:
    return my_history(user, limit)
