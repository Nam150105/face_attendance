"""Ca đêm: giờ ra được phép nhỏ hơn giờ vào khi ca vắt qua nửa đêm.

Revision ID: 028_night_shift
Revises: 027_required_hours
"""

from alembic import op


revision = "028_night_shift"
down_revision = "027_required_hours"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The old check said start < end for every row. A night shift is the one
    # case where it is the other way round, and the shift kind says which
    # order to expect.
    op.execute("ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_hours_ordered")
    op.execute(
        """
        ALTER TABLE locations ADD CONSTRAINT locations_hours_match_shift CHECK (
            (shift_kind = 'DAY' AND expected_check_in < expected_check_out)
            OR (shift_kind = 'NIGHT' AND expected_check_in > expected_check_out)
        )
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_hours_match_shift")
    op.execute("UPDATE locations SET shift_kind = 'DAY', expected_check_in = TIME '08:00', expected_check_out = TIME '17:00' WHERE shift_kind = 'NIGHT'")
    op.execute(
        "ALTER TABLE locations ADD CONSTRAINT locations_hours_ordered"
        " CHECK (expected_check_in IS NULL OR expected_check_out IS NULL OR expected_check_in < expected_check_out)"
    )
