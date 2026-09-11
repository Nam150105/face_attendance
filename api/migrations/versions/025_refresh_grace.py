"""Hai thẻ trình duyệt cùng làm mới một phiên không được đá nhau ra.

Revision ID: 025_refresh_grace
Revises: 024_no_invented
"""

from alembic import op


revision = "025_refresh_grace"
down_revision = "024_no_invented"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A refresh rotates the secret. When two requests refresh at once — two
    # tabs, or one page firing five calls the moment the access token lapsed —
    # the second arrives with the secret the first just retired and was
    # refused as if it were an attacker replaying a stolen token. The retired
    # secret is now remembered for a short grace window so that race is not a
    # logout.
    op.execute("ALTER TABLE refresh_sessions ADD COLUMN previous_token_hash TEXT")
    op.execute("ALTER TABLE refresh_sessions ADD COLUMN rotated_at TIMESTAMPTZ")
    op.execute(
        "CREATE INDEX idx_refresh_sessions_previous ON refresh_sessions (previous_token_hash)"
        " WHERE previous_token_hash IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_refresh_sessions_previous")
    op.execute("ALTER TABLE refresh_sessions DROP COLUMN IF EXISTS rotated_at")
    op.execute("ALTER TABLE refresh_sessions DROP COLUMN IF EXISTS previous_token_hash")
