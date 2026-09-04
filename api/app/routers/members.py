from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import CurrentUser, get_current_user
from app.services.membership import get_member_profile, update_member_profile


class MemberProfileRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    birth_date: date | None = None
    employee_code: str | None = Field(default=None, max_length=100)
    position: str | None = Field(default=None, max_length=150)
    department: str | None = Field(default=None, max_length=150)


router = APIRouter(prefix="/members", tags=["members"])


@router.get("/me")
def get_me(user: CurrentUser = Depends(get_current_user)) -> dict:
    return get_member_profile(user.id)


@router.put("/me")
def update_me(request: MemberProfileRequest, user: CurrentUser = Depends(get_current_user)) -> dict:
    return update_member_profile(user.id, request.model_dump())
