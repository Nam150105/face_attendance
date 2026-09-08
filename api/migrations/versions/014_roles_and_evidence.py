"""Screen permissions, login history and the enrolment photo.

Revision ID: 014_roles_evidence
Revises: 013_super_admin
"""

from alembic import op


revision = "014_roles_evidence"
down_revision = "013_super_admin"
branch_labels = None
depends_on = None


# (screen, MEMBER, MANAGER, SUPER_ADMIN) — each value is the set of actions the
# role gets by default. "v" view, "c" create, "e" edit, "d" delete; "" is no
# access at all, "vced" is everything.
#
# A member's own screens are read-only through this table: filing a correction
# or checking in is something you do to your own record, not an authority over
# other people, so those endpoints are not permission-gated.
DEFAULT_PERMISSIONS = [
    ("home", "v", "v", "v"),
    ("attendance", "v", "v", "v"),
    ("history", "v", "v", "v"),
    ("my-locations", "v", "v", "v"),
    ("my-corrections", "v", "v", "v"),
    ("notifications", "v", "v", "v"),
    ("profile", "v", "v", "v"),
    ("team-overview", "", "v", "v"),
    ("records", "", "ved", "vced"),
    ("members", "", "vced", "vced"),
    ("locations", "", "vced", "vced"),
    ("corrections", "", "ve", "vced"),
    ("audit", "", "v", "v"),
    ("admin-overview", "", "", "v"),
    ("admin-users", "", "", "vced"),
    ("admin-records", "", "", "vced"),
    ("admin-roles", "", "", "ve"),
    ("admin-data", "", "", "vced"),
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

    # What a role may do on each screen. Opening a screen and changing what is on
    # it are different authorities: a supervisor who should read the records is
    # not automatically someone who may delete them.
    op.execute("""
        CREATE TABLE role_permissions (
            role user_role NOT NULL,
            screen TEXT NOT NULL,
            can_view BOOLEAN NOT NULL DEFAULT false,
            can_create BOOLEAN NOT NULL DEFAULT false,
            can_edit BOOLEAN NOT NULL DEFAULT false,
            can_delete BOOLEAN NOT NULL DEFAULT false,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by UUID REFERENCES users(id),
            PRIMARY KEY (role, screen),
            -- Creating or deleting something you cannot even see is not a
            -- permission, it is a mistake waiting to be found in an audit log.
            CONSTRAINT role_permissions_view_first
                CHECK (can_view OR NOT (can_create OR can_edit OR can_delete))
        )
    """)
    for screen, member, manager, admin in DEFAULT_PERMISSIONS:
        for role, actions in (("MEMBER", member), ("MANAGER", manager), ("SUPER_ADMIN", admin)):
            values = ", ".join(
                str(letter in actions).lower() for letter in ("v", "c", "e", "d")
            )
            op.execute(
                "INSERT INTO role_permissions (role, screen, can_view, can_create, can_edit, can_delete)"
                f" VALUES ('{role}', '{screen}', {values})"
            )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS role_permissions")
    op.execute("DROP TABLE IF EXISTS login_attempts")
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS face_engine")
    op.execute("ALTER TABLE attendance_events DROP COLUMN IF EXISTS face_distance")
    op.execute("ALTER TABLE face_embeddings DROP COLUMN IF EXISTS image_object_key")
