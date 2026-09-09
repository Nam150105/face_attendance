"""
Units, the codes people type to join them, and the manager's decision.

Adding people by email meant the manager had to already know every address and
type each one. A code on a whiteboard reverses that: the person signing up says
where they belong, and the manager only has to say yes or no.

Nobody joins by typing a code alone. A pending row is a request, not a
membership, and a request grants nothing until somebody approves it.
"""

from __future__ import annotations

import json
import secrets
import uuid

import psycopg
from fastapi import HTTPException

from app.auth import CurrentUser, DATABASE_URL
from app.services.member_portal import notify
from app.services.permissions import managed_by, owner_filter


# Read aloud, written down, typed on a phone: no O/0, no I/1, no letters that
# look like each other in the fonts people actually use.
CODE_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY2346789"
CODE_LENGTH = 6

TEAM_COLUMNS = "t.id, t.manager_user_id, t.code, t.name, t.is_open, t.created_at"


def _team(row: tuple, pending: int = 0, members: int = 0) -> dict:
    return {
        "id": row[0],
        "manager_user_id": row[1],
        "code": row[2],
        "name": row[3],
        "is_open": row[4],
        "created_at": row[5],
        "pending": pending,
        "members": members,
    }


def _new_code(connection: psycopg.Connection) -> str:
    for _ in range(20):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        taken = connection.execute(
            "SELECT 1 FROM teams WHERE upper(code) = upper(%s)", (code,)
        ).fetchone()
        if taken is None:
            return code
    raise HTTPException(status_code=503, detail="CODE_GENERATION_FAILED")


# ------------------------------------------------------------------- manager

def list_teams(user: CurrentUser) -> list[dict]:
    where, parameters = owner_filter(managed_by(user), "t.manager_user_id")
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            f"""
            SELECT {TEAM_COLUMNS},
                   count(*) FILTER (WHERE mm.status = 'PENDING') AS pending,
                   count(*) FILTER (WHERE mm.status = 'ACTIVE') AS members
            FROM teams t
            LEFT JOIN manager_memberships mm ON mm.team_id = t.id
            WHERE {where}
            GROUP BY t.id
            ORDER BY t.created_at
            """,
            parameters,
        ).fetchall()
    return [_team(row[:6], row[6], row[7]) for row in rows]


def create_team(user: CurrentUser, name: str, code: str | None) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        wanted = (code or "").strip().upper()
        if wanted:
            if not 3 <= len(wanted) <= 24:
                raise HTTPException(status_code=422, detail="TEAM_CODE_LENGTH")
            taken = connection.execute(
                "SELECT 1 FROM teams WHERE upper(code) = %s", (wanted,)
            ).fetchone()
            if taken is not None:
                raise HTTPException(status_code=409, detail="TEAM_CODE_TAKEN")
        else:
            wanted = _new_code(connection)

        row = connection.execute(
            f"INSERT INTO teams (manager_user_id, code, name) VALUES (%s, %s, %s) RETURNING {TEAM_COLUMNS}".replace("t.", ""),
            (user.id, wanted, name.strip()),
        ).fetchone()
        connection.execute(
            "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_json)"
            " VALUES (%s, 'TEAM_CREATED', 'team', %s, %s::jsonb)",
            (user.id, row[0], json.dumps({"code": wanted, "name": name})),
        )
        connection.commit()
    return _team(row)


def update_team(user: CurrentUser, team_id: uuid.UUID, name: str | None, is_open: bool | None) -> dict:
    where, parameters = owner_filter(managed_by(user), "manager_user_id")
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            f"""
            UPDATE teams SET
                name = COALESCE(%s, name),
                is_open = COALESCE(%s, is_open),
                updated_at = now()
            WHERE {where} AND id = %s
            RETURNING {TEAM_COLUMNS}
            """.replace("t.", ""),
            [name, is_open, *parameters, team_id],
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="TEAM_NOT_FOUND")
        connection.commit()
    return _team(row)


def delete_team(user: CurrentUser, team_id: uuid.UUID) -> dict:
    where, parameters = owner_filter(managed_by(user), "manager_user_id")
    with psycopg.connect(DATABASE_URL) as connection:
        joined = connection.execute(
            "SELECT count(*) FROM manager_memberships WHERE team_id = %s AND status = 'ACTIVE'",
            (team_id,),
        ).fetchone()[0]
        if joined:
            # Deleting the unit would not remove the people; it would only erase
            # the record of how they got here.
            raise HTTPException(status_code=409, detail="TEAM_HAS_MEMBERS")
        removed = connection.execute(
            f"DELETE FROM teams WHERE {where} AND id = %s RETURNING code", [*parameters, team_id]
        ).fetchone()
        if removed is None:
            raise HTTPException(status_code=404, detail="TEAM_NOT_FOUND")
        connection.execute(
            "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json)"
            " VALUES (%s, 'TEAM_DELETED', 'team', %s, %s::jsonb)",
            (user.id, team_id, json.dumps({"code": removed[0]})),
        )
        connection.commit()
    return {"id": team_id, "deleted": True}


# -------------------------------------------------------------------- member

def preview_team(code: str) -> dict:
    """
    What a code stands for, before anybody commits to it.

    Only the unit's name and whether it is open — enough to confirm you typed
    the right thing, and not enough to enumerate an organisation by guessing
    codes: a wrong code looks exactly like a closed one.
    """
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            """
            SELECT t.name, t.is_open, COALESCE(mp.full_name, u.email)
            FROM teams t
            JOIN users u ON u.id = t.manager_user_id
            LEFT JOIN member_profiles mp ON mp.user_id = u.id
            WHERE upper(t.code) = upper(%s) AND u.status = 'ACTIVE'
            """,
            (code.strip(),),
        ).fetchone()
    if row is None or not row[1]:
        raise HTTPException(status_code=404, detail="TEAM_CODE_UNKNOWN")
    return {"name": row[0], "manager_name": row[2]}


def request_join(member_id: uuid.UUID, code: str) -> dict:
    """A member asks to join. Nothing is granted until a manager agrees."""
    with psycopg.connect(DATABASE_URL) as connection:
        team = connection.execute(
            """
            SELECT t.id, t.manager_user_id, t.name, t.is_open
            FROM teams t JOIN users u ON u.id = t.manager_user_id
            WHERE upper(t.code) = upper(%s) AND u.status = 'ACTIVE'
            """,
            (code.strip(),),
        ).fetchone()
        if team is None or not team[3]:
            raise HTTPException(status_code=404, detail="TEAM_CODE_UNKNOWN")
        if team[1] == member_id:
            raise HTTPException(status_code=409, detail="CANNOT_JOIN_OWN_TEAM")

        existing = connection.execute(
            "SELECT id, status::text FROM manager_memberships"
            " WHERE manager_user_id = %s AND member_user_id = %s",
            (team[1], member_id),
        ).fetchone()
        if existing and existing[1] == "ACTIVE":
            raise HTTPException(status_code=409, detail="ALREADY_IN_TEAM")
        if existing and existing[1] == "PENDING":
            raise HTTPException(status_code=409, detail="JOIN_ALREADY_PENDING")

        # One manager at a time. Somebody moving between units is released by
        # the manager they are leaving, so nobody loses a person behind their back.
        elsewhere = connection.execute(
            "SELECT 1 FROM manager_memberships"
            " WHERE member_user_id = %s AND status = 'ACTIVE' AND manager_user_id <> %s",
            (member_id, team[1]),
        ).fetchone()
        if elsewhere is not None:
            raise HTTPException(status_code=409, detail="ALREADY_HAS_MANAGER")

        if existing:
            connection.execute(
                "UPDATE manager_memberships SET status = 'PENDING', team_id = %s, decided_at = NULL,"
                " decision_note = NULL, updated_at = now() WHERE id = %s",
                (team[0], existing[0]),
            )
        else:
            connection.execute(
                "INSERT INTO manager_memberships (manager_user_id, member_user_id, status, team_id)"
                " VALUES (%s, %s, 'PENDING', %s)",
                (team[1], member_id, team[0]),
            )

        who = connection.execute(
            "SELECT COALESCE(mp.full_name, u.email) FROM users u"
            " LEFT JOIN member_profiles mp ON mp.user_id = u.id WHERE u.id = %s",
            (member_id,),
        ).fetchone()[0]
        notify(
            connection, team[1], "JOIN_REQUESTED",
            "Có người xin vào nhóm",
            f"{who} xin vào {team[2]}. Bạn duyệt hoặc từ chối trong mục Yêu cầu vào nhóm.",
            {"member_id": str(member_id)},
        )
        connection.commit()
    return {"team": team[2], "status": "PENDING"}


def my_join_requests(member_id: uuid.UUID) -> list[dict]:
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            """
            SELECT mm.status::text, t.name, t.code, mm.decision_note, mm.decided_at,
                   COALESCE(mp.full_name, u.email)
            FROM manager_memberships mm
            LEFT JOIN teams t ON t.id = mm.team_id
            JOIN users u ON u.id = mm.manager_user_id
            LEFT JOIN member_profiles mp ON mp.user_id = u.id
            WHERE mm.member_user_id = %s AND mm.status IN ('PENDING', 'REJECTED')
            ORDER BY mm.updated_at DESC
            """,
            (member_id,),
        ).fetchall()
    return [
        {
            "status": row[0],
            "team_name": row[1],
            "team_code": row[2],
            "note": row[3],
            "decided_at": row[4],
            "manager_name": row[5],
        }
        for row in rows
    ]


# ------------------------------------------------------------------ decision

def list_join_requests(user: CurrentUser) -> list[dict]:
    where, parameters = owner_filter(managed_by(user), "mm.manager_user_id")
    with psycopg.connect(DATABASE_URL) as connection:
        rows = connection.execute(
            f"""
            SELECT mm.member_user_id, u.email, u.role::text, mp.full_name, mp.phone,
                   mp.position, mp.department, t.name, t.code, mm.updated_at
            FROM manager_memberships mm
            JOIN users u ON u.id = mm.member_user_id
            LEFT JOIN member_profiles mp ON mp.user_id = u.id
            LEFT JOIN teams t ON t.id = mm.team_id
            WHERE {where} AND mm.status = 'PENDING'
            ORDER BY mm.updated_at
            """,
            parameters,
        ).fetchall()
    return [
        {
            "member_id": row[0],
            "email": row[1],
            "role": row[2],
            "full_name": row[3],
            "phone": row[4],
            "position": row[5],
            "department": row[6],
            "team_name": row[7],
            "team_code": row[8],
            "requested_at": row[9],
        }
        for row in rows
    ]


def decide_join_request(user: CurrentUser, member_id: uuid.UUID, approve: bool, note: str | None) -> dict:
    where, parameters = owner_filter(managed_by(user), "manager_user_id")
    status = "ACTIVE" if approve else "REJECTED"
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            f"""
            UPDATE manager_memberships
            SET status = %s::membership_status, decided_at = now(), decision_note = %s, updated_at = now()
            WHERE {where} AND member_user_id = %s AND status = 'PENDING'
            RETURNING id, manager_user_id
            """,
            [status, note, *parameters, member_id],
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="JOIN_REQUEST_NOT_FOUND")

        if approve:
            taken = connection.execute(
                "SELECT 1 FROM manager_memberships"
                " WHERE member_user_id = %s AND status = 'ACTIVE' AND manager_user_id <> %s",
                (member_id, row[1]),
            ).fetchone()
            if taken is not None:
                raise HTTPException(status_code=409, detail="ALREADY_HAS_MANAGER")

        if approve:
            # The unit is what the manager approved, not what the person typed
            # about themselves. Writing it here keeps every roster, filter and
            # export showing the same answer.
            # Upsert, not update: somebody who signed up without filling in a
            # profile has no row yet, and an UPDATE would silently write nothing.
            connection.execute(
                """
                INSERT INTO member_profiles (user_id, full_name, department)
                SELECT %s, COALESCE(u.email, ''), t.name
                FROM manager_memberships mm
                JOIN teams t ON t.id = mm.team_id
                JOIN users u ON u.id = mm.member_user_id
                WHERE mm.id = %s
                ON CONFLICT (user_id) DO UPDATE
                SET department = EXCLUDED.department, updated_at = now()
                """,
                (member_id, row[0]),
            )

        connection.execute(
            "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_json, reason)"
            " VALUES (%s, %s, 'manager_membership', %s, %s::jsonb, %s)",
            (user.id, "JOIN_APPROVED" if approve else "JOIN_REJECTED", member_id,
             json.dumps({"status": status}), note),
        )
        notify(
            connection, member_id,
            "JOIN_APPROVED" if approve else "JOIN_REJECTED",
            "Bạn đã được duyệt vào nhóm" if approve else "Yêu cầu vào nhóm chưa được duyệt",
            "Từ giờ bạn chấm công được ở những địa điểm người quản lý gán cho bạn."
            if approve else (note or "Bạn liên hệ người quản lý để biết thêm."),
            {},
        )
        connection.commit()
    return {"member_id": member_id, "status": status}


# ------------------------------------------------------------ unit locations

def _assert_owns_team(connection: psycopg.Connection, user: CurrentUser, team_id: uuid.UUID) -> None:
    """An empty list would be ambiguous: it reads the same as "this unit has
    nothing in it", which is not what happened."""
    where, parameters = owner_filter(managed_by(user), "manager_user_id")
    found = connection.execute(
        f"SELECT 1 FROM teams WHERE {where} AND id = %s", [*parameters, team_id]
    ).fetchone()
    if found is None:
        raise HTTPException(status_code=404, detail="TEAM_NOT_FOUND")


def list_team_locations(user: CurrentUser, team_id: uuid.UUID) -> list[dict]:
    where, parameters = owner_filter(managed_by(user), "t.manager_user_id")
    with psycopg.connect(DATABASE_URL) as connection:
        _assert_owns_team(connection, user, team_id)
        rows = connection.execute(
            f"""
            SELECT l.id, l.name, l.address, l.is_active, tl.is_default
            FROM team_locations tl
            JOIN teams t ON t.id = tl.team_id
            JOIN locations l ON l.id = tl.location_id
            WHERE {where} AND tl.team_id = %s
            ORDER BY tl.is_default DESC, l.name
            """,
            [*parameters, team_id],
        ).fetchall()
    return [
        {"id": row[0], "name": row[1], "address": row[2], "is_active": row[3], "is_default": row[4]}
        for row in rows
    ]


def attach_location(user: CurrentUser, team_id: uuid.UUID, location_id: uuid.UUID,
                    is_default: bool) -> dict:
    """
    Attach a place to a unit. Everyone in the unit can check in there from this
    moment, including people approved later — that is the point of attaching it
    to the unit rather than to each person.
    """
    owner = managed_by(user)
    team_where, team_params = owner_filter(owner, "manager_user_id")
    location_where, location_params = owner_filter(owner, "manager_user_id")
    with psycopg.connect(DATABASE_URL) as connection:
        team = connection.execute(
            f"SELECT id, name FROM teams WHERE {team_where} AND id = %s", [*team_params, team_id]
        ).fetchone()
        if team is None:
            raise HTTPException(status_code=404, detail="TEAM_NOT_FOUND")
        location = connection.execute(
            f"SELECT id, name FROM locations WHERE {location_where} AND id = %s AND is_active",
            [*location_params, location_id],
        ).fetchone()
        if location is None:
            raise HTTPException(status_code=404, detail="LOCATION_NOT_FOUND")

        if is_default:
            connection.execute(
                "UPDATE team_locations SET is_default = false WHERE team_id = %s", (team_id,)
            )
        connection.execute(
            "INSERT INTO team_locations (team_id, location_id, is_default) VALUES (%s, %s, %s)"
            " ON CONFLICT (team_id, location_id) DO UPDATE SET is_default = EXCLUDED.is_default",
            (team_id, location_id, is_default),
        )
        connection.execute(
            "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_json)"
            " VALUES (%s, 'TEAM_LOCATION_ADDED', 'team', %s, %s::jsonb)",
            (user.id, team_id, json.dumps({"location": location[1], "team": team[1]})),
        )
        connection.commit()
    return {"team_id": team_id, "location_id": location_id, "is_default": is_default}


def detach_location(user: CurrentUser, team_id: uuid.UUID, location_id: uuid.UUID) -> dict:
    where, parameters = owner_filter(managed_by(user), "t.manager_user_id")
    with psycopg.connect(DATABASE_URL) as connection:
        removed = connection.execute(
            f"""
            DELETE FROM team_locations tl USING teams t
            WHERE t.id = tl.team_id AND {where} AND tl.team_id = %s AND tl.location_id = %s
            RETURNING tl.location_id
            """,
            [*parameters, team_id, location_id],
        ).fetchone()
        if removed is None:
            raise HTTPException(status_code=404, detail="TEAM_LOCATION_NOT_FOUND")
        connection.execute(
            "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json)"
            " VALUES (%s, 'TEAM_LOCATION_REMOVED', 'team', %s, %s::jsonb)",
            (user.id, team_id, json.dumps({"location_id": str(location_id)})),
        )
        connection.commit()
    return {"team_id": team_id, "location_id": location_id, "removed": True}


def team_members(user: CurrentUser, team_id: uuid.UUID) -> list[dict]:
    where, parameters = owner_filter(managed_by(user), "t.manager_user_id")
    with psycopg.connect(DATABASE_URL) as connection:
        _assert_owns_team(connection, user, team_id)
        rows = connection.execute(
            f"""
            SELECT u.id, u.email, u.role::text, mp.full_name, mp.phone, mp.position,
                   mp.employee_code, mm.status::text
            FROM manager_memberships mm
            JOIN teams t ON t.id = mm.team_id
            JOIN users u ON u.id = mm.member_user_id
            LEFT JOIN member_profiles mp ON mp.user_id = u.id
            WHERE {where} AND mm.team_id = %s AND mm.status = 'ACTIVE'
            ORDER BY mp.full_name NULLS LAST, u.email
            """,
            [*parameters, team_id],
        ).fetchall()
    return [
        {
            "user_id": row[0], "email": row[1], "role": row[2], "full_name": row[3],
            "phone": row[4], "position": row[5], "employee_code": row[6],
            "membership_status": row[7],
        }
        for row in rows
    ]
