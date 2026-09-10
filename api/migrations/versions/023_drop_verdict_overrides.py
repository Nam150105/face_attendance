"""Một ô trạng thái, không phải ba nơi nói về cùng một chuyện.

Revision ID: 023_drop_verdicts
Revises: 022_manual_records
"""

from alembic import op


revision = "023_drop_verdicts"
down_revision = "022_manual_records"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Two override switches beside a status dropdown were three controls
    # describing one thing, and they could disagree: face "không khớp" sitting
    # next to a record marked "Hợp lệ" told the reader nothing they could act
    # on. The status now carries the whole verdict, with failure_code saying
    # which half went wrong, exactly as it does for a record the system judged
    # itself. Nothing else ever read these two columns.
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS face_verdict_override")
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS location_verdict_override")


def downgrade() -> None:
    op.execute("ALTER TABLE attendance_events ADD COLUMN face_verdict_override BOOLEAN")
    op.execute("ALTER TABLE attendance_events ADD COLUMN location_verdict_override BOOLEAN")
