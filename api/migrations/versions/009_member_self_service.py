"""Notifications and attendance correction requests for member self-service.

Schedules and attendance_summary already exist from 001; this only adds what is
genuinely missing.
"""

from alembic import op


revision = "009_member_self_service"
down_revision = "008_attendance_failure_code"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TYPE correction_request_type AS ENUM (
            'MISSING_CHECK_IN', 'MISSING_CHECK_OUT', 'WRONG_TIME', 'OTHER'
        )
        """
    )
    op.execute("CREATE TYPE correction_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED')")

    op.execute(
        """
        CREATE TABLE attendance_correction_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            member_id UUID NOT NULL REFERENCES users(id),
            work_date DATE NOT NULL,
            request_type correction_request_type NOT NULL,
            requested_check_in TIMESTAMPTZ,
            requested_check_out TIMESTAMPTZ,
            reason TEXT NOT NULL,
            status correction_request_status NOT NULL DEFAULT 'PENDING',
            reviewed_by UUID REFERENCES users(id),
            reviewed_at TIMESTAMPTZ,
            review_note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT correction_reason_not_blank CHECK (length(btrim(reason)) > 0)
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_corrections_member_created ON attendance_correction_requests "
        "(member_id, created_at DESC)"
    )
    # Managers list the queue by status; PENDING is the only hot partition.
    op.execute(
        "CREATE INDEX idx_corrections_pending ON attendance_correction_requests "
        "(created_at DESC) WHERE status = 'PENDING'"
    )
    # One open request per day per member keeps the review queue unambiguous.
    op.execute(
        "CREATE UNIQUE INDEX idx_corrections_one_open_per_day ON attendance_correction_requests "
        "(member_id, work_date) WHERE status = 'PENDING'"
    )

    op.execute(
        """
        CREATE TABLE notifications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id),
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT,
            payload_json JSONB,
            read_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at DESC)"
    )
    op.execute(
        "CREATE INDEX idx_notifications_unread ON notifications (user_id) WHERE read_at IS NULL"
    )

    # Schedules were never queried before; the member view reads them by date.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_schedules_member_active ON schedules (member_id) "
        "WHERE is_active"
    )
    op.execute("ALTER TABLE schedules ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id)")
    op.execute("ALTER TABLE schedules ADD COLUMN IF NOT EXISTS grace_minutes SMALLINT NOT NULL DEFAULT 10")
    op.execute("ALTER TABLE schedules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()")


def downgrade() -> None:
    op.execute("ALTER TABLE schedules DROP COLUMN IF EXISTS created_at")
    op.execute("ALTER TABLE schedules DROP COLUMN IF EXISTS grace_minutes")
    op.execute("ALTER TABLE schedules DROP COLUMN IF EXISTS location_id")
    op.execute("DROP INDEX IF EXISTS idx_schedules_member_active")
    op.execute("DROP TABLE IF EXISTS notifications")
    op.execute("DROP TABLE IF EXISTS attendance_correction_requests")
    op.execute("DROP TYPE IF EXISTS correction_request_status")
    op.execute("DROP TYPE IF EXISTS correction_request_type")
