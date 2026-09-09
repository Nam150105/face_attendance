"""
Replacing a face that is already on file.

The registered face is what every check-in is measured against. If the same
account can quietly swap it, the check proves nothing — change the reference and
anybody's face passes. So a replacement waits here, with the old photo and the
new one side by side, until somebody who is not the applicant compares them.

The first registration is different: there is nothing to compare against and
nothing to overwrite, so it applies at once. Entry to the organisation was
already gated when a manager approved the person into a team.
"""

from __future__ import annotations

import json
import uuid

import psycopg
from fastapi import HTTPException

from app.auth import CurrentUser, DATABASE_URL
from app.services.member_portal import notify
from app.services.permissions import assert_can_see_member, visible_member_ids
from app.services.storage import PrivateObjectStorage


def has_registered_face(connection: psycopg.Connection, member_id: uuid.UUID) -> bool:
    return connection.execute(
        "SELECT 1 FROM face_embeddings WHERE member_id = %s AND revoked_at IS NULL LIMIT 1",
        (member_id,),
    ).fetchone() is not None


def open_request(connection: psycopg.Connection, member_id: uuid.UUID) -> dict | None:
    row = connection.execute(
        "SELECT id, reason, created_at FROM face_change_requests"
        " WHERE member_id = %s AND status = 'PENDING'",
        (member_id,),
    ).fetchone()
    return {"id": row[0], "reason": row[1], "created_at": row[2]} if row else None


def submit(
    connection: psycopg.Connection,
    member_id: uuid.UUID,
    embedding: list[float],
    model_name: str,
    model_version: str,
    quality: float | None,
    object_key: str | None,
    reason: str,
) -> dict:
    """File the replacement and tell the managers there is something to look at."""
    if open_request(connection, member_id) is not None:
        raise HTTPException(status_code=409, detail="FACE_CHANGE_ALREADY_PENDING")

    request_id = connection.execute(
        """
        INSERT INTO face_change_requests
            (member_id, embedding, model_name, model_version, quality_score, image_object_key, reason)
        VALUES (%s, %s::vector, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (member_id, json.dumps(embedding), model_name, model_version, quality, object_key, reason),
    ).fetchone()[0]

    who = connection.execute(
        "SELECT COALESCE(mp.full_name, u.email) FROM users u"
        " LEFT JOIN member_profiles mp ON mp.user_id = u.id WHERE u.id = %s",
        (member_id,),
    ).fetchone()[0]
    managers = connection.execute(
        "SELECT manager_user_id FROM manager_memberships"
        " WHERE member_user_id = %s AND status = 'ACTIVE'",
        (member_id,),
    ).fetchall()
    for manager in managers:
        notify(
            connection, manager[0], "FACE_CHANGE_REQUESTED",
            "Có người xin đổi khuôn mặt",
            f"{who} xin đổi ảnh khuôn mặt. Bạn so ảnh cũ với ảnh mới rồi duyệt hoặc từ chối.",
            {"member_id": str(member_id), "request_id": str(request_id)},
        )

    connection.execute(
        "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_json, reason)"
        " VALUES (%s, 'FACE_CHANGE_REQUESTED', 'face_change_request', %s, %s::jsonb, %s)",
        (member_id, request_id, json.dumps({"model_name": model_name}), reason),
    )
    return {
        "status": "PENDING_APPROVAL",
        "request_id": request_id,
        "reviewers": len(managers),
    }


def list_requests(user: CurrentUser) -> list[dict]:
    with psycopg.connect(DATABASE_URL) as connection:
        visible = visible_member_ids(connection, user)
        where, parameters = ("TRUE", []) if visible is None else ("r.member_id = ANY(%s)", [visible])
        rows = connection.execute(
            f"""
            SELECT r.id, r.member_id, u.email, mp.full_name, mp.department, r.reason,
                   r.created_at, r.image_object_key IS NOT NULL,
                   EXISTS (SELECT 1 FROM face_embeddings f
                           WHERE f.member_id = r.member_id AND f.revoked_at IS NULL
                             AND f.image_object_key IS NOT NULL)
            FROM face_change_requests r
            JOIN users u ON u.id = r.member_id
            LEFT JOIN member_profiles mp ON mp.user_id = r.member_id
            WHERE {where} AND r.status = 'PENDING'
            ORDER BY r.created_at
            """,
            parameters,
        ).fetchall()
    return [
        {
            "id": row[0],
            "member_id": row[1],
            "email": row[2],
            "full_name": row[3],
            "department": row[4],
            "reason": row[5],
            "created_at": row[6],
            "has_new_photo": row[7],
            "has_current_photo": row[8],
        }
        for row in rows
    ]


def request_photo(user: CurrentUser, request_id: uuid.UUID) -> tuple[bytes, str]:
    """The proposed face. The one on file is served by the existing endpoint, so
    a reviewer sees both without either being special-cased."""
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            "SELECT member_id, image_object_key FROM face_change_requests WHERE id = %s",
            (request_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="FACE_REQUEST_NOT_FOUND")
        assert_can_see_member(connection, user, row[0])
    if not row[1]:
        raise HTTPException(status_code=404, detail="ENROLLMENT_PHOTO_MISSING")
    return PrivateObjectStorage().get_private(row[1])


def decide(user: CurrentUser, request_id: uuid.UUID, approve: bool, note: str | None) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            "SELECT member_id, embedding::text, model_name, model_version, quality_score,"
            " image_object_key FROM face_change_requests WHERE id = %s AND status = 'PENDING'",
            (request_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="FACE_REQUEST_NOT_FOUND")
        member_id = row[0]
        assert_can_see_member(connection, user, member_id)
        if member_id == user.id:
            # The whole point is that somebody else looks at it.
            raise HTTPException(status_code=409, detail="CANNOT_APPROVE_OWN_FACE")

        connection.execute(
            "UPDATE face_change_requests SET status = %s, decided_by = %s, decided_at = now(),"
            " decision_note = %s WHERE id = %s",
            ("APPROVED" if approve else "REJECTED", user.id, note, request_id),
        )

        if approve:
            connection.execute(
                "UPDATE face_embeddings SET revoked_at = now()"
                " WHERE member_id = %s AND revoked_at IS NULL",
                (member_id,),
            )
            connection.execute(
                "INSERT INTO face_embeddings"
                " (member_id, embedding, model_name, model_version, quality_score, image_object_key)"
                " VALUES (%s, %s::vector, %s, %s, %s, %s)",
                (member_id, row[1], row[2], row[3], row[4], row[5]),
            )

        connection.execute(
            "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_json, reason)"
            " VALUES (%s, %s, 'face_change_request', %s, %s::jsonb, %s)",
            (user.id, "FACE_CHANGE_APPROVED" if approve else "FACE_CHANGE_REJECTED",
             request_id, json.dumps({"member_id": str(member_id)}), note),
        )
        notify(
            connection, member_id,
            "FACE_CHANGE_APPROVED" if approve else "FACE_CHANGE_REJECTED",
            "Ảnh khuôn mặt mới đã được duyệt" if approve else "Yêu cầu đổi ảnh khuôn mặt bị từ chối",
            "Từ giờ hệ thống dùng ảnh mới để nhận ra bạn."
            if approve else (note or "Bạn liên hệ người quản lý để biết thêm."),
            {"request_id": str(request_id)},
        )
        connection.commit()
    return {"id": request_id, "status": "APPROVED" if approve else "REJECTED"}


def my_status(member_id: uuid.UUID) -> dict:
    with psycopg.connect(DATABASE_URL) as connection:
        pending = open_request(connection, member_id)
        last = connection.execute(
            "SELECT status, decision_note, decided_at FROM face_change_requests"
            " WHERE member_id = %s AND status <> 'PENDING' ORDER BY decided_at DESC LIMIT 1",
            (member_id,),
        ).fetchone()
    return {
        "pending": pending,
        "last": {"status": last[0], "note": last[1], "decided_at": last[2]} if last else None,
    }
