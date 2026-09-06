"""Expected hours per location, and a unique member code.

The expected hours act as a fallback for lateness when a member has no personal
shift in `schedules`; a personal shift still wins.
"""

from alembic import op


revision = "011_location_hours"
down_revision = "010_single_active_session"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE locations ADD COLUMN expected_check_in TIME")
    op.execute("ALTER TABLE locations ADD COLUMN expected_check_out TIME")
    op.execute("ALTER TABLE locations ADD COLUMN grace_minutes SMALLINT NOT NULL DEFAULT 10")
    op.execute(
        """
        ALTER TABLE locations ADD CONSTRAINT locations_hours_ordered
        CHECK (
            expected_check_in IS NULL
            OR expected_check_out IS NULL
            OR expected_check_in < expected_check_out
        )
        """
    )

    # Codes are compared case-insensitively so "nv-001" and "NV-001" cannot both
    # exist. Blank strings are treated as "no code" rather than a duplicate.
    op.execute("UPDATE member_profiles SET employee_code = NULL WHERE btrim(employee_code) = ''")
    op.execute(
        """
        CREATE UNIQUE INDEX idx_member_profiles_employee_code
        ON member_profiles (lower(btrim(employee_code)))
        WHERE employee_code IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_member_profiles_employee_code")
    op.execute("ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_hours_ordered")
    op.execute("ALTER TABLE locations DROP COLUMN IF EXISTS grace_minutes")
    op.execute("ALTER TABLE locations DROP COLUMN IF EXISTS expected_check_out")
    op.execute("ALTER TABLE locations DROP COLUMN IF EXISTS expected_check_in")
