"""
Screen and action permissions.

Two separate questions, and conflating them is how systems end up handing a
supervisor who should read the attendance records the power to erase them:

  can_view    may this role open the screen at all
  can_create  may it add rows there
  can_edit    may it change existing rows
  can_delete  may it remove rows

A grant opens a door; it never widens whose data is behind it. Every service
still cuts its result to the caller's own scope through `visible_member_ids`
and `managed_by`, so giving a member the records screen shows them their own
records and nothing else.
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
    "join-requests",
    "face-requests",
    "locations",
    "corrections",
    "audit",
    "admin-overview",
    "admin-users",
    "admin-records",
    "admin-roles",
    "admin-data",
    "admin-errors",
)

ACTIONS: tuple[str, ...] = ("view", "create", "edit", "delete")

# What each role gets when the grid is reset. Letters are the actions: "v" view,
# "c" create, "e" edit, "d" delete.
#
# Migration 014 seeds the same shape. The duplication is deliberate: the
# migration records what was installed on that date and must never change, while
# this table is what "back to defaults" means today.
DEFAULT_PERMISSIONS: dict[str, tuple[str, str, str]] = {
    # screen:            MEMBER   MANAGER  SUPER_ADMIN
    "home":              ("v",    "v",     "v"),
    "attendance":        ("v",    "v",     "v"),
    "history":           ("v",    "v",     "v"),
    "my-locations":      ("v",    "v",     "v"),
    "my-corrections":    ("v",    "v",     "v"),
    "notifications":     ("v",    "v",     "v"),
    "profile":           ("v",    "v",     "v"),
    "team-overview":     ("",     "v",     "v"),
    "records":           ("",     "ved",   "vced"),
    "members":           ("",     "vced",  "vced"),
    "join-requests":     ("",     "ve",    "ve"),
    "face-requests":     ("",     "ve",    "ve"),
    "locations":         ("",     "vced",  "vced"),
    "corrections":       ("",     "ve",    "vced"),
    "audit":             ("",     "v",     "v"),
    "admin-overview":    ("",     "",      "v"),
    "admin-users":       ("",     "",      "vced"),
    "admin-records":     ("",     "",      "vced"),
    "admin-roles":       ("",     "",      "ve"),
    "admin-data":        ("",     "",      "vced"),
    "admin-errors":      ("",     "",      "vd"),
}

ROLE_ORDER = ("MEMBER", "MANAGER", "SUPER_ADMIN")

# Screens the super admin can never lock itself out of; without these there is
# no way back into the permission editor once a tick is cleared by mistake.
LOCKED_FOR_SUPER_ADMIN = ("admin-overview", "admin-roles")

_COLUMN = {action: f"can_{action}" for action in ACTIONS}


def permissions_for(role: str) -> dict[str, dict[str, bool]]:
    """The whole row set for one role, keyed by screen."""
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            "SELECT screen, can_view, can_create, can_edit, can_delete"
            " FROM role_permissions WHERE role = %s::user_role",
            (role,),
        ).fetchall()
    return {
        row[0]: {"view": row[1], "create": row[2], "edit": row[3], "delete": row[4]}
        for row in rows
    }


def allowed_screens(role: str) -> list[str]:
    return [screen for screen, actions in permissions_for(role).items() if actions["view"]]


def _assert_allowed(role: str, screen: str, action: str) -> None:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            f"SELECT {_COLUMN[action]} FROM role_permissions"
            " WHERE role = %s::user_role AND screen = %s",
            (role, screen),
        ).fetchone()
    if row is None or not row[0]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SCREEN_NOT_ALLOWED" if action == "view" else f"ACTION_NOT_ALLOWED:{action}",
        )


def require_screen(screen: str):
    """For reads: may this role open the screen."""
    return require_action(screen, "view")


def require_action(screen: str, action: str):
    """For writes: may this role do this particular thing on that screen."""
    if screen not in SCREENS:
        raise ValueError(f"unknown screen: {screen}")
    if action not in ACTIONS:
        raise ValueError(f"unknown action: {action}")

    def dependency(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
        _assert_allowed(user.role, screen, action)
        return user

    return dependency


# ------------------------------------------------------------------- scoping

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


def managed_by(user: CurrentUser) -> uuid.UUID | None:
    """
    Whose locations and roster this viewer is working on. None means "anyone's",
    which is what makes the super admin's authority real rather than a menu item
    that leads to a refusal.
    """
    return None if user.role == "SUPER_ADMIN" else user.id


def owner_filter(owner: uuid.UUID | None, column: str = "manager_user_id") -> tuple[str, list]:
    """SQL for "rows this viewer owns", or every row when they own the system."""
    if owner is None:
        return "TRUE", []
    return f"{column} = %s", [owner]


def assert_can_see_member(connection: psycopg.Connection, user: CurrentUser, member_id: uuid.UUID) -> None:
    visible = visible_member_ids(connection, user)
    if visible is not None and member_id not in visible:
        raise HTTPException(status_code=404, detail="Member is outside your scope")
