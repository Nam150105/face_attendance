from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr, Field

from app.auth import CurrentUser, require_role
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
def dashboard(user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return manager_dashboard(user.id)


class AddMemberRequest(BaseModel):
    email: EmailStr


class BulkAddRequest(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=200)


class MembershipUpdateRequest(BaseModel):
    status: str


@router.get("/members")
def members(user: CurrentUser = Depends(require_role("MANAGER"))) -> list[dict]:
    return list_manager_members(user.id)


@router.post("/members/add-by-email", status_code=201)
def add_member(request: AddMemberRequest, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return add_member_by_email(user.id, str(request.email))


@router.post("/members/bulk-add", status_code=201)
def add_members(request: BulkAddRequest, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return bulk_add_members(user.id, request.emails)


@router.get("/members/{member_id}")
def member_detail(member_id: UUID, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return get_managed_member(user.id, member_id)


@router.put("/members/{member_id}")
def change_membership(member_id: UUID, request: MembershipUpdateRequest, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return update_membership(user.id, member_id, request.status)


@router.delete("/members/{member_id}")
def remove_member(member_id: UUID, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return update_membership(user.id, member_id, "REMOVED")
