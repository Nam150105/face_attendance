"""
Xoá một ngày công là xoá cả ngày, không phải một nửa. Chạy trên LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.delete_day_probe
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg

from tests.security_probe import DATABASE_URL, call, cleanup, register

LOCAL_ZONE = ZoneInfo(os.getenv("APP_TIMEZONE", "Asia/Ho_Chi_Minh"))

results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def seed(member_id: str, location_id: str, moment: datetime, event_type: str, status: str = "SUCCESS") -> str:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            """
            INSERT INTO attendance_events
                (member_id, location_id, event_type, status, server_time, latitude, longitude,
                 gps_accuracy_meters, distance_meters, idempotency_key, failure_code)
            VALUES (%s, %s, %s, %s, %s, 21, 105.8, 5, 10, %s, %s)
            RETURNING id::text
            """,
            (
                member_id, location_id, event_type, status, moment,
                "del-" + uuid.uuid4().hex,
                "FACE_NOT_MATCHED" if status == "FAILED" else None,
            ),
        ).fetchone()
        connection.commit()
    return row[0]


def live_count(member_id: str) -> int:
    with psycopg.connect(DATABASE_URL) as connection:
        return connection.execute(
            "SELECT count(*) FROM attendance_events WHERE member_id = %s AND deleted_at IS NULL",
            (member_id,),
        ).fetchone()[0]


def main() -> int:
    created: list[str] = []
    try:
        manager_email, manager = register("MANAGER", created)
        other_email, other = register("MANAGER", created)
        member_email, member = register("MEMBER", created)
        call("POST", "/manager/members/add-by-email", manager, {"email": member_email})
        member_id = call("GET", "/manager/members", manager)[1][0]["user_id"]

        status, location = call("POST", "/manager/locations", manager, {
            "name": "Delete day probe", "address": None, "latitude": 21.0, "longitude": 105.8,
            "allow_radius_meters": 500, "warning_radius_meters": 900, "is_active": True,
        })
        location_id = location["id"]

        today = datetime.now(LOCAL_ZONE).replace(hour=8, minute=0, second=0, microsecond=0)
        yesterday = today - timedelta(days=1)
        day = today.date().isoformat()

        check_in = seed(member_id, location_id, today.astimezone(timezone.utc), "CHECK_IN")
        check_out = seed(member_id, location_id, (today + timedelta(hours=8)).astimezone(timezone.utc), "CHECK_OUT")
        refused = seed(member_id, location_id, (today + timedelta(hours=1)).astimezone(timezone.utc), "CHECK_IN", "FAILED")
        keep = seed(member_id, location_id, yesterday.astimezone(timezone.utc), "CHECK_IN")

        check("Ngày công dựng xong có đủ vào, ra và một lần bị từ chối", live_count(member_id) == 4, str(live_count(member_id)))

        # --- 1. Somebody else's manager cannot delete it ----------------------
        status, _ = call(
            "DELETE",
            f"/manager/attendance/day?member_id={member_id}&work_date={day}&reason=Thu%20xoa",
            other,
        )
        check("Người quản lý khác không xoá được ngày công này", status == 404, f"HTTP {status}")
        check("Và không có gì bị mất", live_count(member_id) == 4, str(live_count(member_id)))

        # --- 2. A reason is still required ------------------------------------
        status, _ = call(
            "DELETE", f"/manager/attendance/day?member_id={member_id}&work_date={day}&reason=x", manager
        )
        check("Không nêu lý do thì không xoá được", status == 422, f"HTTP {status}")

        # --- 3. The whole day goes, and only that day -------------------------
        status, summary = call(
            "DELETE",
            f"/manager/attendance/day?member_id={member_id}&work_date={day}"
            "&reason=Cham%20nham%20ca%2C%20xoa%20ca%20ngay",
            manager,
        )
        check("Xoá được cả ngày công", status == 200 and summary.get("deleted") == 3,
              f"HTTP {status} xoá {summary.get('deleted')}")
        check("Ngày hôm đó không còn bản ghi nào sống", live_count(member_id) == 1, str(live_count(member_id)))

        status, remaining = call("GET", "/manager/attendance?include_invalid=true", manager)
        ids = {row["id"] for row in remaining.get("items", [])}
        check("Cả lượt vào lẫn lượt ra đều biến mất khỏi danh sách",
              check_in not in ids and check_out not in ids and refused not in ids, f"{len(ids)} bản ghi")
        check("Ngày hôm trước vẫn còn nguyên", keep in ids, str(sorted(ids)))

        status, sessions = call(
            "GET", f"/manager/attendance/sessions?date_from={day}&date_to={day}&include_invalid=true", manager
        )
        check("Bảng ngày công không còn dòng nào của ngày đó",
              status == 200 and sessions.get("total") == 0, str(sessions.get("total")))

        # --- 4. Nothing left to delete twice ----------------------------------
        status, _ = call(
            "DELETE",
            f"/manager/attendance/day?member_id={member_id}&work_date={day}&reason=Xoa%20lan%20nua",
            manager,
        )
        check("Xoá lại lần nữa thì báo không còn gì", status == 404, f"HTTP {status}")

        # --- 5. Soft delete: the rows and their photos are still recoverable ---
        with psycopg.connect(DATABASE_URL) as connection:
            gone = connection.execute(
                "SELECT count(*) FROM attendance_events"
                " WHERE member_id = %s AND deleted_at IS NOT NULL AND delete_reason IS NOT NULL",
                (member_id,),
            ).fetchone()[0]
            logged = connection.execute(
                "SELECT count(*) FROM audit_logs WHERE action = 'ATTENDANCE_DELETED'"
                " AND entity_id = ANY(%s)",
                ([uuid.UUID(check_in), uuid.UUID(check_out), uuid.UUID(refused)],),
            ).fetchone()[0]
        check("Ba bản ghi nằm ở dạng xoá mềm kèm lý do", gone == 3, str(gone))
        check("Nhật ký ghi lại từng bản ghi một, để khôi phục lẻ được", logged == 3, str(logged))

        call("DELETE", f"/manager/locations/{location_id}/permanent", manager)
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
