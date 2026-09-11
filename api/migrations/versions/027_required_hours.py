"""Mọi địa điểm đều có giờ làm; ca là ca ngày cho tới khi ca đêm sẵn sàng.

Revision ID: 027_required_hours
Revises: 026_drop_my_locations
"""

from alembic import op


revision = "027_required_hours"
down_revision = "026_drop_my_locations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A place with no hours could not say whether anybody was late, and
    # managers left the field blank because it was optional. 08:00–17:00 is
    # the default the form offers; existing rows get the same and the manager
    # corrects it where it differs.
    op.execute(
        """
        UPDATE locations
        SET expected_check_in = COALESCE(expected_check_in, TIME '08:00'),
            expected_check_out = COALESCE(expected_check_out, TIME '17:00')
        WHERE expected_check_in IS NULL OR expected_check_out IS NULL
        """
    )
    op.execute("ALTER TABLE locations ALTER COLUMN expected_check_in SET NOT NULL")
    op.execute("ALTER TABLE locations ALTER COLUMN expected_check_out SET NOT NULL")
    # The column exists so the form can show the choice; the service refuses
    # NIGHT until the day builder can put a check-in and its check-out on two
    # calendar dates. The ordering check stays for the same reason.
    op.execute(
        "ALTER TABLE locations ADD COLUMN shift_kind TEXT NOT NULL DEFAULT 'DAY'"
        " CHECK (shift_kind IN ('DAY', 'NIGHT'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE locations DROP COLUMN IF EXISTS shift_kind")
    op.execute("ALTER TABLE locations ALTER COLUMN expected_check_in DROP NOT NULL")
    op.execute("ALTER TABLE locations ALTER COLUMN expected_check_out DROP NOT NULL")
