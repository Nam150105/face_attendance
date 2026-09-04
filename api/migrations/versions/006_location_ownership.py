"""Add Manager ownership to locations."""

from alembic import op


revision = "006_location_ownership"
down_revision = "005_password_reset_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE locations ADD COLUMN manager_user_id UUID REFERENCES users(id)")
    op.execute("""
        UPDATE locations
        SET manager_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = '00000000-0000-0000-0000-000000000010'
    """)
    op.execute("CREATE INDEX idx_locations_manager_active ON locations(manager_user_id, is_active)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_locations_manager_active")
    op.execute("ALTER TABLE locations DROP COLUMN IF EXISTS manager_user_id")
