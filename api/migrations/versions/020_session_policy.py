"""Một thiết bị hay nhiều thiết bị, do quản trị hệ thống quyết định.

Revision ID: 020_session_policy
Revises: 019_one_manager
"""

from alembic import op


revision = "020_session_policy"
down_revision = "019_one_manager"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The rule lived in an environment variable, so changing it meant editing a
    # file and restarting the API — which is not something the person running
    # the organisation can do. It is an operating decision, not a deployment
    # one, so it belongs in a table with a screen on top of it.
    #
    # Seeded to match what the deployment does today: members on one device,
    # everybody else free. Nobody is logged out by this migration.
    op.execute("""
        CREATE TABLE session_policies (
            role user_role PRIMARY KEY,
            allow_multiple_devices BOOLEAN NOT NULL DEFAULT true,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by UUID REFERENCES users(id) ON DELETE SET NULL
        )
    """)
    op.execute("""
        INSERT INTO session_policies (role, allow_multiple_devices) VALUES
            ('MEMBER', false),
            ('MANAGER', true),
            ('SUPER_ADMIN', true)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS session_policies")
