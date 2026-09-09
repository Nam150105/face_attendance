"""Changing a registered face needs somebody else's agreement.

Revision ID: 017_face_requests
Revises: 016_team_codes
"""

from alembic import op


revision = "017_face_requests"
down_revision = "016_team_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A face already on file is what every check-in is judged against. Letting
    # the same account quietly replace it means the check proves nothing: swap
    # the reference and anybody's face passes. So a replacement waits here,
    # with both photos kept, until a manager compares them and agrees.
    op.execute("""
        CREATE TABLE face_change_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            member_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            embedding vector NOT NULL,
            model_name TEXT NOT NULL,
            model_version TEXT,
            image_object_key TEXT,
            quality_score NUMERIC,
            reason TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING',
            decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
            decided_at TIMESTAMPTZ,
            decision_note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX idx_face_requests_member ON face_change_requests (member_id, created_at DESC)")
    # One open request at a time: a queue of replacements from one person is a
    # queue of chances for the wrong one to be approved.
    op.execute(
        "CREATE UNIQUE INDEX idx_face_requests_one_open ON face_change_requests (member_id)"
        " WHERE status = 'PENDING'"
    )

    op.execute("""
        INSERT INTO role_permissions (role, screen, can_view, can_create, can_edit, can_delete)
        VALUES ('MEMBER', 'face-requests', false, false, false, false),
               ('MANAGER', 'face-requests', true, false, true, false),
               ('SUPER_ADMIN', 'face-requests', true, false, true, false)
    """)


def downgrade() -> None:
    op.execute("DELETE FROM role_permissions WHERE screen = 'face-requests'")
    op.execute("DROP TABLE IF EXISTS face_change_requests")
