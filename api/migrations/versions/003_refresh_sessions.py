"""Add server-side refresh session tracking."""

from alembic import op


revision = "003_refresh_sessions"
down_revision = "002_seed_local_demo"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE refresh_sessions (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_used_at TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX idx_refresh_sessions_user ON refresh_sessions(user_id, revoked_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS refresh_sessions")
