"""Use standards-valid domains for local demo accounts."""

from alembic import op


revision = "004_fix_demo_email_domains"
down_revision = "003_refresh_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE users SET email = 'manager@example.com' WHERE email = 'manager@example.local'")
    op.execute("UPDATE users SET email = 'member@example.com' WHERE email = 'member@example.local'")


def downgrade() -> None:
    op.execute("UPDATE users SET email = 'manager@example.local' WHERE email = 'manager@example.com'")
    op.execute("UPDATE users SET email = 'member@example.local' WHERE email = 'member@example.com'")
