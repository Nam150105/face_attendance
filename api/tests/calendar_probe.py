"""
Manager calendar probe — runs against a LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.calendar_probe
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
            (member_id, location_id, event_type, status, moment,
             "cal-" + uuid.uuid4().hex, minutes_late),
        )
        connection.commit()


def day_of(payload: dict, iso: str) -> dict | None:
    for day in payload.get("days", []):
        if day["date"] == iso:
            return day
    return None


def main() -> int:
    created: list[str] = []
    try:
        manager_email, manager = register("MANAGER", created)
        other_email, other = register("MANAGER", created)
        member_email, member = register("MEMBER", created)
        call("POST", "/manager/members/add-by-email", manager, {"email": member_email})

        status, roster = call("GET", "/manager/members", manager)
        member_id = roster[0]["user_id"] if isinstance(roster, list) and roster else None

        status, location = call("POST", "/manager/locations", manager, {
            "name": "Calendar probe", "address": None, "latitude": 21.0, "longitude": 105.8,
            "allow_radius_meters": 500, "warning_radius_meters": 900, "is_active": True,
        })
        location_id = location.get("id") if status == 201 else None
        if not (member_id and location_id):
            print("cannot set up fixtures", status, location)
            return 1

        # A day that only exists locally: 23:30 UTC is 06:30 the next morning here.
        edge_utc = datetime(2026, 3, 10, 23, 30, tzinfo=ZoneInfo("UTC"))
        local_day = edge_utc.astimezone(LOCAL_ZONE).date()
        seed(member_id, location_id, edge_utc, "CHECK_IN")
        seed(member_id, location_id, edge_utc + timedelta(hours=8), "CHECK_OUT")

        # A late arrival that is never closed, on another day.
        late_utc = datetime(2026, 3, 15, 2, 0, tzinfo=ZoneInfo("UTC"))
        late_day = late_utc.astimezone(LOCAL_ZONE).date()
        seed(member_id, location_id, late_utc, "CHECK_IN", minutes_late=18)

        # A refused attempt on a third day.
        blocked_utc = datetime(2026, 3, 20, 4, 0, tzinfo=ZoneInfo("UTC"))
        blocked_day = blocked_utc.astimezone(LOCAL_ZONE).date()
        seed(member_id, location_id, blocked_utc, "CHECK_IN", status="BLOCKED")

        # Default view: only what counts as attendance.
        status, clean = call("GET", "/manager/attendance/calendar?month=2026-03", manager)
        clean_days = [day["date"] for day in clean.get("days", [])]
        check("Mặc định lịch không hiện lượt bị từ chối",
              status == 200 and blocked_day.isoformat() not in clean_days,
              f"{len(clean_days)} ngày")
        check("Mặc định số tổng không cộng lượt bị từ chối",
              clean.get("summary", {}).get("rejected") == 0, str(clean.get("summary")))

        status, payload = call("GET", "/manager/attendance/calendar?month=2026-03&include_invalid=true", manager)
        check("Bật hiện lượt không hợp lệ thì lấy được cả tháng", status == 200, f"HTTP {status}")

        edge = day_of(payload, local_day.isoformat())
        check("Ngày được cắt theo giờ Việt Nam, không theo UTC",
              edge is not None and local_day.day == 11,
              f"23:30 UTC 10/03 nằm ở ngày {local_day.isoformat()}")
        check("Ngày hoàn chỉnh hiện là đúng giờ",
              edge is not None and edge["people"][0]["status"] == "ON_TIME",
              edge["people"][0]["status"] if edge else "không có ngày")
        check("Có cả giờ vào và giờ ra",
              edge is not None and edge["people"][0]["check_in"] and edge["people"][0]["check_out"])

        late = day_of(payload, late_day.isoformat())
        # A late arrival with no departure: the missing check-out is the thing
        # to act on, the minutes late travel with the row. Same rule as the
        # day list and the member's own timesheet.
        check("Vào muộn chưa ra: hiện chưa chấm ra, vẫn giữ số phút muộn",
              late is not None and late["people"][0]["status"] == "OPEN"
              and late["people"][0]["minutes_late"] == 18,
              f"{late['people'][0]['status']} {late['people'][0]['minutes_late']}'" if late else "thiếu")

        blocked = day_of(payload, blocked_day.isoformat())
        check("Lượt bị từ chối vẫn hiện nhưng không tính là đi làm",
              blocked is not None and blocked["people"][0]["status"] in {"REJECTED_PLACE", "REJECTED_FACE"}
              and blocked["people"][0]["check_in"] is None,
              blocked["people"][0]["status"] if blocked else "thiếu")

        summary = payload.get("summary", {})
        check("Số tổng khớp với dữ liệu đã gieo",
              summary.get("attended") == 2 and summary.get("late") == 1
              and summary.get("open_sessions") == 1 and summary.get("rejected") == 1,
              str(summary))

        # Another manager must not see any of it.
        status, foreign = call("GET", "/manager/attendance/calendar?month=2026-03&include_invalid=true", other)
        check("Manager khác không thấy dữ liệu của người không thuộc phạm vi",
              status == 200 and foreign.get("days") == [], f"HTTP {status} {len(foreign.get('days', []))} ngày")

        # A member has no business calling it at all.
        status, _ = call("GET", "/manager/attendance/calendar?month=2026-03&include_invalid=true", member)
        check("Thành viên không gọi được lịch của cả nhóm", status == 403, f"HTTP {status}")

        status, _ = call("GET", "/manager/attendance/calendar?month=thang-ba", manager)
        check("Tháng sai định dạng bị từ chối", status == 422, f"HTTP {status}")

        # A deleted record must disappear from the calendar too.
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute(
                "UPDATE attendance_events SET deleted_at = now(), delete_reason = 'probe'"
                " WHERE member_id = %s AND (server_time AT TIME ZONE 'UTC') = %s",
                (member_id, late_utc.replace(tzinfo=None)),
            )
            connection.commit()
        status, after = call("GET", "/manager/attendance/calendar?month=2026-03&include_invalid=true", manager)
        check("Bản ghi đã xoá biến khỏi lịch",
              day_of(after, late_day.isoformat()) is None,
              "vẫn còn" if day_of(after, late_day.isoformat()) else "")

        call("DELETE", f"/manager/locations/{location_id}/permanent", manager)
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
