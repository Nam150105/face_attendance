"""Create the initial face attendance schema."""

from alembic import op


revision = "001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute("CREATE TYPE user_role AS ENUM ('MANAGER', 'MEMBER')")
    op.execute("CREATE TYPE user_status AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION')")
    op.execute("CREATE TYPE membership_status AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED')")
    op.execute("CREATE TYPE attendance_event_type AS ENUM ('CHECK_IN', 'CHECK_OUT')")
    op.execute("CREATE TYPE attendance_status AS ENUM ('SUCCESS', 'WARNING_CONFIRMED', 'BLOCKED', 'FAILED')")

    op.execute("""
        CREATE TABLE users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email CITEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role user_role NOT NULL,
            status user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
            email_verified_at TIMESTAMPTZ,
            last_login_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE member_profiles (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL UNIQUE REFERENCES users(id),
            full_name TEXT NOT NULL,
            phone TEXT,
            birth_date DATE,
            employee_code TEXT,
            position TEXT,
            department TEXT,
            avatar_object_key TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE manager_memberships (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            manager_user_id UUID NOT NULL REFERENCES users(id),
            member_user_id UUID NOT NULL REFERENCES users(id),
            status membership_status NOT NULL DEFAULT 'INVITED',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (manager_user_id, member_user_id),
            CHECK (manager_user_id <> member_user_id)
        )
    """)
    op.execute("""
        CREATE TABLE locations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            address TEXT,
            latitude NUMERIC(10, 7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
            longitude NUMERIC(10, 7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
            allow_radius_meters INTEGER NOT NULL DEFAULT 100 CHECK (allow_radius_meters > 0),
            warning_radius_meters INTEGER NOT NULL DEFAULT 200 CHECK (warning_radius_meters > allow_radius_meters),
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE member_locations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            member_id UUID NOT NULL REFERENCES users(id),
            location_id UUID NOT NULL REFERENCES locations(id),
            is_default BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (member_id, location_id)
        )
    """)
    op.execute("""
        CREATE TABLE face_embeddings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            member_id UUID NOT NULL REFERENCES users(id),
            embedding vector NOT NULL,
            model_name TEXT NOT NULL,
            model_version TEXT NOT NULL,
            quality_score NUMERIC,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            revoked_at TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE TABLE attendance_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            member_id UUID NOT NULL REFERENCES users(id),
            location_id UUID NOT NULL REFERENCES locations(id),
            event_type attendance_event_type NOT NULL,
            status attendance_status NOT NULL,
            server_time TIMESTAMPTZ NOT NULL DEFAULT now(),
            latitude NUMERIC(10, 7) NOT NULL,
            longitude NUMERIC(10, 7) NOT NULL,
            gps_accuracy_meters NUMERIC NOT NULL,
            distance_meters NUMERIC NOT NULL,
            face_match_score NUMERIC,
            liveness_score NUMERIC,
            image_object_key TEXT,
            reason TEXT,
            idempotency_key TEXT UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE attendance_summary (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            member_id UUID NOT NULL REFERENCES users(id),
            work_date DATE NOT NULL,
            first_check_in TIMESTAMPTZ,
            last_check_out TIMESTAMPTZ,
            worked_minutes INTEGER,
            status TEXT,
            UNIQUE (member_id, work_date)
        )
    """)
    op.execute("""
        CREATE TABLE schedules (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            member_id UUID NOT NULL REFERENCES users(id),
            weekday SMALLINT CHECK (weekday BETWEEN 0 AND 6),
            work_date DATE,
            start_time TIME NOT NULL,
            end_time TIME NOT NULL,
            timezone TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT true,
            CHECK ((weekday IS NOT NULL) <> (work_date IS NOT NULL))
        )
    """)
    op.execute("""
        CREATE TABLE audit_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            actor_user_id UUID REFERENCES users(id),
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id UUID NOT NULL,
            before_json JSONB,
            after_json JSONB,
            reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            ip_address INET,
            user_agent TEXT
        )
    """)
    op.execute("CREATE INDEX idx_manager_memberships_manager_status ON manager_memberships(manager_user_id, status)")
    op.execute("CREATE INDEX idx_manager_memberships_member_status ON manager_memberships(member_user_id, status)")
    op.execute("CREATE INDEX idx_attendance_events_member_time ON attendance_events(member_id, server_time DESC)")
    op.execute("CREATE INDEX idx_attendance_events_location_time ON attendance_events(location_id, server_time DESC)")
    op.execute("CREATE INDEX idx_attendance_events_type_time ON attendance_events(event_type, server_time DESC)")
    op.execute("CREATE INDEX idx_audit_logs_entity_time ON audit_logs(entity_type, entity_id, created_at DESC)")


def downgrade() -> None:
    for table in (
        "audit_logs", "schedules", "attendance_summary", "attendance_events",
        "face_embeddings", "member_locations", "locations", "manager_memberships",
        "member_profiles", "users",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    for enum_name in ("attendance_status", "attendance_event_type", "membership_status", "user_status", "user_role"):
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
