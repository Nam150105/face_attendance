"""Places that belong to a unit, so joining it is enough to check in there.

Revision ID: 018_team_locations
Revises: 017_face_requests
"""

from alembic import op


revision = "018_team_locations"
down_revision = "017_face_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A place attached to a unit is a rule, not a batch action: whoever is in
    # the unit can check in there, including people approved tomorrow, and
    # leaving the unit takes the access with it. Individual assignments in
    # member_locations still work alongside it for one-off cases.
    op.execute("""
        CREATE TABLE team_locations (
            team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
            is_default BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (team_id, location_id)
        )
    """)
    op.execute("CREATE INDEX idx_team_locations_location ON team_locations (location_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS team_locations")
