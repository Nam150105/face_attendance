"""
Duyệt chỉnh công phải sửa bảng công thật, và chưa đủ điều kiện thì không cho
chấm công. Chạy trên LIVE stack.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.correction_probe
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


def seed(member_id: str, location_id: str, moment: datetime, event_type: str) -> str:
    with psycopg.connect(DATABASE_URL) as connection:
        row = connection.execute(
            """
            INSERT INTO attendance_events
                (member_id, location_id, event_type, status, server_time, latitude, longitude,
                 gps_accuracy_meters, distance_meters, idempotency_key)
            VALUES (%s, %s, %s, 'SUCCESS', %s, 21, 105.8, 5, 10, %s)
            RETURNING id::text
            """,
            (member_id, location_id, event_type, moment, "corr-" + uuid.uuid4().hex),
        ).fetchone()
        connection.commit()
    return row[0]


def main() -> int:
    created: list[str] = []
    try:
        manager_email, manager = register("MANAGER", created)
        member_email, member = register("MEMBER", created)

        # --- 1. Nobody's member: check-in is off, and the reason says why -----
        status, state = call("GET", "/attendance/me/state", member)
        check("Chưa có người quản lý thì không cho chấm công",
              status == 200 and state.get("can_check_in") is False
              and state.get("blocked_reason") == "NO_MANAGER",
              f"HTTP {status} {state.get('blocked_reason')}")

        call("POST", "/manager/members/add-by-email", manager, {"email": member_email})
        member_id = call("GET", "/manager/members", manager)[1][0]["user_id"]

        status, state = call("GET", "/attendance/me/state", member)
        check("Có quản lý nhưng chưa có địa điểm thì vẫn không cho",
              state.get("can_check_in") is False and state.get("blocked_reason") == "NO_LOCATION",
              str(state.get("blocked_reason")))

        status, location = call("POST", "/manager/locations", manager, {
            "name": "Chỉnh công probe", "address": None, "latitude": 21.0, "longitude": 105.8,
            "allow_radius_meters": 500, "warning_radius_meters": 900, "is_active": True,
        })
        location_id = location["id"]
        call("POST", f"/manager/members/{member_id}/locations", manager,
             {"location_id": location_id, "is_default": True})

        status, state = call("GET", "/attendance/me/state", member)
        check("Có địa điểm rồi thì chỉ còn thiếu khuôn mặt",
              state.get("blocked_reason") == "NO_FACE" and state.get("location_count") == 1,
              f"{state.get('blocked_reason')} · {state.get('location_count')} nơi")

        # --- 2. Quên chấm ra: duyệt xong bảng công phải có giờ ra -------------
        morning = datetime.now(LOCAL_ZONE).replace(hour=8, minute=0, second=0, microsecond=0)
        work_date = morning.date().isoformat()
        seed(member_id, location_id, morning.astimezone(timezone.utc), "CHECK_IN")

        wanted_out = (morning + timedelta(hours=9)).astimezone(timezone.utc)
        status, request = call("POST", "/attendance/corrections", member, {
            "work_date": work_date,
            "request_type": "MISSING_CHECK_OUT",
            "requested_check_out": wanted_out.isoformat(),
            "reason": "Máy hết pin nên quên chấm ra.",
        })
        check("Gửi được yêu cầu chỉnh công", status == 201, f"HTTP {status} {request}")

        status, sessions = call(
            "GET", f"/manager/attendance/sessions?date_from={work_date}&date_to={work_date}", manager
        )
        check("Trước khi duyệt, ngày đó vẫn thiếu giờ ra",
              sessions["items"][0]["check_out"] is None, str(sessions["items"][0]["check_out"]))

        status, decided = call("POST", f"/manager/corrections/{request['id']}/review", manager, {
            "decision": "APPROVED", "note": "Đã đối chiếu camera.",
        })
        check("Duyệt được", status == 200, f"HTTP {status}")
        check("Duyệt xong có bản ghi mới được tạo",
              len(decided.get("created", [])) == 1, str(decided.get("created")))

        status, sessions = call(
            "GET", f"/manager/attendance/sessions?date_from={work_date}&date_to={work_date}", manager
        )
        day = sessions["items"][0]
        check("Bảng công đã có giờ ra đúng như yêu cầu",
              day["check_out"] is not None and day["check_out"].startswith(wanted_out.isoformat()[:13]),
              str(day["check_out"]))
        check("Ngày công không còn ở trạng thái chưa chấm ra",
              day["status"] != "OPEN", str(day["status"]))

        # --- 3. Bản ghi do người nhập nói rõ là không có số đo ----------------
        status, detail = call("GET", f"/manager/attendance/{decided['created'][0]}", manager)
        check("Bản ghi ghi rõ nguồn là chỉnh công",
              detail.get("source") == "CORRECTION", str(detail.get("source")))
        check("Không bịa toạ độ, không bịa khoảng cách, không bịa điểm khuôn mặt",
              detail.get("latitude") is None and detail.get("distance_meters") is None
              and detail.get("face_match_score") is None,
              f"{detail.get('latitude')} / {detail.get('distance_meters')}")
        check("Giữ lại lý do của thành viên",
              "quên chấm ra" in (detail.get("reason") or "").lower(), str(detail.get("reason")))

        # --- 4. Sửa giờ: cập nhật bản ghi đã có, không tạo thêm ---------------
        moved = (morning + timedelta(hours=1)).astimezone(timezone.utc)
        status, second = call("POST", "/attendance/corrections", member, {
            "work_date": work_date,
            "request_type": "WRONG_TIME",
            "requested_check_in": moved.isoformat(),
            "requested_check_out": wanted_out.isoformat(),
            "reason": "Giờ vào ghi sớm hơn thực tế một tiếng.",
        })
        status, decided = call("POST", f"/manager/corrections/{second['id']}/review", manager, {
            "decision": "APPROVED", "note": "Đồng ý.",
        })
        check("Sửa giờ thì cập nhật bản ghi cũ chứ không tạo bản ghi thứ hai",
              status == 200 and len(decided.get("moved", [])) == 2 and not decided.get("created"),
              f"moved {decided.get('moved')} created {decided.get('created')}")

        status, sessions = call(
            "GET", f"/manager/attendance/sessions?date_from={work_date}&date_to={work_date}", manager
        )
        check("Vẫn đúng một ngày công, không nhân đôi",
              sessions["total"] == 1 and sessions["items"][0]["check_in"].startswith(moved.isoformat()[:13]),
              f"{sessions['total']} dòng · {sessions['items'][0]['check_in']}")

        # --- 5. Từ chối thì không đụng gì tới bảng công -----------------------
        status, third = call("POST", "/attendance/corrections", member, {
            "work_date": work_date, "request_type": "WRONG_TIME",
            "requested_check_in": morning.astimezone(timezone.utc).isoformat(),
            "reason": "Xin đổi lại giờ vào lần nữa.",
        })
        status, refused = call("POST", f"/manager/corrections/{third['id']}/review", manager, {
            "decision": "REJECTED", "note": "Không có căn cứ.",
        })
        status, sessions = call(
            "GET", f"/manager/attendance/sessions?date_from={work_date}&date_to={work_date}", manager
        )
        check("Từ chối thì bảng công giữ nguyên",
              sessions["items"][0]["check_in"].startswith(moved.isoformat()[:13]),
              str(sessions["items"][0]["check_in"]))

        call("DELETE", f"/manager/locations/{location_id}/permanent", manager)
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
