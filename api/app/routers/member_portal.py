from datetime import date, datetime, time
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.auth import CurrentUser, get_current_user, require_role
from app.services.member_portal import (
    attendance_day_events,
    attendance_days,
    cancel_correction,
    create_correction,
    create_member_schedule,
    delete_member_schedule,
    list_corrections_for_manager,
    list_member_schedules,
    list_my_corrections,
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
    my_schedule,
    review_correction,
)


class CorrectionRequest(BaseModel):
    work_date: date
    request_type: str = Field(pattern="^(MISSING_CHECK_IN|MISSING_CHECK_OUT|WRONG_TIME|OTHER)$")
    requested_check_in: datetime | None = None
    requested_check_out: datetime | None = None
    reason: str = Field(min_length=3, max_length=500)


class CorrectionReviewRequest(BaseModel):
    decision: str = Field(pattern="^(APPROVED|REJECTED)$")
    note: str | None = Field(default=None, max_length=500)


class ScheduleRequest(BaseModel):
    weekday: int | None = Field(default=None, ge=0, le=6)
    work_date: date | None = None
    start_time: time
    end_time: time
    timezone: str = Field(default="Asia/Ho_Chi_Minh", max_length=64)
    grace_minutes: int = Field(default=10, ge=0, le=240)
    location_id: UUID | None = None


# --------------------------------------------------------------- member side

member_router = APIRouter(tags=["member-portal"])


@member_router.get("/attendance/me/daily")
def my_daily_attendance(
    date_from: date | None = None,
    date_to: date | None = None,
    user: CurrentUser = Depends(require_role("MEMBER")),
) -> dict:
    return attendance_days(user.id, date_from, date_to)


@member_router.get("/attendance/me/day/{work_date}")
def my_day_detail(work_date: date, user: CurrentUser = Depends(require_role("MEMBER"))) -> list[dict]:
    return attendance_day_events(user.id, work_date)


@member_router.get("/members/me/schedule")
def my_schedule_route(
    date_from: date | None = None,
    date_to: date | None = None,
    user: CurrentUser = Depends(require_role("MEMBER")),
) -> dict:
    return my_schedule(user.id, date_from, date_to)


@member_router.get("/notifications")
def my_notifications(
    unread_only: bool = False,
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    return list_notifications(user.id, unread_only, limit, offset)


@member_router.post("/notifications/{notification_id}/read")
def read_notification(notification_id: UUID, user: CurrentUser = Depends(get_current_user)) -> dict:
    return mark_notification_read(user.id, notification_id)


@member_router.post("/notifications/read-all")
def read_all_notifications(user: CurrentUser = Depends(get_current_user)) -> dict:
    return mark_all_notifications_read(user.id)


@member_router.get("/attendance/corrections")
def my_corrections(
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(require_role("MEMBER")),
) -> dict:
    return list_my_corrections(user.id, limit, offset)


@member_router.post("/attendance/corrections", status_code=201)
def submit_correction(request: CorrectionRequest, user: CurrentUser = Depends(require_role("MEMBER"))) -> dict:
    return create_correction(user.id, request.model_dump())


@member_router.delete("/attendance/corrections/{request_id}")
def withdraw_correction(request_id: UUID, user: CurrentUser = Depends(require_role("MEMBER"))) -> dict:
    return cancel_correction(user.id, request_id)


# -------------------------------------------------------------- manager side

manager_router = APIRouter(prefix="/manager", tags=["member-portal"])


@manager_router.get("/corrections")
def corrections_queue(
    status: str | None = Query(default=None, pattern="^(PENDING|APPROVED|REJECTED)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(require_role("MANAGER")),
) -> dict:
    return list_corrections_for_manager(user.id, status, limit, offset)


@manager_router.post("/corrections/{request_id}/review")
def review(
    request_id: UUID,
    request: CorrectionReviewRequest,
    user: CurrentUser = Depends(require_role("MANAGER")),
) -> dict:
    return review_correction(user.id, request_id, request.decision, request.note)


@manager_router.get("/members/{member_id}/schedules")
def member_schedules(member_id: UUID, user: CurrentUser = Depends(require_role("MANAGER"))) -> list[dict]:
    return list_member_schedules(user.id, member_id)


@manager_router.post("/members/{member_id}/schedules", status_code=201)
def add_member_schedule(
    member_id: UUID,
    request: ScheduleRequest,
    user: CurrentUser = Depends(require_role("MANAGER")),
) -> dict:
    return create_member_schedule(user.id, member_id, request.model_dump())


@manager_router.delete("/members/{member_id}/schedules/{schedule_id}")
def remove_member_schedule(
    member_id: UUID,
    schedule_id: UUID,
    user: CurrentUser = Depends(require_role("MANAGER")),
) -> dict:
    return delete_member_schedule(user.id, member_id, schedule_id)
