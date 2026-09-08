"""Error codes an operator can look up, and the screen for looking them up.

Revision ID: 015_error_codes
Revises: 014_roles_evidence
"""

from alembic import op


revision = "015_error_codes"
down_revision = "014_roles_evidence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # When something breaks, the person in front of it should get a short code
    # to quote, not a stack trace and not a vague apology. The detail lives
    # here, where an administrator can find it by that code.
    op.execute("""
        CREATE TABLE error_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code TEXT NOT NULL UNIQUE,
            request_id TEXT,
            method TEXT,
            path TEXT,
            status_code INTEGER,
            kind TEXT,
            detail TEXT,
            traceback TEXT,
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            user_email TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX idx_error_events_recent ON error_events (created_at DESC)")

    op.execute("""
        INSERT INTO role_permissions (role, screen, can_view, can_create, can_edit, can_delete)
        VALUES ('MEMBER', 'admin-errors', false, false, false, false),
               ('MANAGER', 'admin-errors', false, false, false, false),
               ('SUPER_ADMIN', 'admin-errors', true, false, false, true)
    """)


def downgrade() -> None:
    op.execute("DELETE FROM role_permissions WHERE screen = 'admin-errors'")
    op.execute("DROP TABLE IF EXISTS error_events")
