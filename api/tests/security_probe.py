"""
Security probe for Phase 9 — runs against a LIVE stack, not in unit tests.

It needs Postgres, Redis, MinIO and the API up, so it is not picked up by
`unittest discover` (the filename does not start with "test_"). Run it with:

    docker compose exec -T api python -m tests.security_probe

It creates two throwaway managers and three throwaway members, exercises the
authorization boundaries between them, then removes everything it created.
"""

from __future__ import annotations

import io
import os
import sys
import uuid

import psycopg
import urllib.error
import urllib.request
import json


BASE = os.environ.get("PROBE_BASE_URL", "http://localhost:8000/api/v1")
DATABASE_URL = os.environ["DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://", 1)
PASSWORD = "ProbePass123!"
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 512

results: list[tuple[bool, str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((passed, name, detail))
    print(("PASS  " if passed else "FAIL  ") + name + ("  " + detail if detail else ""))


def call(method: str, path: str, token: str | None = None, body: dict | None = None,
         raw: bytes | None = None, content_type: str | None = None) -> tuple[int, dict | bytes]:
    request = urllib.request.Request(BASE + path, method=method)
    if token:
        request.add_header("X-API-Key", token)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        request.add_header("Content-Type", "application/json")
    elif raw is not None:
        data = raw
        request.add_header("Content-Type", content_type or "application/octet-stream")
    try:
        with urllib.request.urlopen(request, data, timeout=30) as response:
            payload = response.read()
            try:
                return response.status, json.loads(payload)
            except ValueError:
                return response.status, payload
    except urllib.error.HTTPError as error:
        payload = error.read()
        try:
            return error.code, json.loads(payload)
        except ValueError:
            return error.code, payload


def multipart(fields: dict[str, str], file_field: str, filename: str,
              content: bytes, declared_type: str) -> tuple[bytes, str]:
    boundary = "----probe" + uuid.uuid4().hex
    buffer = io.BytesIO()
    for key, value in fields.items():
        buffer.write(f"--{boundary}\r\n".encode())
        buffer.write(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
        buffer.write(f"{value}\r\n".encode())
    buffer.write(f"--{boundary}\r\n".encode())
    buffer.write(
        f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'.encode()
    )
    buffer.write(f"Content-Type: {declared_type}\r\n\r\n".encode())
    buffer.write(content)
    buffer.write(f"\r\n--{boundary}--\r\n".encode())
    return buffer.getvalue(), f"multipart/form-data; boundary={boundary}"


def register(role: str) -> tuple[str, str]:
    """
    Fixtures are inserted directly so repeated probe runs do not eat the public
    registration quota — the limiter is a thing under test, not a thing to fight.
    """
    from passlib.context import CryptContext

    email = f"probe-{uuid.uuid4().hex[:12]}@example.com"
    with psycopg.connect(DATABASE_URL) as connection:
        connection.execute(
            "INSERT INTO users (email, password_hash, role, status, email_verified_at)"
            " VALUES (%s, %s, %s::user_role, 'ACTIVE', now())",
            (email, CryptContext(schemes=["bcrypt"]).hash(PASSWORD), role),
        )
        connection.commit()
    status, payload = call("POST", "/auth/login", body={"email": email, "password": PASSWORD})
    if status != 200:
        raise SystemExit(f"cannot log in as {role}: {status} {payload}")
    return email, payload["access_token"]


# Every table that points at users, in the order that satisfies the FKs.
_DEPENDENTS = (
    ("attendance_summary", "member_id"),
    ("attendance_events", "member_id"),
    ("schedules", "member_id"),
    ("member_locations", "member_id"),
    ("face_enrollment_challenges", "member_id"),
    ("face_embeddings", "member_id"),
    ("audit_logs", "actor_user_id"),
    ("manager_memberships", "manager_user_id"),
    ("manager_memberships", "member_user_id"),
    ("locations", "manager_user_id"),
    ("member_profiles", "user_id"),
    ("password_reset_tokens", "user_id"),
    ("refresh_sessions", "user_id"),
)


def cleanup(emails: list[str]) -> None:
    """Remove the throwaway accounts and everything they produced."""
    with psycopg.connect(DATABASE_URL) as connection:
        ids = [
            row[0]
            for row in connection.execute(
                "SELECT id FROM users WHERE email = ANY(%s)", (emails,)
            ).fetchall()
        ]
        if not ids:
            return
        for table, column in _DEPENDENTS:
            connection.execute(f"DELETE FROM {table} WHERE {column} = ANY(%s)", (ids,))
        connection.execute("DELETE FROM users WHERE id = ANY(%s)", (ids,))
        connection.commit()


def main() -> int:
    created: list[str] = []
    try:
        manager_a_email, manager_a = register("MANAGER")
        manager_b_email, manager_b = register("MANAGER")
        member_a_email, member_a = register("MEMBER")
        member_b_email, member_b = register("MEMBER")
        created = [manager_a_email, manager_b_email, member_a_email, member_b_email]

        # Manager A manages Member A only; Manager B manages Member B only.
        call("POST", "/manager/members/add-by-email", manager_a, {"email": member_a_email})
        call("POST", "/manager/members/add-by-email", manager_b, {"email": member_b_email})

        status, roster_a = call("GET", "/manager/members", manager_a)
        ids_a = {row["user_id"] for row in roster_a} if isinstance(roster_a, list) else set()
        status, roster_b = call("GET", "/manager/members", manager_b)
        ids_b = {row["user_id"] for row in roster_b} if isinstance(roster_b, list) else set()

        # --- 1. Auth bypass -------------------------------------------------
        status, _ = call("GET", "/auth/me")
        check("Auth: gọi endpoint riêng tư khi không có token bị từ chối", status == 401, f"HTTP {status}")

        status, _ = call("GET", "/auth/me", "not-a-real-token")
        check("Auth: token rác bị từ chối", status == 401, f"HTTP {status}")

        # A refresh token must not be usable as an access token.
        status, tokens = call("POST", "/auth/login", body={"email": member_a_email, "password": PASSWORD})
        refresh_token = tokens["refresh_token"] if status == 200 else ""
        status, _ = call("GET", "/auth/me", refresh_token)
        check("JWT: refresh token không dùng được thay cho access token", status == 401, f"HTTP {status}")

        # --- 2. Privilege escalation ---------------------------------------
        status, _ = call("GET", "/manager/members", member_a)
        check("RBAC: MEMBER không vào được endpoint quản trị", status == 403, f"HTTP {status}")

        # The client asked for MANAGER at registration; the server must not let a
        # member promote itself by re-registering claims.
        status, payload = call("GET", "/auth/me", member_a)
        check("RBAC: role do server quyết định, không lấy từ client",
              status == 200 and payload.get("role") == "MEMBER", str(payload.get("role")))

        # --- 3. IDOR / BOLA -------------------------------------------------
        other_member_id = next(iter(ids_b)) if ids_b else str(uuid.uuid4())
        status, _ = call("GET", f"/manager/members/{other_member_id}/attendance", manager_a)
        check("BOLA: Manager A không đọc được chấm công của thành viên Manager B",
              status in (403, 404), f"HTTP {status}")

        status, _ = call("POST", f"/manager/members/{other_member_id}/locations", manager_a,
                         {"location_id": str(uuid.uuid4()), "is_default": True})
        check("BOLA: Manager A không gán được địa điểm cho thành viên ngoài phạm vi",
              status in (403, 404, 422), f"HTTP {status}")

        # Manager A creates a location; Manager B must not touch it.
        status, location = call("POST", "/manager/locations", manager_a, {
            "name": "Probe location", "address": None,
            "latitude": 21.0, "longitude": 105.8,
            "allow_radius_meters": 100, "warning_radius_meters": 200, "is_active": True,
        })
        location_id = location.get("id") if status in (200, 201) else None
        if location_id:
            status, _ = call("PUT", f"/manager/locations/{location_id}", manager_b, {
                "name": "Hijacked", "address": None,
                "latitude": 0.0, "longitude": 0.0,
                "allow_radius_meters": 100, "warning_radius_meters": 200, "is_active": True,
            })
            check("IDOR: Manager B không sửa được địa điểm của Manager A",
                  status in (403, 404), f"HTTP {status}")
            status, _ = call("DELETE", f"/manager/locations/{location_id}", manager_b)
            check("IDOR: Manager B không tắt được địa điểm của Manager A",
                  status in (403, 404), f"HTTP {status}")
        else:
            check("IDOR: tạo địa điểm để thử", False, f"HTTP {status} {location}")

        # Attendance evidence belonging to nobody in Manager A's scope.
        status, _ = call("GET", f"/manager/attendance/{uuid.uuid4()}/image", manager_a)
        check("Signed URL: ảnh bằng chứng không đoán được bằng id ngẫu nhiên",
              status == 404, f"HTTP {status}")

        status, _ = call("GET", f"/manager/attendance/{uuid.uuid4()}/image", member_a)
        check("Signed URL: MEMBER không gọi được endpoint ảnh bằng chứng",
              status == 403, f"HTTP {status}")

        # --- 4. Upload abuse ------------------------------------------------
        body, content_type = multipart(
            {"challenge_id": str(uuid.uuid4()), "challenge": "x" * 20},
            "image", "evil.html", b"<html><script>alert(1)</script></html>", "image/jpeg",
        )
        status, payload = call("POST", "/faces/enrollment/verify", member_a, raw=body, content_type=content_type)
        check("Upload: HTML giả danh ảnh bị chặn theo magic byte",
              status == 400 and payload.get("detail") == "UNSUPPORTED_IMAGE_TYPE", f"HTTP {status} {payload}")

        body, content_type = multipart(
            {"challenge_id": str(uuid.uuid4()), "challenge": "x" * 20},
            "image", "big.jpg", b"\xff\xd8\xff\xe0" + b"\x00" * (10 * 1024 * 1024 + 10), "image/jpeg",
        )
        status, payload = call("POST", "/faces/enrollment/verify", member_a, raw=body, content_type=content_type)
        check("Upload: ảnh quá 10 MB bị từ chối chứ không bị cắt bớt",
              status == 413, f"HTTP {status}")

        body, content_type = multipart(
            {"challenge_id": str(uuid.uuid4()), "challenge": "x" * 20},
            "image", "e.svg", b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>", "image/svg+xml",
        )
        status, payload = call("POST", "/faces/enrollment/verify", member_a, raw=body, content_type=content_type)
        check("Upload: SVG (có thể chứa script) bị chặn",
              status == 400, f"HTTP {status}")

        # --- 5. SQL injection ----------------------------------------------
        status, payload = call("POST", "/auth/login",
                               body={"email": "a@b.co' OR '1'='1", "password": "x"})
        check("SQLi: payload trong email không vượt được đăng nhập",
              status in (401, 422), f"HTTP {status}")

        status, _ = call("GET", "/manager/attendance?status=SUCCESS%27%20OR%201%3D1--", manager_a)
        check("SQLi: filter status chỉ nhận giá trị trong allowlist",
              status == 422, f"HTTP {status}")

        # --- 6. Path traversal ---------------------------------------------
        # Object keys are generated server-side, so traversal can only be attempted
        # through the id. Either a routing 404 or a validation 422 is a safe refusal.
        for hostile in ("..%2F..%2Fetc%2Fpasswd", "..", "attendance%2F..%2F..%2Fetc%2Fpasswd"):
            status, payload = call("GET", f"/manager/attendance/{hostile}/image", manager_a)
            check(f"Path traversal: id {hostile[:24]!r} bị từ chối",
                  status in (404, 422) and b"root:" not in (payload if isinstance(payload, bytes) else b""),
                  f"HTTP {status}")

        # --- 7. SSRF via map link expansion ---------------------------------
        for hostile in (
            "http://169.254.169.254/latest/meta-data/",
            "http://minio:9000/",
            "https://face-ai:8001/v1/enroll",
            "http://localhost:8000/api/v1/auth/me",
            "https://attacker.example.org/redirect",
        ):
            status, payload = call("POST", "/manager/locations/resolve-place", manager_a, {"query": hostile})
            detail = payload.get("detail") if isinstance(payload, dict) else ""
            check(f"SSRF: link tới {hostile.split('/')[2]} bị chặn",
                  status == 422 and detail == "PLACE_LINK_HOST_NOT_ALLOWED",
                  f"HTTP {status} {detail}")

        # --- 8. Replay / double-submit --------------------------------------
        # Seed an event owned by Member A so the replay actually reaches the
        # idempotency logic instead of being refused earlier for other reasons.
        shared_key = "probe-" + uuid.uuid4().hex
        member_a_id = next(iter(ids_a)) if ids_a else None
        seeded = False
        if member_a_id and location_id:
            with psycopg.connect(DATABASE_URL) as connection:
                connection.execute(
                    """
                    INSERT INTO attendance_events
                      (member_id, location_id, event_type, status, server_time, latitude, longitude,
                       gps_accuracy_meters, distance_meters, idempotency_key)
                    VALUES (%s, %s, 'CHECK_IN', 'BLOCKED', now(), 21.0, 105.8, 5, 10, %s)
                    """,
                    (member_a_id, location_id, shared_key),
                )
                connection.commit()
            seeded = True

        fields = {
            "location_id": location_id or str(uuid.uuid4()),
            "latitude": "21.0", "longitude": "105.8",
            "gps_accuracy_meters": "5",
            "idempotency_key": shared_key,
        }
        body, content_type = multipart(fields, "image", "a.jpg", JPEG, "image/jpeg")
        replay_status, replay_payload = call("POST", "/attendance/check-in", member_b, raw=body, content_type=content_type)
        replay_detail = replay_payload.get("detail") if isinstance(replay_payload, dict) else ""
        check("Replay: thành viên khác dùng lại idempotency key bị từ chối, không nhận bản ghi của người kia",
              seeded and replay_status == 409 and replay_detail == "IDEMPOTENCY_KEY_CONFLICT",
              f"HTTP {replay_status} {replay_detail}" + ("" if seeded else " (chưa seed được)"))

        # The owner replaying their own key must still get their own event back.
        body, content_type = multipart(fields, "image", "a.jpg", JPEG, "image/jpeg")
        own_status, own_payload = call("POST", "/attendance/check-in", member_a, raw=body, content_type=content_type)
        own_message = own_payload.get("message") if isinstance(own_payload, dict) else ""
        check("Replay: chính chủ gửi lại vẫn nhận đúng bản ghi cũ (idempotent)",
              own_status == 200 and own_message == "Request already processed",
              f"HTTP {own_status} {own_message}")

        # --- 9. Rate limiting ------------------------------------------------
        codes = []
        for _ in range(14):
            code, _ = call("POST", "/auth/login", body={"email": member_b_email, "password": "WrongPassword1!"})
            codes.append(code)
        check("Rate limit: đăng nhập sai liên tục bị chặn 429",
              429 in codes, f"lần đầu 429 ở thử #{codes.index(429) + 1}" if 429 in codes else str(codes[-3:]))

        # A correct password must still be refused while the window is hot.
        code, _ = call("POST", "/auth/login", body={"email": member_b_email, "password": PASSWORD})
        check("Rate limit: không bypass được bằng mật khẩu đúng khi đang bị chặn",
              code == 429, f"HTTP {code}")

        return 0 if all(passed for passed, _, _ in results) else 1
    finally:
        if created:
            cleanup(created)
        print()
        passed = sum(1 for ok, _, _ in results if ok)
        print(f"{passed}/{len(results)} passed")


if __name__ == "__main__":
    sys.exit(main())
