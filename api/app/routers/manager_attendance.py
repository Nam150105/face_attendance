from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field

from app.auth import CurrentUser, require_role
from app.services.manager_attendance import (
    attendance_image,
    get_attendance,
    list_attendance,
    list_audit_logs,
    manual_adjust,
    member_attendance,
)


class ManualAdjustRequest(BaseModel):
    status: str | None = Field(default=None, pattern="^(SUCCESS|WARNING_CONFIRMED|BLOCKED|FAILED)$")
    server_time: datetime | None = None
    reason: str = Field(min_length=3, max_length=500)


router = APIRouter(prefix="/manager", tags=["manager-attendance"])


@router.get("/attendance")
def attendance(
    member_id: UUID | None = None,
    location_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    status: str | None = Query(default=None, pattern="^(SUCCESS|WARNING_CONFIRMED|BLOCKED|FAILED)$"),
    event_type: str | None = Query(default=None, pattern="^(CHECK_IN|CHECK_OUT)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(require_role("MANAGER")),
) -> dict:
    return list_attendance(
        user.id,
        {
            "member_id": member_id,
            "location_id": location_id,
            "date_from": date_from,
            "date_to": date_to,
            "status": status,
            "event_type": event_type,
            "limit": limit,
            "offset": offset,
        },
    )


@router.get("/attendance/{event_id}")
def attendance_detail(event_id: UUID, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return get_attendance(user.id, event_id)


@router.get("/attendance/{event_id}/image")
def attendance_evidence(event_id: UUID, user: CurrentUser = Depends(require_role("MANAGER"))) -> Response:
    content, content_type = attendance_image(user.id, event_id)
    return Response(
        content=content,
        media_type=content_type,
        headers={"Cache-Control": "private, no-store", "Content-Disposition": "inline"},
    )


@router.post("/attendance/{event_id}/manual-adjust")
def adjust(
    event_id: UUID, request: ManualAdjustRequest, user: CurrentUser = Depends(require_role("MANAGER"))
) -> dict:
    return manual_adjust(user.id, event_id, request.model_dump())


@router.get("/members/{member_id}/attendance")
def attendance_of_member(
    member_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(require_role("MANAGER")),
) -> dict:
    return member_attendance(user.id, member_id, {"limit": limit, "offset": offset})


@router.get("/audit-logs")
def audit_logs(
    entity_type: str | None = None,
    action: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(require_role("MANAGER")),
) -> dict:
    return list_audit_logs(
        user.id, {"entity_type": entity_type, "action": action, "limit": limit, "offset": offset}
    )
