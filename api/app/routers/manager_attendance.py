from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field

from app.auth import CurrentUser, require_role
from app.security import safe_image_content_type
from app.services.manager_attendance import (
    attendance_calendar,
    attendance_image,
    delete_attendance,
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


@router.get("/attendance/calendar")
def attendance_month(
    month: str = Query(pattern=r"^\d{4}-\d{2}$"),
    user: CurrentUser = Depends(require_role("MANAGER")),
) -> dict:
    return attendance_calendar(user.id, month)


@router.get("/attendance/{event_id}")
def attendance_detail(event_id: UUID, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return get_attendance(user.id, event_id)


@router.get("/attendance/{event_id}/image")
def attendance_evidence(event_id: UUID, user: CurrentUser = Depends(require_role("MANAGER"))) -> Response:
    content, content_type = attendance_image(user.id, event_id)
    return Response(
        content=content,
        media_type=safe_image_content_type(content_type),
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/attendance/{event_id}/manual-adjust")
def adjust(
    event_id: UUID, request: ManualAdjustRequest, user: CurrentUser = Depends(require_role("MANAGER"))
) -> dict:
    return manual_adjust(user.id, event_id, request.model_dump())


@router.delete("/attendance/{event_id}")
def remove_attendance(
    event_id: UUID,
    reason: str = Query(min_length=3, max_length=500),
    user: CurrentUser = Depends(require_role("MANAGER")),
) -> dict:
    """Soft delete, always with a reason and always written to the audit log."""
    return delete_attendance(user.id, event_id, reason)


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
