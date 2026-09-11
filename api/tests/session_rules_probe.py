"""
Phiên mở/đóng theo thời gian, không bịa lượt ra, ba màn hình một câu trả lời.
Chạy trên LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.session_rules_probe
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg

from tests.security_probe import DATABASE_URL, JPEG, call, cleanup, multipart, register

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
            (member_id, location_id, event_type, status, moment, "sess-" + uuid.uuid4().hex,
             "OUTSIDE_ALLOWED_ZONE" if status == "BLOCKED" else "FACE_NOT_MATCHED" if status == "FAILED" else None),
        ).fetchone()
        connection.commit()
    return row[0]


def wipe(member_id: str) -> None:
    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute("DELETE FROM attendance_events WHERE member_id = %s", (member_id,))
        connection.commit()


def try_check_out(token: str) -> tuple[int, str]:
    fields = {"latitude": "21.0", "longitude": "105.8", "gps_accuracy_meters": "5",
              "idempotency_key": "sess-" + uuid.uuid4().hex}
    body, content_type = multipart(fields, "image", "a.jpg", JPEG, "image/jpeg")
    status, payload = call("POST", "/attendance/check-out", token, raw=body, content_type=content_type)
    return status, payload.get("detail", "") if isinstance(payload, dict) else ""


def try_check_in(token: str, location_id: str) -> tuple[int, str]:
    fields = {"location_id": location_id, "latitude": "21.0", "longitude": "105.8",
              "gps_accuracy_meters": "5", "idempotency_key": "sess-" + uuid.uuid4().hex}
    body, content_type = multipart(fields, "image", "a.jpg", JPEG, "image/jpeg")
    status, payload = call("POST", "/attendance/check-in", token, raw=body, content_type=content_type)
    return status, payload.get("detail", "") if isinstance(payload, dict) else ""


def day_rows(manager: str, day: str, include_invalid: bool = False) -> list[dict]:
    status, payload = call(
        "GET",
        f"/manager/attendance/sessions?date_from={day}&date_to={day}&include_invalid={str(include_invalid).lower()}",
        manager,
    )
    return payload.get("items", [])


def main() -> int:
    created: list[str] = []
    try:
        manager_email, manager = register("MANAGER", created)
        member_email, member = register("MEMBER", created)
        call("POST", "/manager/members/add-by-email", manager, {"email": member_email})
        member_id = call("GET", "/manager/members", manager)[1][0]["user_id"]
        status, location = call("POST", "/manager/locations", manager, {
            "name": "Session rules", "address": None, "latitude": 21.0, "longitude": 105.8,
            "allow_radius_meters": 500, "warning_radius_meters": 900, "is_active": True,
        })
        location_id = location["id"]
        call("POST", f"/manager/members/{member_id}/locations", manager,
             {"location_id": location_id, "is_default": True})

        now = datetime.now(timezone.utc)
        today = now.astimezone(LOCAL_ZONE).date().isoformat()
        yesterday = (now.astimezone(LOCAL_ZONE).date() - timedelta(days=1)).isoformat()

        # --- 1. Open for 20 hours, then simply not open -------------------------
        seed(member_id, location_id, now - timedelta(hours=3), "CHECK_IN")
        status, state = call("GET", "/attendance/me/state", member)
        check("Vào 3 tiếng trước thì đang trong phiên", state.get("state") == "CHECKED_IN", str(state.get("state")))

        wipe(member_id)
        seed(member_id, location_id, now - timedelta(hours=21), "CHECK_IN")
        status, state = call("GET", "/attendance/me/state", member)
        check("Vào 21 tiếng trước thì phiên đã khép, về trạng thái chưa mở phiên",
              state.get("state") == "NOT_CHECKED_IN", str(state.get("state")))

        with psycopg.connect(DATABASE_URL) as connection:
            invented = connection.execute(
                "SELECT count(*) FROM attendance_events WHERE member_id = %s AND event_type = 'CHECK_OUT'",
                (member_id,),
            ).fetchone()[0]
        check("Không có lượt ra nào được bịa ra", invented == 0, f"{invented} lượt ra")

        status, detail = try_check_out(member)
        check("Chấm ra sau 20 tiếng bị từ chối và nói rõ phiên đã khép",
              status == 409 and detail == "SESSION_EXPIRED", f"HTTP {status} {detail}")

        rows = day_rows(manager, yesterday) + day_rows(manager, today)
        stale = [r for r in rows if r["check_in"] and not r["check_out"]]
        check("Ngày hôm đó hiện 'chưa chấm ra', không hiện đủ vào ra",
              len(stale) == 1 and stale[0]["status"] == "OPEN", str([r["status"] for r in rows]))

        # --- 2. A check-out from another site closes the session ---------------
        wipe(member_id)
        seed(member_id, location_id, now - timedelta(hours=9), "CHECK_IN")
        seed(member_id, location_id, now - timedelta(hours=1), "CHECK_OUT", "WARNING_CONFIRMED")
        status, state = call("GET", "/attendance/me/state", member)
        check("Chấm ra ở nơi khác (hợp lệ có lý do) cũng đóng được phiên",
              state.get("state") == "NOT_CHECKED_IN", str(state.get("state")))

        # --- 3. A departure after midnight belongs to the day it started --------
        wipe(member_id)
        last_night = datetime.now(LOCAL_ZONE).replace(hour=22, minute=0, second=0, microsecond=0) - timedelta(days=1)
        seed(member_id, location_id, last_night.astimezone(timezone.utc), "CHECK_IN")
        seed(member_id, location_id, (last_night + timedelta(hours=2, minutes=30)).astimezone(timezone.utc), "CHECK_OUT")
        y_rows = day_rows(manager, yesterday)
        t_rows = day_rows(manager, today)
        check("Vào 22:00 hôm qua, ra 00:30 hôm nay → một ngày công của hôm qua",
              len(y_rows) == 1 and y_rows[0]["check_in"] and y_rows[0]["check_out"]
              and y_rows[0]["status"] == "ON_TIME" and y_rows[0]["worked_minutes"] == 150,
              f"hôm qua {[(r['status'], r['worked_minutes']) for r in y_rows]}")
        check("Hôm nay không có lượt ra mồ côi", len(t_rows) == 0, f"{len(t_rows)} dòng")

        # --- 4. One session a day, counted by check-ins ------------------------
        status, detail = try_check_in(member, location_id)
        check("Hôm qua đã làm việc thì hôm nay vẫn chấm vào được (ảnh chưa đăng ký nên chỉ tới bước mặt)",
              detail == "FACE_NOT_ENROLLED", f"HTTP {status} {detail}")

        wipe(member_id)
        morning = datetime.now(LOCAL_ZONE).replace(hour=1, minute=0, second=0, microsecond=0)
        seed(member_id, location_id, morning.astimezone(timezone.utc), "CHECK_IN")
        seed(member_id, location_id, (morning + timedelta(hours=1)).astimezone(timezone.utc), "CHECK_OUT")
        status, detail = try_check_in(member, location_id)
        check("Hôm nay đã có một phiên thì không mở phiên thứ hai",
              status == 409 and detail == "ALREADY_WORKED_TODAY", f"HTTP {status} {detail}")

        # --- 5. Three screens, one answer --------------------------------------
        wipe(member_id)
        seed(member_id, location_id, morning.astimezone(timezone.utc), "CHECK_IN", "FAILED")
        seed(member_id, location_id, (morning + timedelta(minutes=5)).astimezone(timezone.utc), "CHECK_IN")
        seed(member_id, location_id, (morning + timedelta(hours=8)).astimezone(timezone.utc), "CHECK_OUT")
        with psycopg.connect(DATABASE_URL) as connection:
            connection.execute(
                "UPDATE attendance_events SET minutes_late = 12 WHERE member_id = %s AND event_type = 'CHECK_IN' AND status = 'SUCCESS'",
                (member_id,),
            )
            connection.commit()

        table = day_rows(manager, today, include_invalid=True)[0]
        month = today[:7]
        status, calendar = call("GET", f"/manager/attendance/calendar?month={month}&include_invalid=true", manager)
        cal_day = next(d for d in calendar["days"] if d["date"] == today)
        cal_person = next(p for p in cal_day["people"] if p["member_id"] == member_id)
        status, mine = call("GET", f"/attendance/me/daily?date_from={today}&date_to={today}", member)
        my_day = mine["days"][0]

        check("Bảng, lịch và bảng công cá nhân cùng nói 'đi muộn'",
              table["status"] == "LATE" and cal_person["status"] == "LATE" and my_day["status"] == "LATE",
              f"{table['status']} / {cal_person['status']} / {my_day['status']}")
        check("Cùng một giờ vào ở cả ba nơi",
              table["check_in"] == cal_person["check_in"] == my_day["check_in"],
              f"{table['check_in']} / {cal_person['check_in']} / {my_day['check_in']}")
        check("Dòng bảng mở đúng lượt vào hợp lệ, không phải lượt bị từ chối",
              table["check_in_id"] is not None and table["rejected"] == 1
              and all(a["id"] != table["check_in_id"] for a in table["attempts"] if a["status"] == "FAILED"),
              f"rejected={table['rejected']}")

        # --- 6. A day with only refusals names what was refused ------------------
        wipe(member_id)
        seed(member_id, location_id, morning.astimezone(timezone.utc), "CHECK_IN", "BLOCKED")
        only = day_rows(manager, today, include_invalid=True)[0]
        check("Ngày chỉ có lượt bị chặn vì vị trí → 'Địa điểm không khớp'",
              only["status"] == "REJECTED_PLACE", str(only["status"]))

        call("DELETE", f"/manager/locations/{location_id}/permanent", manager)
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
