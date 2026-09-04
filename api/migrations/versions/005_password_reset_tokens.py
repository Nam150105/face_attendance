"""Add one-time password reset token storage."""

from alembic import op


revision = "005_password_reset_tokens"
down_revision = "004_fix_demo_email_domains"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE password_reset_tokens (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            used_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id, used_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS password_reset_tokens")
