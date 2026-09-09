from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr, Field

from app.auth import CurrentUser
from app.services.permissions import require_action, require_screen
from app.services.manager_attendance import manager_dashboard
from app.services.membership import (
    add_member_by_email,
    bulk_add_members,
    get_managed_member,
    list_manager_members,
    update_membership,
)


router = APIRouter(prefix="/manager", tags=["manager"])


@router.get("/dashboard")
def dashboard(user: CurrentUser = Depends(require_screen("team-overview"))) -> dict:
    return manager_dashboard(user.id)


class AddMemberRequest(BaseModel):
    email: EmailStr
    team_id: UUID | None = None


class BulkAddRequest(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=200)


class MembershipUpdateRequest(BaseModel):
    status: str


@router.get("/members")
def members(user: CurrentUser = Depends(require_screen("members"))) -> list[dict]:
    return list_manager_members(user)


@router.post("/members/add-by-email", status_code=201)
def add_member(request: AddMemberRequest, user: CurrentUser = Depends(require_action("members", "create"))) -> dict:
    return add_member_by_email(user, str(request.email), request.team_id)


@router.post("/members/bulk-add", status_code=201)
def add_members(request: BulkAddRequest, user: CurrentUser = Depends(require_action("members", "create"))) -> dict:
    return bulk_add_members(user, request.emails)


@router.get("/members/{member_id}")
def member_detail(member_id: UUID, user: CurrentUser = Depends(require_screen("members"))) -> dict:
    return get_managed_member(user, member_id)


@router.put("/members/{member_id}")
def change_membership(member_id: UUID, request: MembershipUpdateRequest, user: CurrentUser = Depends(require_action("members", "edit"))) -> dict:
    return update_membership(user, member_id, request.status)


@router.delete("/members/{member_id}")
def remove_member(member_id: UUID, user: CurrentUser = Depends(require_action("members", "delete"))) -> dict:
    return update_membership(user, member_id, "REMOVED")
