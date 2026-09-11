from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field

from app.auth import CurrentUser
from app.services.permissions import require_action, require_screen
from app.security import safe_image_content_type
from app.services.manager_attendance import (
    attendance_calendar,
    attendance_image,
    attendance_sessions,
    delete_attendance,
    delete_attendance_day,
    enrollment_photo,
    get_attendance,
    list_attendance,
    list_audit_logs,
    login_history,
    manual_adjust,
    member_attendance,
)


class ManualAdjustRequest(BaseModel):
    """
    Everything a person may correct on one record.

    The verdict is the status, and `failure_code` says which half went wrong —
    the same two fields the system fills in when it judges a record itself.

    Left out on purpose: face_match_score, face_distance and distance_meters.
    Those are measurements, and a corrected record that carries an invented
    score is worse than one that was never corrected.
    """

    status: str | None = Field(default=None, pattern="^(SUCCESS|WARNING_CONFIRMED|BLOCKED|FAILED)$")
    failure_code: str | None = Field(default=None, pattern="^(FACE_NOT_MATCHED|OUTSIDE_ALLOWED_ZONE)$")
    server_time: datetime | None = None
    location_id: UUID | None = None
    note: str | None = Field(default=None, max_length=500)
    # Required for managers, checked in the service where the role is known.
    reason: str | None = Field(default=None, max_length=500)


router = APIRouter(prefix="/manager", tags=["manager-attendance"])


@router.get("/attendance")
def attendance(
    member_id: UUID | None = None,
    location_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    status: str | None = Query(default=None, pattern="^(SUCCESS|WARNING_CONFIRMED|BLOCKED|FAILED)$"),
    event_type: str | None = Query(default=None, pattern="^(CHECK_IN|CHECK_OUT)$"),
    include_invalid: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(require_screen("records")),
) -> dict:
    return list_attendance(
        user,
        {
            "include_invalid": include_invalid,
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


@router.get("/attendance/sessions")
def attendance_pairs(
    member_id: UUID | None = None,
    location_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    include_invalid: bool = Query(default=False),
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(require_screen("records")),
) -> dict:
    """Paired check-in / check-out, one row per person per day."""
    return attendance_sessions(
        user,
        {
            "member_id": member_id,
            "location_id": location_id,
            "date_from": date_from,
            "date_to": date_to,
            "include_invalid": include_invalid,
            "limit": limit,
            "offset": offset,
        },
    )


@router.get("/attendance/calendar")
def attendance_month(
    month: str = Query(pattern=r"^\d{4}-\d{2}$"),
    include_invalid: bool = Query(default=False),
    user: CurrentUser = Depends(require_screen("records")),
) -> dict:
    return attendance_calendar(user, month, include_invalid)


@router.get("/attendance/{event_id}")
def attendance_detail(event_id: UUID, user: CurrentUser = Depends(require_screen("records"))) -> dict:
    return get_attendance(user, event_id)


@router.get("/attendance/{event_id}/image")
def attendance_evidence(event_id: UUID, user: CurrentUser = Depends(require_screen("records"))) -> Response:
    content, content_type = attendance_image(user, event_id)
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
    event_id: UUID, request: ManualAdjustRequest, user: CurrentUser = Depends(require_action("records", "edit"))
) -> dict:
    # exclude_unset keeps "not mentioned" apart from "explicitly set to null".
    return manual_adjust(user, event_id, request.model_dump(exclude_unset=True))


@router.delete("/attendance/day")
def remove_attendance_day(
    member_id: UUID,
    work_date: date,
    reason: str = Query(min_length=3, max_length=500),
    user: CurrentUser = Depends(require_action("records", "delete")),
) -> dict:
    """
    Delete a working day, both halves of it.

    Declared before /attendance/{event_id} so "day" is read as a path and not
    as a malformed uuid.
    """
    return delete_attendance_day(user, member_id, work_date, reason)


@router.delete("/attendance/{event_id}")
def remove_attendance(
    event_id: UUID,
    reason: str = Query(min_length=3, max_length=500),
    user: CurrentUser = Depends(require_action("records", "delete")),
) -> dict:
    """Soft delete, always with a reason and always written to the audit log."""
    return delete_attendance(user, event_id, reason)


@router.get("/members/{member_id}/attendance")
def attendance_of_member(
    member_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(require_screen("records")),
) -> dict:
    return member_attendance(user, member_id, {"limit": limit, "offset": offset})


@router.get("/audit-logs")
def audit_logs(
    entity_type: str | None = None,
    action: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(require_screen("audit")),
) -> dict:
    return list_audit_logs(
        user.id, {"entity_type": entity_type, "action": action, "limit": limit, "offset": offset}
    )


@router.get("/members/{member_id}/face-photo")
def member_face_photo(member_id: UUID, user: CurrentUser = Depends(require_screen("records"))) -> Response:
    content, content_type = enrollment_photo(user, member_id)
    return Response(
        content=content,
        media_type=safe_image_content_type(content_type),
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/members/{member_id}/login-history")
def member_login_history(
    member_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    user: CurrentUser = Depends(require_screen("records")),
) -> dict:
    return login_history(user, member_id, limit)
