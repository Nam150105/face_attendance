"""Một thành viên chỉ thuộc về một người quản lý.

Revision ID: 019_one_manager
Revises: 018_team_locations
"""

from alembic import op


revision = "019_one_manager"
down_revision = "018_team_locations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Two managers over one person meant two people answerable for the same
    # attendance, two sets of hours, and no clear owner when something went
    # wrong. One manager at a time; moving somebody means the old manager
    # releases them first.
    #
    # Anyone who already has more than one keeps the oldest and loses the rest,
    # because the first relationship is the one people actually work under.
    op.execute("""
        UPDATE manager_memberships
        SET status = 'REMOVED', updated_at = now()
        WHERE status = 'ACTIVE' AND id NOT IN (
            SELECT DISTINCT ON (member_user_id) id
            FROM manager_memberships
            WHERE status = 'ACTIVE'
            ORDER BY member_user_id, created_at
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX idx_membership_one_manager"
        " ON manager_memberships (member_user_id) WHERE status = 'ACTIVE'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_membership_one_manager")
