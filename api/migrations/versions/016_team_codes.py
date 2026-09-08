"""Team codes members type at sign-up, and the manager's approval of them.

Revision ID: 016_team_codes
Revises: 015_error_codes
"""

from alembic import op


revision = "016_team_codes"
down_revision = "015_error_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("COMMIT")
    # A person asks to join and waits; a manager can also turn them away. Both
    # states were missing, so "added by a manager" was the only way in.
    op.execute("ALTER TYPE membership_status ADD VALUE IF NOT EXISTS 'PENDING'")
    op.execute("ALTER TYPE membership_status ADD VALUE IF NOT EXISTS 'REJECTED'")

    # The unit a person types when they sign up. Short, because it gets read off
    # a whiteboard and typed on a phone.
    op.execute("""
        CREATE TABLE teams (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            manager_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            is_open BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    # Case-insensitive: nobody types a code the same way twice.
    op.execute("CREATE UNIQUE INDEX idx_teams_code ON teams (upper(code))")
    op.execute("CREATE INDEX idx_teams_manager ON teams (manager_user_id)")

    # Which unit a membership came through, and why it was refused.
    op.execute("ALTER TABLE manager_memberships ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE manager_memberships ADD COLUMN decided_at TIMESTAMPTZ")
    op.execute("ALTER TABLE manager_memberships ADD COLUMN decision_note TEXT")

    op.execute("""
        INSERT INTO role_permissions (role, screen, can_view, can_create, can_edit, can_delete)
        VALUES ('MEMBER', 'join-requests', false, false, false, false),
               ('MANAGER', 'join-requests', true, false, true, false),
               ('SUPER_ADMIN', 'join-requests', true, false, true, false)
    """)


def downgrade() -> None:
    op.execute("DELETE FROM role_permissions WHERE screen = 'join-requests'")
    op.execute("ALTER TABLE manager_memberships DROP COLUMN IF EXISTS decision_note")
    op.execute("ALTER TABLE manager_memberships DROP COLUMN IF EXISTS decided_at")
    op.execute("ALTER TABLE manager_memberships DROP COLUMN IF EXISTS team_id")
    op.execute("DROP TABLE IF EXISTS teams")
