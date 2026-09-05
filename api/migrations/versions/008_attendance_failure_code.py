"""Record why an attendance attempt was rejected."""

from alembic import op


revision = "008_attendance_failure_code"
down_revision = "007_face_enrollment_challenges"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE attendance_events ADD COLUMN failure_code TEXT")
    op.execute(
        "CREATE INDEX idx_attendance_events_failed ON attendance_events (member_id, server_time DESC) "
        "WHERE status IN ('BLOCKED', 'FAILED')"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_attendance_events_failed")
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS failure_code")
