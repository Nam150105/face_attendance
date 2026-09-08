from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile

from app.auth import CurrentUser
from app.services.permissions import require_screen
from app.security import MAX_IMAGE_BYTES, enforce_rate_limit, validate_image_upload
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
    user: CurrentUser = Depends(require_screen("attendance")),
) -> dict:
    enforce_rate_limit("attendance", str(user.id), limit=20, window_seconds=60)
    content = await image.read(MAX_IMAGE_BYTES + 1)
    media_type = validate_image_upload(content)
    return check_in(
        user, location_id, latitude, longitude, gps_accuracy_meters,
        idempotency_key, reason, content, media_type,
    )


@router.post("/check-out")
async def check_out_route(
    latitude: float = Form(...),
    longitude: float = Form(...),
    gps_accuracy_meters: float = Form(...),
    idempotency_key: str = Form(..., min_length=8, max_length=200),
    image: UploadFile = File(...),
    user: CurrentUser = Depends(require_screen("attendance")),
) -> dict:
    enforce_rate_limit("attendance", str(user.id), limit=20, window_seconds=60)
    content = await image.read(MAX_IMAGE_BYTES + 1)
    media_type = validate_image_upload(content)
    return check_out(user, latitude, longitude, gps_accuracy_meters, idempotency_key, content, media_type)


@router.get("/me/state")
def my_state_route(user: CurrentUser = Depends(require_screen("attendance"))) -> dict:
    return my_state(user)


@router.get("/me")
def my_history_route(limit: int = Query(default=20, ge=1, le=100), user: CurrentUser = Depends(require_screen("attendance"))) -> list[dict]:
    return my_history(user, limit)
