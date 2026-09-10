"""System administration for the SUPER_ADMIN role.

A super admin sees across every manager, which is exactly why every write here
is written to audit_logs with the actor: the role has no scope boundary to stop
a mistake, so the record of what happened is the safety net.
"""

from __future__ import annotations

import json
import uuid

import psycopg
from fastapi import HTTPException

from app.auth import DATABASE_URL, password_context, revoke_user_sessions, validate_password


ASSIGNABLE_ROLES = {"MEMBER", "MANAGER", "SUPER_ADMIN"}
ASSIGNABLE_STATUSES = {"ACTIVE", "SUSPENDED", "INVITED"}


def _audit(
    connection: psycopg.Connection,
    actor_id: uuid.UUID,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID,
    before: dict | None = None,
    after: dict | None = None,
    reason: str | None = None,
) -> None:
    connection.execute(
        """
        INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json, after_json, reason)
        VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)
        """,
        (
            actor_id,
            action,
            entity_type,
            entity_id,
            json.dumps(before, default=str) if before is not None else None,
            json.dumps(after, default=str) if after is not None else None,
            reason,
        ),
    )


# ------------------------------------------------------------------ overview

def overview() -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        counts = connection.execute(
            """
            SELECT
                (SELECT count(*) FROM users WHERE role = 'MEMBER') AS members,
                (SELECT count(*) FROM users WHERE role = 'MANAGER') AS managers,
                (SELECT count(*) FROM users WHERE role = 'SUPER_ADMIN') AS admins,
                (SELECT count(*) FROM users WHERE status <> 'ACTIVE') AS inactive,
                (SELECT count(*) FROM locations) AS locations,
                (SELECT count(*) FROM attendance_events WHERE deleted_at IS NULL) AS events,
                (SELECT count(*) FROM attendance_events WHERE deleted_at IS NOT NULL) AS deleted_events,
                (SELECT count(*) FROM face_embeddings WHERE revoked_at IS NULL) AS faces,
                (SELECT count(*) FROM refresh_sessions WHERE revoked_at IS NULL) AS sessions
            """
        ).fetchone()
    return {
        "members": counts[0],
        "managers": counts[1],
        "super_admins": counts[2],
        "inactive_users": counts[3],
        "locations": counts[4],
        "attendance_events": counts[5],
        "deleted_events": counts[6],
        "enrolled_faces": counts[7],
        "active_sessions": counts[8],
    }


# --------------------------------------------------------------------- users

def list_users(search: str | None, role: str | None, limit: int, offset: int) -> dict:
    clauses = ["1 = 1"]
    parameters: list = []
    if search:
        clauses.append("(u.email ILIKE %s OR mp.full_name ILIKE %s)")
        parameters += [f"%{search}%", f"%{search}%"]
    if role:
        clauses.append("u.role = %s::user_role")
        parameters.append(role)
    where = " AND ".join(clauses)

    with psycopg.connect(DATABASE_URL) as connection:
        total = connection.execute(
            f"SELECT count(*) FROM users u LEFT JOIN member_profiles mp ON mp.user_id = u.id WHERE {where}",
            parameters,
        ).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT u.id, u.email, u.role::text, u.status::text, u.created_at, u.last_login_at,
                   mp.full_name, mp.employee_code,
                   (SELECT count(*) FROM attendance_events e WHERE e.member_id = u.id AND e.deleted_at IS NULL),
                   (SELECT count(*) FROM manager_memberships mm
                     WHERE mm.manager_user_id = u.id AND mm.status = 'ACTIVE')
            FROM users u LEFT JOIN member_profiles mp ON mp.user_id = u.id
            WHERE {where}
            ORDER BY u.created_at DESC LIMIT %s OFFSET %s
            """,
            [*parameters, limit, offset],
        ).fetchall()
    return {
        "total": total,
        "items": [
            {
                "id": row[0],
                "email": row[1],
                "role": row[2],
                "status": row[3],
                "created_at": row[4],
                "last_login_at": row[5],
                "full_name": row[6],
                "employee_code": row[7],
                "attendance_count": row[8],
                "managed_members": row[9],
            }
            for row in rows
        ],
    }


def update_user(actor_id: uuid.UUID, user_id: uuid.UUID, payload: dict) -> dict:
    role = payload.get("role")
    status = payload.get("status")
    if role is not None and role not in ASSIGNABLE_ROLES:
        raise HTTPException(status_code=422, detail="INVALID_ROLE")
    if status is not None and status not in ASSIGNABLE_STATUSES:
        raise HTTPException(status_code=422, detail="INVALID_STATUS")

    with psycopg.connect(DATABASE_URL) as connection:
        current = connection.execute(
            "SELECT role::text, status::text FROM users WHERE id = %s", (user_id,)
        ).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail="USER_NOT_FOUND")

        # Locking yourself out of the only admin account is unrecoverable
        # without database access, so it is refused.
        if actor_id == user_id and (role not in (None, "SUPER_ADMIN") or status not in (None, "ACTIVE")):
            raise HTTPException(status_code=409, detail="CANNOT_DEMOTE_SELF")
        if current[0] == "SUPER_ADMIN" and role not in (None, "SUPER_ADMIN"):
            remaining = connection.execute(
                "SELECT count(*) FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' AND id <> %s",
                (user_id,),
            ).fetchone()[0]
            if remaining == 0:
                raise HTTPException(status_code=409, detail="LAST_SUPER_ADMIN")

        connection.execute(
            "UPDATE users SET role = COALESCE(%s::user_role, role), "
            "status = COALESCE(%s::user_status, status), updated_at = now() WHERE id = %s",
            (role, status, user_id),
        )
        if status is not None and status != "ACTIVE":
            revoke_user_sessions(connection, user_id, "ADMIN_SUSPENDED")
        if role is not None and role != current[0]:
            # The role is baked into issued tokens; force a fresh login.
            revoke_user_sessions(connection, user_id, "ROLE_CHANGED")

        _audit(
            connection, actor_id, "ADMIN_USER_UPDATED", "user", user_id,
            {"role": current[0], "status": current[1]},
            {"role": role or current[0], "status": status or current[1]},
        )
        connection.commit()
    return {"id": user_id, "role": role or current[0], "status": status or current[1]}


def reset_user_password(actor_id: uuid.UUID, user_id: uuid.UUID, new_password: str) -> dict:
    validate_password(new_password)
    with psycopg.connect(DATABASE_URL) as connection:
        found = connection.execute("SELECT email FROM users WHERE id = %s", (user_id,)).fetchone()
        if found is None:
            raise HTTPException(status_code=404, detail="USER_NOT_FOUND")
        connection.execute(
            "UPDATE users SET password_hash = %s, updated_at = now() WHERE id = %s",
            (password_context.hash(new_password), user_id),
        )
        revoke_user_sessions(connection, user_id, "ADMIN_PASSWORD_RESET")
        # The password itself is never written to the audit trail.
        _audit(connection, actor_id, "ADMIN_PASSWORD_RESET", "user", user_id, None, {"email": found[0]})
        connection.commit()
    return {"id": user_id, "password_reset": True}


DEPENDENT_TABLES = (
    ("login_attempts", "user_id"),
    ("notifications", "user_id"),
    ("attendance_correction_requests", "member_id"),
    ("attendance_correction_requests", "reviewed_by"),
    ("attendance_summary", "member_id"),
    ("attendance_events", "member_id"),
    ("attendance_events", "deleted_by"),
    ("schedules", "member_id"),
    ("member_locations", "member_id"),
    ("face_enrollment_challenges", "member_id"),
    ("face_embeddings", "member_id"),
    ("audit_logs", "actor_user_id"),
    ("manager_memberships", "manager_user_id"),
    ("manager_memberships", "member_user_id"),
    ("locations", "manager_user_id"),
    ("member_profiles", "user_id"),
    ("password_reset_tokens", "user_id"),
    ("refresh_sessions", "user_id"),
)


def delete_user(actor_id: uuid.UUID, user_id: uuid.UUID, reason: str) -> dict:
    """Erase an account and everything attached to it, including its biometrics."""
    if actor_id == user_id:
        raise HTTPException(status_code=409, detail="CANNOT_DELETE_SELF")
    with psycopg.connect(DATABASE_URL) as connection:
        found = connection.execute(
            "SELECT email, role::text FROM users WHERE id = %s", (user_id,)
        ).fetchone()
        if found is None:
            raise HTTPException(status_code=404, detail="USER_NOT_FOUND")
        if found[1] == "SUPER_ADMIN":
            remaining = connection.execute(
                "SELECT count(*) FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' AND id <> %s",
                (user_id,),
            ).fetchone()[0]
            if remaining == 0:
                raise HTTPException(status_code=409, detail="LAST_SUPER_ADMIN")

        # Written before the rows disappear, so the trail outlives the account.
        _audit(
            connection, actor_id, "ADMIN_USER_DELETED", "user", user_id,
            {"email": found[0], "role": found[1]}, None, reason,
        )
        # Rows other people own that point at this account's locations. Deleting
        # the locations without clearing these fails on the foreign key, so a
        # manager who ever assigned a place to somebody could not be removed.
        connection.execute(
            "DELETE FROM member_locations WHERE location_id IN"
            " (SELECT id FROM locations WHERE manager_user_id = %s)",
            (user_id,),
        )
        connection.execute(
            "UPDATE attendance_events SET deleted_at = COALESCE(deleted_at, now())"
            " WHERE location_id IN (SELECT id FROM locations WHERE manager_user_id = %s)"
            "   AND member_id <> %s",
            (user_id, user_id),
        )
        connection.execute(
            "DELETE FROM attendance_events WHERE location_id IN"
            " (SELECT id FROM locations WHERE manager_user_id = %s)",
            (user_id,),
        )

        for table, column in DEPENDENT_TABLES:
            if (table, column) == ("audit_logs", "actor_user_id"):
                # Keep what this account did; only detach the foreign key.
                continue
            connection.execute(f"DELETE FROM {table} WHERE {column} = %s", (user_id,))
        connection.execute(
            "UPDATE audit_logs SET actor_user_id = %s WHERE actor_user_id = %s", (actor_id, user_id)
        )
        # Permissions belong to the role, not to whoever last ticked the box.
        # Deleting that person must not quietly reset what a role may open.
        connection.execute(
            "UPDATE role_permissions SET updated_by = NULL WHERE updated_by = %s", (user_id,)
        )
        connection.execute("DELETE FROM users WHERE id = %s", (user_id,))
        connection.commit()
    return {"id": user_id, "deleted": True}


# -------------------------------------------------------- attendance records

def list_all_attendance(filters: dict) -> dict:
    clauses = ["1 = 1"]
    parameters: list = []
    if not filters.get("include_deleted"):
        clauses.append("e.deleted_at IS NULL")
    if filters.get("member_id"):
        clauses.append("e.member_id = %s")
        parameters.append(filters["member_id"])
    if filters.get("date_from"):
        clauses.append("e.server_time >= %s")
        parameters.append(filters["date_from"])
    if filters.get("date_to"):
        clauses.append("e.server_time < (%s::date + 1)")
        parameters.append(filters["date_to"])
    where = " AND ".join(clauses)

    with psycopg.connect(DATABASE_URL) as connection:
        total = connection.execute(
            f"SELECT count(*) FROM attendance_events e WHERE {where}", parameters
        ).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT e.id, u.email, mp.full_name, e.event_type::text, e.status::text, e.server_time,
                   l.name, e.distance_meters, e.failure_code, e.deleted_at, e.delete_reason,
                   du.email
            FROM attendance_events e
            JOIN users u ON u.id = e.member_id
            LEFT JOIN member_profiles mp ON mp.user_id = e.member_id
            JOIN locations l ON l.id = e.location_id
            LEFT JOIN users du ON du.id = e.deleted_by
            WHERE {where}
            ORDER BY e.server_time DESC LIMIT %s OFFSET %s
            """,
            [*parameters, filters.get("limit", 50), filters.get("offset", 0)],
        ).fetchall()
    return {
        "total": total,
        "items": [
            {
                "id": row[0],
                "member_email": row[1],
                "member_name": row[2],
                "event_type": row[3],
                "status": row[4],
                "server_time": row[5],
                "location_name": row[6],
                "distance_meters": float(row[7]) if row[7] is not None else None,
                "failure_code": row[8],
                "deleted_at": row[9],
                "delete_reason": row[10],
                "deleted_by_email": row[11],
            }
            for row in rows
        ],
    }


def purge_attendance(actor_id: uuid.UUID, event_id: uuid.UUID, reason: str) -> dict:
    """Erase a record for good. Only a super admin can do this."""
    with psycopg.connect(DATABASE_URL) as connection:
        found = connection.execute(
            "SELECT member_id, event_type::text, server_time FROM attendance_events WHERE id = %s",
            (event_id,),
        ).fetchone()
        if found is None:
            raise HTTPException(status_code=404, detail="ATTENDANCE_NOT_FOUND")
        _audit(
            connection, actor_id, "ADMIN_ATTENDANCE_PURGED", "attendance_event", event_id,
            {"member_id": str(found[0]), "event_type": found[1], "server_time": found[2].isoformat()},
            None, reason,
        )
        connection.execute("DELETE FROM attendance_events WHERE id = %s", (event_id,))
        connection.commit()
    return {"id": event_id, "purged": True}


def restore_attendance(actor_id: uuid.UUID, event_id: uuid.UUID) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            "UPDATE attendance_events SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL "
            "WHERE id = %s AND deleted_at IS NOT NULL RETURNING id",
            (event_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="ATTENDANCE_NOT_DELETED")
        _audit(connection, actor_id, "ADMIN_ATTENDANCE_RESTORED", "attendance_event", event_id)
        connection.commit()
    return {"id": event_id, "restored": True}
