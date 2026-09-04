"""Add short-lived server-side face enrollment challenges."""

from alembic import op


revision = "007_face_enrollment_challenges"
down_revision = "006_location_ownership"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE face_enrollment_challenges (
            id UUID PRIMARY KEY,
            member_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            challenge_hash TEXT NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            consumed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX idx_face_enrollment_challenges_member ON face_enrollment_challenges(member_id, consumed_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS face_enrollment_challenges")
