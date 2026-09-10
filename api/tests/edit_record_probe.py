"""
Sửa bản ghi: từng lượt một, sửa được mọi thứ, nhưng số máy đo thì không đổi.

    docker compose run --rm -v "<repo>/api:/src:ro" -w /src \
      -e PROBE_BASE_URL=http://api:8000/api/v1 api python -m tests.edit_record_probe
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
                 gps_accuracy_meters, distance_meters, face_match_score, face_distance, face_engine,
                 idempotency_key)
            VALUES (%s, %s, %s, %s, %s, 21, 105.8, 5, 12.5, 0.88, 0.144, 'face_recognition', %s)
            RETURNING id::text
            """,
            (member_id, location_id, event_type, status, moment, "edit-" + uuid.uuid4().hex),
        ).fetchone()
        connection.commit()
    return row[0]


def make_location(token: str, name: str) -> str:
    status, row = call("POST", "/manager/locations", token, {
        "name": name, "address": None, "latitude": 21.0, "longitude": 105.8,
        "allow_radius_meters": 500, "warning_radius_meters": 900, "is_active": True,
    })
    if status != 201:
        raise SystemExit(f"cannot create location: {status} {row}")
    return row["id"]


def main() -> int:
    created: list[str] = []
    try:
        manager_email, manager = register("MANAGER", created)
        other_email, other = register("MANAGER", created)
        member_email, member = register("MEMBER", created)
        call("POST", "/manager/members/add-by-email", manager, {"email": member_email})
        member_id = call("GET", "/manager/members", manager)[1][0]["user_id"]

        here = make_location(manager, "Sửa bản ghi A")
        there = make_location(manager, "Sửa bản ghi B")
        outside = make_location(other, "Của người khác")

        morning = datetime.now(LOCAL_ZONE).replace(hour=8, minute=30, second=0, microsecond=0)
        check_in = seed(member_id, here, morning.astimezone(timezone.utc), "CHECK_IN")
        check_out = seed(member_id, here, (morning + timedelta(hours=8)).astimezone(timezone.utc), "CHECK_OUT")

        # --- 1. Each half is edited on its own ---------------------------------
        corrected = (morning - timedelta(minutes=25)).astimezone(timezone.utc)
        status, updated = call("POST", f"/manager/attendance/{check_in}/manual-adjust", manager, {
            "server_time": corrected.isoformat(),
            "reason": "Đồng hồ máy lệch, đã đối chiếu camera cửa.",
        })
        check("Sửa được giờ của lượt vào", status == 200, f"HTTP {status}")
        check("Giờ mới được ghi nhận",
              updated.get("server_time", "").startswith(corrected.isoformat()[:16]),
              str(updated.get("server_time")))
        check("Giờ máy báo lúc đầu vẫn giữ lại",
              updated.get("original_server_time") is not None,
              str(updated.get("original_server_time")))

        status, other_half = call("GET", f"/manager/attendance/{check_out}", manager)
        check("Sửa lượt vào không đụng tới lượt ra",
              other_half.get("edited_at") is None, str(other_half.get("edited_at")))

        # --- 2. Verdicts sit beside the measurement, never on top of it --------
        status, updated = call("POST", f"/manager/attendance/{check_in}/manual-adjust", manager, {
            "face_ok": False,
            "location_ok": True,
            "status": "FAILED",
            "reason": "Ảnh không phải người này, nhưng vị trí thì đúng.",
        })
        check("Đánh dấu khuôn mặt không khớp và vị trí hợp lệ", status == 200, f"HTTP {status}")
        check("Hai phán quyết được lưu riêng",
              updated.get("face_verdict_override") is False
              and updated.get("location_verdict_override") is True,
              f"{updated.get('face_verdict_override')} / {updated.get('location_verdict_override')}")
        check("Số máy đo giữ nguyên, không bị viết đè",
              updated.get("face_distance") == 0.144 and updated.get("distance_meters") == 12.5,
              f"{updated.get('face_distance')} / {updated.get('distance_meters')}")
        check("Trạng thái đổi theo", updated.get("status") == "FAILED", str(updated.get("status")))

        status, back = call("POST", f"/manager/attendance/{check_in}/manual-adjust", manager, {
            "face_ok": None, "status": "SUCCESS",
            "reason": "Xem lại camera thì đúng là người này.",
        })
        check("Trả phán quyết khuôn mặt về cho máy được",
              status == 200 and back.get("face_verdict_override") is None,
              str(back.get("face_verdict_override")))

        # --- 3. Moving a record to another place -------------------------------
        status, moved = call("POST", f"/manager/attendance/{check_out}/manual-adjust", manager, {
            "location_id": there, "reason": "Cuối ca ở chi nhánh B, ghi nhầm chi nhánh A.",
        })
        check("Chuyển bản ghi sang địa điểm khác của mình",
              status == 200 and moved.get("location_id") == there, f"HTTP {status}")

        status, refused = call("POST", f"/manager/attendance/{check_out}/manual-adjust", manager, {
            "location_id": outside, "reason": "Thử đẩy sang nơi của người khác.",
        })
        check("Không đẩy được sang địa điểm của người quản lý khác",
              status == 404 and refused.get("detail") == "LOCATION_NOT_FOUND",
              f"HTTP {status} {refused.get('detail')}")

        # --- 4. Guard rails -----------------------------------------------------
        status, _ = call("POST", f"/manager/attendance/{check_in}/manual-adjust", manager, {
            "status": "SUCCESS", "reason": "x",
        })
        check("Lý do quá ngắn thì không sửa được", status == 422, f"HTTP {status}")

        status, _ = call("POST", f"/manager/attendance/{check_in}/manual-adjust", manager, {
            "reason": "Không đổi gì cả, chỉ bấm lưu.",
        })
        check("Không đổi gì thì báo không có gì để sửa", status == 422, f"HTTP {status}")

        status, _ = call("POST", f"/manager/attendance/{check_in}/manual-adjust", other, {
            "status": "FAILED", "reason": "Người quản lý khác thử sửa.",
        })
        check("Người quản lý khác không sửa được bản ghi này", status == 404, f"HTTP {status}")

        # --- 5. Everything is written down --------------------------------------
        status, logs = call("GET", "/manager/audit-logs?action=ATTENDANCE_MANUALLY_ADJUSTED", manager)
        mine = [row for row in logs.get("items", []) if row.get("entity_id") in {check_in, check_out}]
        check("Mỗi lần sửa là một dòng nhật ký có lý do",
              len(mine) >= 4 and all(row.get("reason") for row in mine), f"{len(mine)} dòng")
        check("Nhật ký giữ cả giá trị trước và sau",
              all(row.get("before_json") and row.get("after_json") for row in mine),
              str(len(mine)))

        for location_id in (here, there):
            call("DELETE", f"/manager/locations/{location_id}/permanent", manager)
        call("DELETE", f"/manager/locations/{outside}/permanent", other)
    finally:
        cleanup(created)

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
