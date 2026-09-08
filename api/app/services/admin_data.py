"""
Super-admin surfaces: the screen-permission grid and a controlled row editor.

The row editor reaches a fixed list of tables through fixed shapes. An open SQL
box would mean one stolen admin session is one DROP TABLE away from ending the
business, and no audit trail worth the name.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal

import psycopg
from fastapi import HTTPException

from app.auth import DATABASE_URL
from app.services.admin import _audit
from app.services.permissions import LOCKED_FOR_SUPER_ADMIN, SCREENS


ROLES = ("MEMBER", "MANAGER", "SUPER_ADMIN")


# --------------------------------------------------------------- permissions

def list_permissions() -> dict:
    """The whole tick grid in one call: which role may open which screen."""
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            "SELECT role::text, screen, can_view FROM role_permissions ORDER BY role, screen"
        ).fetchall()
    grid: dict[str, dict[str, bool]] = {role: {} for role in ROLES}
    for role, screen, can_view in rows:
        grid.setdefault(role, {})[screen] = can_view
    return {
        "screens": list(SCREENS),
        "roles": grid,
        "locked": {"SUPER_ADMIN": list(LOCKED_FOR_SUPER_ADMIN)},
    }


def set_permission(actor_id: uuid.UUID, role: str, screen: str, can_view: bool) -> dict:
    if role not in ROLES:
        raise HTTPException(status_code=422, detail="ROLE_UNKNOWN")
    if screen not in SCREENS:
        raise HTTPException(status_code=422, detail="SCREEN_UNKNOWN")
    # Clearing these two would make the permission editor unreachable, and the
    # only way back would be a database console.
    if role == "SUPER_ADMIN" and screen in LOCKED_FOR_SUPER_ADMIN and not can_view:
        raise HTTPException(status_code=409, detail="SCREEN_LOCKED_FOR_SUPER_ADMIN")

    with psycopg.connect(DATABASE_URL) as connection:
        before = connection.execute(
            "SELECT can_view FROM role_permissions WHERE role = %s::user_role AND screen = %s",
            (role, screen),
        ).fetchone()
        connection.execute(
            """
            INSERT INTO role_permissions (role, screen, can_view, updated_by)
            VALUES (%s::user_role, %s, %s, %s)
            ON CONFLICT (role, screen)
            DO UPDATE SET can_view = EXCLUDED.can_view, updated_at = now(), updated_by = EXCLUDED.updated_by
            """,
            (role, screen, can_view, actor_id),
        )
        _audit(
            connection, actor_id, "PERMISSION_CHANGED", "role_permission", actor_id,
            before={"role": role, "screen": screen, "can_view": before[0] if before else None},
            after={"role": role, "screen": screen, "can_view": can_view},
        )
        connection.commit()
    return {"role": role, "screen": screen, "can_view": can_view}


# -------------------------------------------------------------- row browsing

EDITABLE_TABLES: dict[str, dict] = {
    "users": {
        "label": "Tài khoản",
        "order": "created_at DESC",
        # A password hash never leaves the server, and never gets typed in by
        # hand: resetting a password has its own endpoint that hashes properly.
        "hidden": ("password_hash",),
        "readonly": ("id", "created_at"),
        "search": ("email",),
    },
    "member_profiles": {
        "label": "Hồ sơ", "order": "created_at DESC", "readonly": ("id", "created_at"),
        "search": ("full_name", "employee_code", "department", "position"),
    },
    "locations": {
        "label": "Địa điểm", "order": "created_at DESC", "readonly": ("id", "created_at"),
        "search": ("name", "address"),
    },
    "member_locations": {"label": "Gắn địa điểm", "order": "created_at DESC", "readonly": ("id", "created_at")},
    "manager_memberships": {"label": "Quan hệ quản lý", "order": "created_at DESC", "readonly": ("id", "created_at")},
    "attendance_events": {"label": "Bản ghi chấm công", "order": "server_time DESC", "readonly": ("id", "created_at")},
    "attendance_correction_requests": {
        "label": "Yêu cầu chỉnh công", "order": "created_at DESC", "readonly": ("id", "created_at"),
    },
    "notifications": {"label": "Thông báo", "order": "created_at DESC", "readonly": ("id", "created_at")},
    "face_embeddings": {
        "label": "Khuôn mặt đã đăng ký", "order": "created_at DESC",
        "hidden": ("embedding",), "readonly": ("id", "created_at"),
    },
    "login_attempts": {"label": "Lịch sử đăng nhập", "order": "created_at DESC", "readonly": ("id", "created_at")},
    "audit_logs": {"label": "Nhật ký hoạt động", "order": "created_at DESC", "readonly": ("id", "created_at")},
    "refresh_sessions": {"label": "Phiên đăng nhập", "order": "created_at DESC", "readonly": ("id", "created_at")},
}


def _spec(table: str) -> dict:
    spec = EDITABLE_TABLES.get(table)
    if spec is None:
        raise HTTPException(status_code=404, detail="TABLE_NOT_EDITABLE")
    return spec


def _columns(connection: psycopg.Connection, table: str) -> list[dict]:
    spec = _spec(table)
    rows = connection.execute(
        """
        SELECT column_name, data_type, is_nullable = 'YES', column_default IS NOT NULL
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position
        """,
        (table,),
    ).fetchall()
    hidden = set(spec.get("hidden", ()))
    readonly = set(spec.get("readonly", ()))
    return [
        {
            "name": row[0],
            "type": row[1],
            "nullable": row[2],
            "has_default": row[3],
            "readonly": row[0] in readonly,
        }
        for row in rows
        if row[0] not in hidden
    ]


def _readable(value):
    if isinstance(value, (uuid.UUID, datetime, date, time)):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, memoryview):
        return "<nhị phân>"
    return value


def list_tables() -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        tables = [
            {
                "name": name,
                "label": spec["label"],
                "rows": connection.execute(f"SELECT count(*) FROM {name}").fetchone()[0],
            }
            for name, spec in EDITABLE_TABLES.items()
        ]
    return {"tables": tables}


def browse_table(table: str, search: str | None, limit: int, offset: int) -> dict:
    spec = _spec(table)
    with psycopg.connect(DATABASE_URL) as connection:
        columns = _columns(connection, table)
        names = [column["name"] for column in columns]
        selected = ", ".join(f'"{name}"' for name in names)

        where, parameters = "TRUE", []
        if search and spec.get("search"):
            where = "(" + " OR ".join(f'"{column}"::text ILIKE %s' for column in spec["search"]) + ")"
            parameters = [f"%{search}%"] * len(spec["search"])

        total = connection.execute(f"SELECT count(*) FROM {table} WHERE {where}", parameters).fetchone()[0]
        rows = connection.execute(
            f'SELECT {selected} FROM {table} WHERE {where} ORDER BY {spec["order"]} LIMIT %s OFFSET %s',
            [*parameters, limit, offset],
        ).fetchall()
    return {
        "table": table,
        "label": spec["label"],
        "columns": columns,
        "total": total,
        "items": [{name: _readable(value) for name, value in zip(names, row)} for row in rows],
    }


def _row(connection: psycopg.Connection, table: str, row_id: str) -> dict:
    names = [column["name"] for column in _columns(connection, table)]
    selected = ", ".join(f'"{name}"' for name in names)
    found = connection.execute(f"SELECT {selected} FROM {table} WHERE id = %s", (row_id,)).fetchone()
    if found is None:
        raise HTTPException(status_code=404, detail="ROW_NOT_FOUND")
    return {name: _readable(value) for name, value in zip(names, found)}


def _writable(connection: psycopg.Connection, table: str, payload: dict) -> dict:
    allowed = {column["name"] for column in _columns(connection, table) if not column["readonly"]}
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise HTTPException(status_code=422, detail="COLUMN_NOT_WRITABLE:" + ",".join(unknown))
    if not payload:
        raise HTTPException(status_code=422, detail="NOTHING_TO_WRITE")
    return {name: (None if value == "" else value) for name, value in payload.items()}


def _refused(error: psycopg.Error) -> str:
    """Postgres already explains the refusal precisely — a foreign key, a check
    constraint, a bad enum value. Passing that through beats inventing a vaguer
    message of our own."""
    diagnostic = getattr(error, "diag", None)
    text = str((diagnostic and diagnostic.message_primary) or error).strip()
    return text.splitlines()[0][:300] or "DATABASE_REFUSED"


def update_row(actor_id: uuid.UUID, table: str, row_id: str, payload: dict) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        values = _writable(connection, table, payload)
        before = _row(connection, table, row_id)
        assignments = ", ".join(f'"{name}" = %s' for name in values)
        try:
            connection.execute(f"UPDATE {table} SET {assignments} WHERE id = %s", [*values.values(), row_id])
        except psycopg.Error as error:
            raise HTTPException(status_code=422, detail=_refused(error)) from error
        after = _row(connection, table, row_id)
        _audit(connection, actor_id, "ROW_UPDATED", table, actor_id, before=before, after=after)
        connection.commit()
    return after


def insert_row(actor_id: uuid.UUID, table: str, payload: dict) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        values = _writable(connection, table, payload)
        names = ", ".join(f'"{name}"' for name in values)
        markers = ", ".join(["%s"] * len(values))
        try:
            created = connection.execute(
                f"INSERT INTO {table} ({names}) VALUES ({markers}) RETURNING id", list(values.values())
            ).fetchone()
        except psycopg.Error as error:
            raise HTTPException(status_code=422, detail=_refused(error)) from error
        row = _row(connection, table, created[0])
        _audit(connection, actor_id, "ROW_INSERTED", table, actor_id, after=row)
        connection.commit()
    return row


def delete_row(actor_id: uuid.UUID, table: str, row_id: str) -> dict:
    if table == "users":
        # Removing an account has to cascade through a dozen tables. That logic
        # already exists in admin.delete_user; this shortcut would leave orphans.
        raise HTTPException(status_code=409, detail="USE_USER_DELETE_INSTEAD")
    with psycopg.connect(DATABASE_URL) as connection:
        before = _row(connection, table, row_id)
        try:
            connection.execute(f"DELETE FROM {table} WHERE id = %s", (row_id,))
        except psycopg.Error as error:
            raise HTTPException(status_code=409, detail=_refused(error)) from error
        _audit(connection, actor_id, "ROW_DELETED", table, actor_id, before=before)
        connection.commit()
    return {"table": table, "id": row_id, "deleted": True}
