"""
Paired check-in / check-out — runs against a LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.sessions_probe
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg

from tests.security_probe import DATABASE_URL, call, cleanup, register

LOCAL_ZONE = ZoneInfo(os.getenv("APP_TIMEZONE", "Asia/Ho_Chi_Minh"))

results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def seed(member_id: str, location_id: str, moment: datetime, event_type: str,
         status: str = "SUCCESS", minutes_late: int | None = None) -> None:
    column = "minutes_late" if event_type == "CHECK_IN" else "minutes_early_leave"
    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute(
            f"""
            INSERT INTO attendance_events
                (member_id, location_id, event_type, status, server_time, latitude, longitude,
                 gps_accuracy_meters, distance_meters, idempotency_key, {column})
            VALUES (%s, %s, %s, %s, %s, 21, 105.8, 5, 10, %s, %s)
            """,
            (member_id, location_id, event_type, status, moment, "sess-" + uuid.uuid4().hex, minutes_late),
        )
        connection.commit()


def day_of(payload: dict, iso: str) -> dict | None:
    for row in payload.get("items", []):
        if row["work_date"] == iso:
            return row
    return None


def main() -> int:
    created: list[str] = []
    try:
        manager_email, manager = register("MANAGER", created)
        member_email, member = register("MEMBER", created)
        other_email, other = register("MANAGER", created)
        call("POST", "/manager/members/add-by-email", manager, {"email": member_email})
        member_id = call("GET", "/manager/members", manager)[1][0]["user_id"]

        status, location = call("POST", "/manager/locations", manager, {
            "name": "Sessions probe", "address": None, "latitude": 21.0, "longitude": 105.8,
            "allow_radius_meters": 500, "warning_radius_meters": 900, "is_active": True,
        })
        location_id = location["id"]

        base = datetime(2026, 4, 6, 1, 0, tzinfo=ZoneInfo("UTC"))
        full_day = base.astimezone(LOCAL_ZONE).date()
        seed(member_id, location_id, base, "CHECK_IN", minutes_late=12)
        seed(member_id, location_id, base + timedelta(hours=8), "CHECK_OUT")

        open_base = base + timedelta(days=1)
        open_day = open_base.astimezone(LOCAL_ZONE).date()
        seed(member_id, location_id, open_base, "CHECK_IN")

        refused_base = base + timedelta(days=2)
        refused_day = refused_base.astimezone(LOCAL_ZONE).date()
        seed(member_id, location_id, refused_base, "CHECK_IN", status="BLOCKED")

        status, payload = call(
            "GET", "/manager/attendance/sessions?date_from=2026-04-01&date_to=2026-04-30", manager
        )
        check("Lấy được ngày công theo khoảng ngày", status == 200, f"HTTP {status}")

        complete = day_of(payload, full_day.isoformat())
        check("Vào và ra của cùng một ngày gộp thành một dòng",
              complete is not None and complete["check_in"] and complete["check_out"],
              f"{len(payload.get('items', []))} dòng")
        check("Dòng đó ghi rõ đi muộn bao nhiêu",
              complete and complete["minutes_late"] == 12 and complete["status"] == "LATE",
              f"{complete['status']} {complete['minutes_late']}'" if complete else "")

        unfinished = day_of(payload, open_day.isoformat())
        check("Ngày chưa chấm ra hiện rõ là chưa xong",
              unfinished is not None and unfinished["check_out"] is None
              and unfinished["status"] == "OPEN",
              unfinished["status"] if unfinished else "thiếu")

        check("Mặc định không lẫn lượt bị từ chối",
              day_of(payload, refused_day.isoformat()) is None)

        status, wide = call(
            "GET",
            "/manager/attendance/sessions?date_from=2026-04-01&date_to=2026-04-30&include_invalid=true",
            manager,
        )
        refused = day_of(wide, refused_day.isoformat())
        check("Bật hiện lượt không hợp lệ thì thấy ngày bị từ chối",
              refused is not None and refused["status"] in {"REJECTED_PLACE", "REJECTED_FACE"},
              refused["status"] if refused else "thiếu")

        check("Mỗi dòng kèm mã bản ghi để mở chi tiết",
              complete and complete["check_in_id"] and complete["check_out_id"])

        status, foreign = call(
            "GET", "/manager/attendance/sessions?date_from=2026-04-01&date_to=2026-04-30", other
        )
        check("Người quản lý khác không thấy ngày công ngoài phạm vi",
              status == 200 and foreign.get("total") == 0, str(foreign.get("total")))

        status, _ = call("GET", "/manager/attendance/sessions", member)
        check("Thành viên chưa được cấp quyền thì không mở được", status == 403, f"HTTP {status}")

        status, one = call(
            "GET",
            f"/manager/attendance/sessions?date_from={full_day.isoformat()}&date_to={full_day.isoformat()}",
            manager,
        )
        check("Lọc theo ngày trả đúng một dòng", one.get("total") == 1, str(one.get("total")))

        call("DELETE", f"/manager/locations/{location_id}/permanent", manager)
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
