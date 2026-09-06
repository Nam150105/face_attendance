"""One active device session per member.

Extends the existing refresh_sessions table rather than introducing a parallel
session store: it already holds the hashed refresh token, expiry and revocation.
"""

from alembic import op


revision = "010_single_active_session"
down_revision = "009_member_self_service"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE refresh_sessions ADD COLUMN device_id TEXT")
    op.execute("ALTER TABLE refresh_sessions ADD COLUMN user_agent TEXT")
    op.execute("ALTER TABLE refresh_sessions ADD COLUMN revoked_reason TEXT")
    op.execute("ALTER TABLE refresh_sessions ADD COLUMN last_active_at TIMESTAMPTZ")
    # Which sessions take part in the single-device rule. Set from the account's
    # role at login, so widening the rule later needs no schema change.
    op.execute(
        "ALTER TABLE refresh_sessions ADD COLUMN enforce_single_session BOOLEAN NOT NULL DEFAULT false"
    )

    # The real guarantee against two concurrent logins: Postgres refuses the
    # second insert even if two requests interleave past the application check.
    op.execute(
        """
        CREATE UNIQUE INDEX idx_refresh_sessions_one_active_per_user
        ON refresh_sessions (user_id)
        WHERE revoked_at IS NULL AND enforce_single_session
        """
    )
    op.execute(
        "CREATE INDEX idx_refresh_sessions_active_lookup ON refresh_sessions (id) WHERE revoked_at IS NULL"
    )

    # Access tokens issued before this migration carry no session id and cannot
    # be checked against a session, so every existing session is closed. Users
    # log in again once; leaving them valid would keep the old hole open.
    op.execute(
        "UPDATE refresh_sessions SET revoked_at = now(), revoked_reason = 'SESSION_MODEL_UPGRADE' "
        "WHERE revoked_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_refresh_sessions_active_lookup")
    op.execute("DROP INDEX IF EXISTS idx_refresh_sessions_one_active_per_user")
    op.execute("ALTER TABLE refresh_sessions DROP COLUMN IF EXISTS enforce_single_session")
    op.execute("ALTER TABLE refresh_sessions DROP COLUMN IF EXISTS last_active_at")
    op.execute("ALTER TABLE refresh_sessions DROP COLUMN IF EXISTS revoked_reason")
    op.execute("ALTER TABLE refresh_sessions DROP COLUMN IF EXISTS user_agent")
    op.execute("ALTER TABLE refresh_sessions DROP COLUMN IF EXISTS device_id")
