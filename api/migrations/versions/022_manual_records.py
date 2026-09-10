"""Bản ghi do người nhập không có số đo của máy, và phải nói rõ điều đó.

Revision ID: 022_manual_records
Revises: 021_record_overrides
"""

from alembic import op


revision = "022_manual_records"
down_revision = "021_record_overrides"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Approving a correction creates a record for a moment nobody measured:
    # there was no camera, no GPS fix, no face. Writing the site's own
    # coordinates with distance 0 would make that row indistinguishable from a
    # real check-in, which is precisely the lie this project refuses to tell
    # about the AI. So the measurement columns become nullable, and every row
    # says where it came from.
    for column in ("latitude", "longitude", "gps_accuracy_meters", "distance_meters"):
        op.execute(f"ALTER TABLE attendance_events ALTER COLUMN {column} DROP NOT NULL")

    op.execute("""
        CREATE TYPE attendance_source AS ENUM ('DEVICE', 'CORRECTION', 'MANUAL')
    """)
    op.execute("""
        ALTER TABLE attendance_events
        ADD COLUMN source attendance_source NOT NULL DEFAULT 'DEVICE'
    """)

    # Which correction produced this row, when one did.
    op.execute("""
        ALTER TABLE attendance_events
        ADD COLUMN correction_request_id UUID
            REFERENCES attendance_correction_requests(id) ON DELETE SET NULL
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS correction_request_id")
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS source")
    op.execute("DROP TYPE IF EXISTS attendance_source")
    # Rows without a measurement cannot be made NOT NULL again; they are given
    # the impossible-but-obvious 0/0 so the constraint can be restored.
    for column in ("latitude", "longitude", "gps_accuracy_meters", "distance_meters"):
        op.execute(f"UPDATE attendance_events SET {column} = 0 WHERE {column} IS NULL")
        op.execute(f"ALTER TABLE attendance_events ALTER COLUMN {column} SET NOT NULL")
