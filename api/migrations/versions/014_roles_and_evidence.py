"""Screen permissions, login history and the enrolment photo.

Revision ID: 014_roles_evidence
Revises: 013_super_admin
"""

from alembic import op


revision = "014_roles_evidence"
down_revision = "013_super_admin"
branch_labels = None
depends_on = None


# (screen, MEMBER, MANAGER, SUPER_ADMIN)
DEFAULT_PERMISSIONS = [
    ("home", True, True, True),
    ("attendance", True, True, True),
    ("history", True, True, True),
    ("my-locations", True, True, True),
    ("my-corrections", True, True, True),
    ("notifications", True, True, True),
    ("profile", True, True, True),
    ("team-overview", False, True, True),
    ("records", False, True, True),
    ("members", False, True, True),
    ("locations", False, True, True),
    ("corrections", False, True, True),
    ("audit", False, True, True),
    ("admin-overview", False, False, True),
    ("admin-users", False, False, True),
    ("admin-records", False, False, True),
    ("admin-roles", False, False, True),
    ("admin-data", False, False, True),
]


def upgrade() -> None:
    # The photo the embedding was built from. Kept so a manager can put the
    # enrolment face next to the face that turned up, instead of trusting a
    # number they cannot check.
    op.execute("ALTER TABLE face_embeddings ADD COLUMN image_object_key TEXT")

    # What the recognition run actually produced. face_match_score alone cannot
    # be read without knowing which engine and metric produced it: 0.42 is a
    # good ArcFace cosine similarity and a poor dlib distance.
    op.execute("ALTER TABLE attendance_events ADD COLUMN face_distance NUMERIC")
    op.execute("ALTER TABLE attendance_events ADD COLUMN face_engine TEXT")

    # Sign-in history. Rate limiting lives in Redis and forgets everything, so
    # until now nobody could answer "who kept failing to get in, and when".
    op.execute("""
        CREATE TABLE login_attempts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email TEXT NOT NULL,
            user_id UUID REFERENCES users(id),
            outcome TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX idx_login_attempts_user ON login_attempts (user_id, created_at DESC)")
    op.execute("CREATE INDEX idx_login_attempts_email ON login_attempts (email, created_at DESC)")

    # Which screens a role may open. A row here grants the screen; what the
    # screen then shows is still cut to the viewer's own scope by each service.
    op.execute("""
        CREATE TABLE role_permissions (
            role user_role NOT NULL,
            screen TEXT NOT NULL,
            can_view BOOLEAN NOT NULL DEFAULT false,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by UUID REFERENCES users(id),
            PRIMARY KEY (role, screen)
        )
    """)
    for screen, member, manager, admin in DEFAULT_PERMISSIONS:
        for role, allowed in (("MEMBER", member), ("MANAGER", manager), ("SUPER_ADMIN", admin)):
            op.execute(
                "INSERT INTO role_permissions (role, screen, can_view) VALUES "
                f"('{role}', '{screen}', {str(allowed).lower()})"
            )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS role_permissions")
    op.execute("DROP TABLE IF EXISTS login_attempts")
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS face_engine")
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS face_distance")
    op.execute("ALTER TABLE face_embeddings DROP COLUMN IF EXISTS image_object_key")
