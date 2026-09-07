"""Super-admin role, and drop the per-member shift assignment.

Working hours now live on the location only: one place to set them, one rule to
explain. The schedules table is kept (with its rows) rather than dropped, so the
change is reversible and no attendance history loses its context.
"""

from alembic import op


revision = "013_super_admin"
down_revision = "012_location_hour_rules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older
    # servers; COMMIT first so this works on every supported version.
    op.execute("COMMIT")
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'")

    # Every shift row is retired in one go: hours come from the location now.
    op.execute("UPDATE schedules SET is_active = false WHERE is_active")

    # Soft delete for attendance: a manager may remove a record from the books
    # without destroying the evidence trail behind it.
    op.execute("ALTER TABLE attendance_events ADD COLUMN deleted_at TIMESTAMPTZ")
    op.execute("ALTER TABLE attendance_events ADD COLUMN deleted_by UUID REFERENCES users(id)")
    op.execute("ALTER TABLE attendance_events ADD COLUMN delete_reason TEXT")
    op.execute(
        "CREATE INDEX idx_attendance_events_live ON attendance_events (member_id, server_time DESC) "
        "WHERE deleted_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_attendance_events_live")
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS delete_reason")
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS deleted_by")
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS deleted_at")
    # An enum value cannot be removed once added; SUPER_ADMIN stays.
