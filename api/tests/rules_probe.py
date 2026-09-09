"""
Một người một quản lý, và một phiên mỗi ngày. Chạy trên LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.rules_probe
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg

from tests.security_probe import DATABASE_URL, PASSWORD, call, cleanup, register

LOCAL_ZONE = ZoneInfo(os.getenv("APP_TIMEZONE", "Asia/Ho_Chi_Minh"))

results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def seed(member_id: str, location_id: str, moment: datetime, event_type: str) -> None:
    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute(
            """
            INSERT INTO attendance_events
                (member_id, location_id, event_type, status, server_time, latitude, longitude,
                 gps_accuracy_meters, distance_meters, idempotency_key)
            VALUES (%s, %s, %s, 'SUCCESS', %s, 21, 105.8, 5, 10, %s)
            """,
            (member_id, location_id, event_type, moment, "rule-" + uuid.uuid4().hex),
        )
        connection.commit()


def try_check_in(token: str, location_id: str) -> tuple[int, str]:
    from tests.security_probe import JPEG, multipart

    fields = {
        "location_id": location_id, "latitude": "21.0", "longitude": "105.8",
        "gps_accuracy_meters": "5", "idempotency_key": "rule-" + uuid.uuid4().hex,
    }
    body, content_type = multipart(fields, "image", "a.jpg", JPEG, "image/jpeg")
    status, payload = call("POST", "/attendance/check-in", token, raw=body, content_type=content_type)
    return status, payload.get("detail", "") if isinstance(payload, dict) else ""


def main() -> int:
    created: list[str] = []
    try:
        alice_email, alice = register("MANAGER", created)
        bob_email, bob = register("MANAGER", created)
        member_email, member = register("MEMBER", created)

        # --- 1. One manager at a time -----------------------------------------
        status, _ = call("POST", "/manager/members/add-by-email", alice, {"email": member_email})
        check("Người quản lý đầu tiên nhận được thành viên", status == 201, f"HTTP {status}")

        status, payload = call("POST", "/manager/members/add-by-email", bob, {"email": member_email})
        check("Người quản lý thứ hai không nhận được nữa",
              status == 409 and payload.get("detail") == "ALREADY_HAS_MANAGER",
              f"HTTP {status} {payload.get('detail')}")

        status, team = call("POST", "/manager/teams", bob, {"name": "Nhóm của Bob"})
        status, payload = call("POST", "/teams/join", member, {"code": team["code"]})
        check("Đang có quản lý thì không xin vào nhóm khác được",
              status == 409 and payload.get("detail") == "ALREADY_HAS_MANAGER",
              f"HTTP {status} {payload.get('detail')}")

        status, bulk = call("POST", "/manager/members/bulk-add", bob, {"emails": [member_email]})
        outcome = bulk.get("results", [{}])[0].get("status") if isinstance(bulk, dict) else ""
        check("Thêm hàng loạt báo riêng dòng đó, không hỏng cả mẻ",
              status == 201 and outcome == "HAS_OTHER_MANAGER", f"HTTP {status} {outcome}")

        # Released by the first manager, the move becomes possible.
        member_id = call("GET", "/manager/members", alice)[1][0]["user_id"]
        call("PUT", f"/manager/members/{member_id}", alice, {"status": "REMOVED"})
        status, joined = call("POST", "/teams/join", member, {"code": team["code"]})
        check("Được gỡ khỏi nhóm cũ rồi thì xin sang nhóm mới được",
              status == 200, f"HTTP {status} {joined}")

        status, pending = call("GET", "/manager/join-requests", bob)
        request_id = next((row["member_id"] for row in pending if row["email"] == member_email), None)
        status, _ = call("POST", f"/manager/join-requests/{request_id}", bob, {"approve": True})
        check("Người quản lý mới duyệt được", status == 200, f"HTTP {status}")

        status, roster = call("GET", "/manager/members", alice)
        check("Người quản lý cũ không còn thấy người đó",
              all(row["email"] != member_email for row in roster), f"{len(roster)} người")

        # --- 2. The database refuses it even if a check is bypassed ------------
        with psycopg.connect(DATABASE_URL) as connection:
            alice_id = connection.execute(
                "SELECT id FROM users WHERE email = %s", (alice_email,)
            ).fetchone()[0]
            member_uuid = connection.execute(
                "SELECT id FROM users WHERE email = %s", (member_email,)
            ).fetchone()[0]
            try:
                connection.execute(
                    "INSERT INTO manager_memberships (manager_user_id, member_user_id, status)"
                    " VALUES (%s, %s, 'ACTIVE')",
                    (alice_id, member_uuid),
                )
                connection.commit()
                refused = False
            except psycopg.errors.UniqueViolation:
                connection.rollback()
                refused = True
        check("Cơ sở dữ liệu tự chặn người thứ hai, không chỉ dựa vào kiểm ở ứng dụng", refused)

        # --- 3. One session a day ----------------------------------------------
        status, location = call("POST", "/manager/locations", bob, {
            "name": "Rules probe", "address": None, "latitude": 21.0, "longitude": 105.8,
            "allow_radius_meters": 500, "warning_radius_meters": 900, "is_active": True,
        })
        location_id = location["id"]
        call("POST", f"/manager/members/{member_id}/locations", bob,
             {"location_id": location_id, "is_default": True})

        now = datetime.now(timezone.utc)
        start_of_day = datetime.now(LOCAL_ZONE).replace(hour=8, minute=0, second=0, microsecond=0)
        seed(member_id, location_id, start_of_day.astimezone(timezone.utc), "CHECK_IN")
        seed(member_id, location_id, (start_of_day + timedelta(hours=8)).astimezone(timezone.utc), "CHECK_OUT")

        status, detail = try_check_in(member, location_id)
        check("Đã vào và ra hôm nay thì không mở phiên mới trong ngày",
              status == 409 and detail == "ALREADY_WORKED_TODAY", f"HTTP {status} {detail}")

        # Yesterday's finished session must not block today.
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute(
                "UPDATE attendance_events SET server_time = server_time - interval '1 day'"
                " WHERE member_id = %s",
                (member_id,),
            )
            connection.commit()
        status, detail = try_check_in(member, location_id)
        check("Phiên của hôm qua không chặn hôm nay",
              status == 409 and detail == "FACE_NOT_ENROLLED", f"HTTP {status} {detail}")

        # An open session still blocks a second check-in, as before.
        seed(member_id, location_id, now - timedelta(hours=2), "CHECK_IN")
        status, detail = try_check_in(member, location_id)
        check("Đang mở phiên thì vẫn không chấm vào lần nữa",
              status == 409 and detail == "CHECK_IN_ALREADY_EXISTS", f"HTTP {status} {detail}")

        call("DELETE", f"/manager/locations/{location_id}/permanent", bob)
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
