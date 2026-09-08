"""
Wipe every trace of use and leave a system that looks freshly installed.

    docker compose run --rm -v "<repo>/scripts:/scripts:ro" \
      -e RESET_KEEP_EMAIL=admin@example.com api python /scripts/reset_data.py --yes

Removes attendance records, evidence photos, face data, profiles, locations,
memberships, notifications, corrections, audit logs and sessions, then every
account except the one named by RESET_KEEP_EMAIL.

What it deliberately does NOT touch:
  * the schema — tables and enums stay, this is a data wipe, not a rebuild
  * `alembic_version` — the database stays at the migration it was on
  * `role_permissions` — the permission grid is configuration, not user data

There is no undo. Nothing here is recoverable without a backup taken first.
"""

from __future__ import annotations

import os
import sys

import psycopg

sys.path.insert(0, "/app")

DATABASE_URL = os.environ["DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://", 1)
KEEP_EMAIL = os.environ.get("RESET_KEEP_EMAIL", "").strip().lower()

# Ordered so that children go before the rows they point at.
TABLES = (
    "login_attempts",
    "notifications",
    "attendance_correction_requests",
    "attendance_summary",
    "attendance_events",
    "schedules",
    "member_locations",
    "face_enrollment_challenges",
    "face_embeddings",
    "audit_logs",
    "manager_memberships",
    "locations",
    "member_profiles",
    "password_reset_tokens",
    "refresh_sessions",
)


def purge_objects() -> int:
    """Evidence photos and enrolment photos live in object storage, not in
    Postgres. Clearing the rows without clearing these would leave the faces
    behind — the most sensitive thing the system holds."""
    try:
        from app.services.storage import PrivateObjectStorage
    except Exception as error:
        print(f"  ! không nạp được kho ảnh: {error}")
        return 0

    storage = PrivateObjectStorage()
    removed = 0
    try:
        paginator = storage.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=storage.bucket):
            keys = [{"Key": item["Key"]} for item in page.get("Contents", [])]
            if not keys:
                continue
            storage.client.delete_objects(Bucket=storage.bucket, Delete={"Objects": keys})
            removed += len(keys)
    except Exception as error:
        print(f"  ! xoá ảnh không trọn vẹn: {error}")
    return removed


def main() -> int:
    if "--yes" not in sys.argv:
        print("Từ chối chạy: thiếu --yes. Lệnh này xoá sạch dữ liệu và không hoàn tác được.")
        return 2
    if not KEEP_EMAIL:
        print("Từ chối chạy: chưa đặt RESET_KEEP_EMAIL, chạy tiếp là không còn tài khoản nào để đăng nhập.")
        return 2

    with psycopg.connect(DATABASE_URL) as connection:
        kept = connection.execute(
            "SELECT id, role::text FROM users WHERE lower(email) = %s", (KEEP_EMAIL,)
        ).fetchone()
        if kept is None:
            print(f"Từ chối chạy: không tìm thấy tài khoản {KEEP_EMAIL} để giữ lại.")
            return 2
        if kept[1] != "SUPER_ADMIN":
            print(f"Từ chối chạy: {KEEP_EMAIL} không phải quản trị hệ thống, giữ lại cũng không cấu hình được gì.")
            return 2

        print(f"Giữ lại: {KEEP_EMAIL}")
        for table in TABLES:
            before = connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            connection.execute(f"DELETE FROM {table}")
            print(f"  {table}: xoá {before} dòng")

        # role_permissions points at whoever last changed a tick; those accounts
        # are about to go, but the ticks themselves must survive.
        connection.execute("UPDATE role_permissions SET updated_by = NULL")

        removed = connection.execute(
            "DELETE FROM users WHERE id <> %s RETURNING id", (kept[0],)
        ).fetchall()
        print(f"  users: xoá {len(removed)} tài khoản")
        connection.commit()

    print(f"  ảnh trong kho: xoá {purge_objects()} tệp")
    print("Xong. Hệ thống trống, chỉ còn tài khoản quản trị.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
