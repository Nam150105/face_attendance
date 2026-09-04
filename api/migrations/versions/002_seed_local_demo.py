"""Seed deterministic local demo records; never use this migration in production."""

from alembic import op


revision = "002_seed_local_demo"
down_revision = "001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO users (id, email, password_hash, role, status, email_verified_at)
        VALUES
            ('00000000-0000-0000-0000-000000000001', 'manager@example.local', crypt('ChangeMe123!', gen_salt('bf')), 'MANAGER', 'ACTIVE', now()),
            ('00000000-0000-0000-0000-000000000002', 'member@example.local', crypt('ChangeMe123!', gen_salt('bf')), 'MEMBER', 'ACTIVE', now())
        ON CONFLICT (email) DO NOTHING
    """)
    op.execute("""
        INSERT INTO member_profiles (user_id, full_name, employee_code, department)
        VALUES ('00000000-0000-0000-0000-000000000002', 'Demo Member', 'DEMO-001', 'Demo')
        ON CONFLICT (user_id) DO NOTHING
    """)
    op.execute("""
        INSERT INTO manager_memberships (manager_user_id, member_user_id, status)
        VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'ACTIVE')
        ON CONFLICT (manager_user_id, member_user_id) DO NOTHING
    """)
    op.execute("""
        INSERT INTO locations (id, name, address, latitude, longitude)
        VALUES ('00000000-0000-0000-0000-000000000010', 'Demo Office', 'Local development', 10.7768890, 106.7008060)
        ON CONFLICT (id) DO NOTHING
    """)
    op.execute("""
        INSERT INTO member_locations (member_id, location_id, is_default)
        VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010', true)
        ON CONFLICT (member_id, location_id) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM member_locations WHERE member_id = '00000000-0000-0000-0000-000000000002'")
    op.execute("DELETE FROM locations WHERE id = '00000000-0000-0000-0000-000000000010'")
    op.execute("DELETE FROM manager_memberships WHERE manager_user_id = '00000000-0000-0000-0000-000000000001'")
    op.execute("DELETE FROM member_profiles WHERE user_id = '00000000-0000-0000-0000-000000000002'")
    op.execute("DELETE FROM users WHERE id IN ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')")
