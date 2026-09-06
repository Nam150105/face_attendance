"""Make the location's working hours either a hard rule or a reporting rule.

enforce_hours off (default): a late arrival is still recorded, and the manager
is told how late. On: arriving past the deadline is refused outright.
"""

from alembic import op


revision = "012_location_hour_rules"
down_revision = "011_location_hours"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE locations ADD COLUMN enforce_hours BOOLEAN NOT NULL DEFAULT false")
    # Minutes late/early are stored on the event so a report does not have to
    # re-derive them from a schedule that may have changed since.
    op.execute("ALTER TABLE attendance_events ADD COLUMN minutes_late SMALLINT")
    op.execute("ALTER TABLE attendance_events ADD COLUMN minutes_early_leave SMALLINT")


def downgrade() -> None:
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS minutes_early_leave")
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS minutes_late")
    op.execute("ALTER TABLE locations DROP COLUMN IF EXISTS enforce_hours")
