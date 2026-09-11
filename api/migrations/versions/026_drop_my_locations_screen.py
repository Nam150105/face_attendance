"""Màn hình "Nơi chấm công" không còn nữa.

Revision ID: 026_drop_my_locations
Revises: 025_refresh_grace
"""

from alembic import op


revision = "026_drop_my_locations"
down_revision = "025_refresh_grace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The place a member checks in at is already on the home page and in the
    # check-in screen's own picker. A third screen listing the same places
    # was a menu entry with nothing to do.
    op.execute("DELETE FROM role_permissions WHERE screen = 'my-locations'")


def downgrade() -> None:
    op.execute("""
        INSERT INTO role_permissions (role, screen, can_view, can_create, can_edit, can_delete)
        VALUES ('MEMBER', 'my-locations', true, false, false, false),
               ('MANAGER', 'my-locations', true, false, false, false),
               ('SUPER_ADMIN', 'my-locations', true, false, false, false)
        ON CONFLICT DO NOTHING
    """)
