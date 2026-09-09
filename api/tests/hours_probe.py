"""
Working-hours probe — runs against a LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.hours_probe

The hour gate sits before face verification, so a member with no enrolled face
tells the two outcomes apart cleanly: 403 CHECK_IN_TOO_LATE means the gate
refused them, 409 FACE_NOT_ENROLLED means they got through it.
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from tests.security_probe import JPEG, call, cleanup, multipart, register

LOCAL_ZONE = ZoneInfo(os.getenv("APP_TIMEZONE", "Asia/Ho_Chi_Minh"))

# Working hours are wall-clock times on one day, and the table enforces
# start < end. Deriving them from "N minutes ago" made the probe wrap past
# midnight and fail depending on the hour it ran, so the cases below pin fixed
# times and vary the allowance instead:
#
#   DAY_START   already past by the time any probe runs, so arrival is late
#   DAY_END     late enough that start < end always holds
#   FUTURE      still ahead, so arrival counts as early
#
# The one case that must track the clock is "late but inside the allowance",
# because the allowance is capped at 240 minutes: the start has to sit a few
# minutes behind now. That case is the only one that would misbehave in the
# first five minutes after midnight, when "five minutes ago" is yesterday.
DAY_START = "00:05:00"
DAY_END = "23:55:00"
FUTURE_START = "23:58:00"
FUTURE_END = "23:59:00"

results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def save_hours(manager: str, location_id: str, start: str, end: str,
               grace: int, enforce: bool) -> tuple[int, dict]:
    return call("PUT", f"/manager/locations/{location_id}", manager, {
        "name": "Hours probe",
        "address": None,
        "latitude": 21.0,
        "longitude": 105.8,
        "allow_radius_meters": 500,
        "warning_radius_meters": 900,
        "is_active": True,
        "expected_check_in": start,
        "expected_check_out": end,
        "grace_minutes": grace,
        "enforce_hours": enforce,
    })


def _minutes_ago(minutes: int) -> str:
    return (datetime.now(LOCAL_ZONE) - timedelta(minutes=minutes)).strftime("%H:%M:%S")


def attempt(member: str, location_id: str) -> tuple[int, str]:
    fields = {
        "location_id": location_id,
        "latitude": "21.0",
        "longitude": "105.8",
        "gps_accuracy_meters": "5",
        "idempotency_key": "hours-" + uuid.uuid4().hex,
    }
    body, content_type = multipart(fields, "image", "a.jpg", JPEG, "image/jpeg")
    status, payload = call("POST", "/attendance/check-in", member, raw=body, content_type=content_type)
    detail = payload.get("detail", "") if isinstance(payload, dict) else ""
    return status, detail


def main() -> int:
    created: list[str] = []
    try:
        manager_email, manager = register("MANAGER", created)
        member_email, member = register("MEMBER", created)
        call("POST", "/manager/members/add-by-email", manager, {"email": member_email})

        status, roster = call("GET", "/manager/members", manager)
        member_id = roster[0]["user_id"] if isinstance(roster, list) and roster else None

        status, location = call("POST", "/manager/locations", manager, {
            "name": "Hours probe", "address": None, "latitude": 21.0, "longitude": 105.8,
            "allow_radius_meters": 500, "warning_radius_meters": 900, "is_active": True,
        })
        location_id = location.get("id") if status == 201 else None
        if not (member_id and location_id):
            print("cannot set up fixtures", status, location)
            return 1
        call("POST", f"/manager/members/{member_id}/locations", manager,
             {"location_id": location_id, "is_default": True})

        # A place with no hours at all must never gate anyone.
        code, detail = attempt(member, location_id)
        check("Không đặt giờ thì không ai bị chặn", code == 409 and detail == "FACE_NOT_ENROLLED",
              f"HTTP {code} {detail}")

        # Hours saved on the location, read back unchanged.
        status, saved = save_hours(manager, location_id, DAY_START, DAY_END, grace=10, enforce=False)
        check("Lưu được giờ vào/ra, số phút muộn cho phép và ô cho phép vào muộn",
              status == 200 and saved.get("grace_minutes") == 10 and saved.get("enforce_hours") is False,
              f"HTTP {status} grace={saved.get('grace_minutes')} enforce={saved.get('enforce_hours')}")

        # 120 minutes late, 10 allowed, tick off: recorded, not refused.
        code, detail = attempt(member, location_id)
        check("Quá giờ nhưng chưa bật chặn thì vẫn qua được cổng giờ",
              code == 409 and detail == "FACE_NOT_ENROLLED", f"HTTP {code} {detail}")

        # Same lateness, tick on: refused.
        save_hours(manager, location_id, DAY_START, DAY_END, grace=10, enforce=True)
        code, detail = attempt(member, location_id)
        check("Bật chặn thì quá số phút cho phép bị từ chối",
              code == 403 and detail == "CHECK_IN_TOO_LATE", f"HTTP {code} {detail}")

        # Still inside the allowed minutes, tick on: allowed through.
        save_hours(manager, location_id, _minutes_ago(5), DAY_END, grace=60, enforce=True)
        code, detail = attempt(member, location_id)
        check("Muộn trong mức cho phép thì vẫn vào được dù đang bật chặn",
              code == 409 and detail == "FACE_NOT_ENROLLED", f"HTTP {code} {detail}")

        # Arriving before the start time is never late.
        save_hours(manager, location_id, FUTURE_START, FUTURE_END, grace=0, enforce=True)
        code, detail = attempt(member, location_id)
        check("Đến sớm không bao giờ bị coi là muộn",
              code == 409 and detail == "FACE_NOT_ENROLLED", f"HTTP {code} {detail}")

        # The refusal is written down so a manager can see who was turned away.
        # Refused attempts are hidden by default now, so ask for them.
        status, events = call("GET", "/manager/attendance?include_invalid=true", manager)
        items = events.get("items", []) if isinstance(events, dict) else []
        blocked = [e for e in items if e.get("failure_code") == "CHECK_IN_TOO_LATE"]
        check("Lần bị từ chối được ghi lại cho người quản lý xem", len(blocked) == 1,
              f"{len(blocked)} bản ghi")

        # A member must not be able to move the goalposts themselves.
        status, _ = call("PUT", f"/manager/locations/{location_id}", member, {
            "name": "Hijacked", "latitude": 21.0, "longitude": 105.8,
            "allow_radius_meters": 500, "warning_radius_meters": 900,
            "grace_minutes": 240, "enforce_hours": False,
        })
        check("Thành viên không tự sửa được giờ của địa điểm", status == 403, f"HTTP {status}")

        call("DELETE", f"/manager/locations/{location_id}/permanent", manager)
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
