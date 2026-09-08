"""
Screen permissions.

A row in `role_permissions` says a role may *open* a screen. It never says whose
data appears there: every service still cuts its result to the viewer's own
scope through `visible_member_ids`. So granting a member the records screen
shows them their own records, not the whole organisation's.

Write actions stay pinned to the role that owns them — a permission grant opens
a door, it does not hand out a manager's authority.
"""

from __future__ import annotations

import uuid
from typing import Annotated

import psycopg
from fastapi import Depends, HTTPException, status

from app.auth import CurrentUser, DATABASE_URL, get_current_user


SCREENS: tuple[str, ...] = (
    "home",
    "attendance",
    "history",
    "my-locations",
    "my-corrections",
    "notifications",
    "profile",
    "team-overview",
    "records",
    "members",
    "locations",
    "corrections",
    "audit",
    "admin-overview",
    "admin-users",
    "admin-records",
    "admin-roles",
    "admin-data",
)

# Screens the super admin can never lock itself out of; without these there is
# no way back into the permission editor once a tick is cleared by mistake.
LOCKED_FOR_SUPER_ADMIN = ("admin-overview", "admin-roles")


def allowed_screens(role: str) -> list[str]:
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            "SELECT screen FROM role_permissions WHERE role = %s::user_role AND can_view", (role,)
        ).fetchall()
    return [row[0] for row in rows]


def require_screen(screen: str):
    if screen not in SCREENS:
        raise ValueError(f"unknown screen: {screen}")

    def dependency(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
        with psycopg.connect(DATABASE_URL) as connection:
            row = connection.execute(
                "SELECT can_view FROM role_permissions WHERE role = %s::user_role AND screen = %s",
                (user.role, screen),
            ).fetchone()
        if row is None or not row[0]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SCREEN_NOT_ALLOWED")
        return user

    return dependency


def visible_member_ids(connection: psycopg.Connection, user: CurrentUser) -> list[uuid.UUID] | None:
    """
    Whose attendance this viewer may see. None means everyone — only the super
    admin gets that. A manager sees their own record alongside their group's,
    because a manager who checks in is also somebody's attendance row.
    """
    if user.role == "SUPER_ADMIN":
        return None
    if user.role == "MANAGER":
        rows = connection.execute(
            "SELECT member_user_id FROM manager_memberships WHERE manager_user_id = %s AND status = 'ACTIVE'",
            (user.id,),
        ).fetchall()
        return [user.id] + [row[0] for row in rows]
    return [user.id]


def assert_can_see_member(connection: psycopg.Connection, user: CurrentUser, member_id: uuid.UUID) -> None:
    visible = visible_member_ids(connection, user)
    if visible is not None and member_id not in visible:
        raise HTTPException(status_code=404, detail="Member is outside your scope")
