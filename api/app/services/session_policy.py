"""
One device or many, decided per role by the system administrator.

Holding an account to a single device is an anti-sharing measure: with it on,
a member cannot hand their login to a colleague and have both check in. It is
also an inconvenience for anybody who legitimately uses a phone and a laptop,
which is why it is a switch and not a law of the system.

The switch lives in the database rather than in an environment variable so the
person running the organisation can change it without a deployment.
"""

from __future__ import annotations

import json
import uuid

import psycopg
from fastapi import HTTPException

from app.auth import DATABASE_URL

ROLES = ("MEMBER", "MANAGER", "SUPER_ADMIN")


def list_policies() -> list[dict]:
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            """
            SELECT p.role::text, p.allow_multiple_devices, p.updated_at, u.email,
                   (SELECT count(*) FROM refresh_sessions s
                    JOIN users su ON su.id = s.user_id
                    WHERE su.role = p.role AND s.revoked_at IS NULL)
            FROM session_policies p
            LEFT JOIN users u ON u.id = p.updated_by
            ORDER BY p.role
            """
        ).fetchall()
    return [
        {
            "role": row[0],
            "allow_multiple_devices": row[1],
            "updated_at": row[2],
            "updated_by_email": row[3],
            "active_sessions": row[4],
        }
        for row in rows
    ]


def set_policy(actor_id: uuid.UUID, role: str, allow_multiple_devices: bool) -> dict:
    role = role.upper()
    if role not in ROLES:
        raise HTTPException(status_code=422, detail="ROLE_UNKNOWN")

    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute(
            """
            INSERT INTO session_policies (role, allow_multiple_devices, updated_by)
            VALUES (%s, %s, %s)
            ON CONFLICT (role) DO UPDATE
            SET allow_multiple_devices = EXCLUDED.allow_multiple_devices,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()
            """,
            (role, allow_multiple_devices, actor_id),
        )

        closed = 0
        if allow_multiple_devices:
            # Existing sessions were marked as enforcing; leave them logged in
            # but stop them from being the odd one out under the new rule.
            connection.execute(
                """
                UPDATE refresh_sessions s SET enforce_single_session = false
                FROM users u
                WHERE u.id = s.user_id AND u.role = %s AND s.revoked_at IS NULL
                """,
                (role,),
            )
        else:
            # Turning the rule on has to mean something today, not at the next
            # login: everybody in this role keeps their newest session and
            # loses the rest.
            extra = connection.execute(
                """
                SELECT s.id FROM refresh_sessions s
                JOIN users u ON u.id = s.user_id
                WHERE u.role = %s AND s.revoked_at IS NULL
                  AND s.id NOT IN (
                      SELECT DISTINCT ON (s2.user_id) s2.id
                      FROM refresh_sessions s2
                      JOIN users u2 ON u2.id = s2.user_id
                      WHERE u2.role = %s AND s2.revoked_at IS NULL
                      ORDER BY s2.user_id, s2.created_at DESC
                  )
                """,
                (role, role),
            ).fetchall()
            if extra:
                connection.execute(
                    "UPDATE refresh_sessions SET revoked_at = now(),"
                    " revoked_reason = 'DEVICE_POLICY_CHANGED' WHERE id = ANY(%s)",
                    ([row[0] for row in extra],),
                )
                closed = len(extra)
            connection.execute(
                """
                UPDATE refresh_sessions s SET enforce_single_session = true
                FROM users u
                WHERE u.id = s.user_id AND u.role = %s AND s.revoked_at IS NULL
                """,
                (role,),
            )

        connection.execute(
            """
            INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_json)
            VALUES (%s, 'SESSION_POLICY_CHANGED', 'session_policy', %s, %s::jsonb)
            """,
            (
                actor_id,
                # The thing changed is a role, which has no row id; the column
                # is NOT NULL, and every other settings-style entry here points
                # back at whoever made the change.
                actor_id,
                json.dumps(
                    {
                        "role": role,
                        "allow_multiple_devices": allow_multiple_devices,
                        "sessions_closed": closed,
                    }
                ),
            ),
        )
        connection.commit()

    return {"role": role, "allow_multiple_devices": allow_multiple_devices, "sessions_closed": closed}
