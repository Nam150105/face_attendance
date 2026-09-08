from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.auth import CurrentUser, require_role
from app.services.admin import (
    delete_user,
    list_all_attendance,
    list_users,
    overview,
    purge_attendance,
    reset_user_password,
    restore_attendance,
    update_user,
)


class UserUpdateRequest(BaseModel):
    role: str | None = Field(default=None, pattern="^(MEMBER|MANAGER|SUPER_ADMIN)$")
    status: str | None = Field(default=None, pattern="^(ACTIVE|SUSPENDED|INVITED)$")


class PasswordResetRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=200)


class ReasonRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


from app.services.admin_data import (
    browse_table,
    delete_row,
    insert_row,
    list_permissions,
    list_tables,
    set_permission,
    update_row,
)


router = APIRouter(prefix="/admin", tags=["admin"])
admin_only = require_role("SUPER_ADMIN")


@router.get("/overview")
def system_overview(user: CurrentUser = Depends(admin_only)) -> dict:
    return overview()


@router.get("/users")
def users(
    search: str | None = None,
    role: str | None = Query(default=None, pattern="^(MEMBER|MANAGER|SUPER_ADMIN)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(admin_only),
) -> dict:
    return list_users(search, role, limit, offset)


@router.put("/users/{user_id}")
def change_user(user_id: UUID, request: UserUpdateRequest, user: CurrentUser = Depends(admin_only)) -> dict:
    return update_user(user.id, user_id, request.model_dump(exclude_none=True))


@router.post("/users/{user_id}/password")
def set_password(user_id: UUID, request: PasswordResetRequest, user: CurrentUser = Depends(admin_only)) -> dict:
    return reset_user_password(user.id, user_id, request.new_password)


@router.delete("/users/{user_id}")
def remove_user(user_id: UUID, reason: str = Query(min_length=3, max_length=500),
                user: CurrentUser = Depends(admin_only)) -> dict:
    return delete_user(user.id, user_id, reason)


@router.get("/attendance")
def all_attendance(
    member_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    include_deleted: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(admin_only),
) -> dict:
    return list_all_attendance(
        {
            "member_id": member_id,
            "date_from": date_from,
            "date_to": date_to,
            "include_deleted": include_deleted,
            "limit": limit,
            "offset": offset,
        }
    )


@router.delete("/attendance/{event_id}")
def purge(event_id: UUID, reason: str = Query(min_length=3, max_length=500),
          user: CurrentUser = Depends(admin_only)) -> dict:
    return purge_attendance(user.id, event_id, reason)


@router.post("/attendance/{event_id}/restore")
def restore(event_id: UUID, user: CurrentUser = Depends(admin_only)) -> dict:
    return restore_attendance(user.id, event_id)


# ------------------------------------------------------------- permissions

class PermissionRequest(BaseModel):
    role: str = Field(pattern="^(MEMBER|MANAGER|SUPER_ADMIN)$")
    screen: str = Field(min_length=1, max_length=64)
    can_view: bool


@router.get("/permissions")
def permissions(user: CurrentUser = Depends(admin_only)) -> dict:
    return list_permissions()


@router.put("/permissions")
def change_permission(request: PermissionRequest, user: CurrentUser = Depends(admin_only)) -> dict:
    return set_permission(user.id, request.role, request.screen, request.can_view)


# ------------------------------------------------------------- data browser

class RowRequest(BaseModel):
    values: dict


@router.get("/data")
def tables(user: CurrentUser = Depends(admin_only)) -> dict:
    return list_tables()


@router.get("/data/{table}")
def rows(
    table: str,
    search: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(admin_only),
) -> dict:
    return browse_table(table, search, limit, offset)


@router.post("/data/{table}", status_code=201)
def create_row(table: str, request: RowRequest, user: CurrentUser = Depends(admin_only)) -> dict:
    return insert_row(user.id, table, request.values)


@router.put("/data/{table}/{row_id}")
def edit_row(table: str, row_id: str, request: RowRequest, user: CurrentUser = Depends(admin_only)) -> dict:
    return update_row(user.id, table, row_id, request.values)


@router.delete("/data/{table}/{row_id}")
def remove_row(table: str, row_id: str, user: CurrentUser = Depends(admin_only)) -> dict:
    return delete_row(user.id, table, row_id)
