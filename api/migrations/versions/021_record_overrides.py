"""Người quản lý sửa được bản ghi, nhưng số máy đo vẫn còn nguyên.

Revision ID: 021_record_overrides
Revises: 020_session_policy
"""

from alembic import op


revision = "021_record_overrides"
down_revision = "020_session_policy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A manager needs to be able to say "the GPS was wrong, they were here" or
    # "that is them, the light was bad". What they must never do is overwrite
    # what the machine measured: face_match_score, face_distance and
    # distance_meters are evidence, and a corrected record that quietly carries
    # an invented score is worse than no correction at all.
    #
    # So the human verdict is stored beside the measurement, never on top of it.
    # NULL means "no override, read the machine's answer".
    op.execute("ALTER TABLE attendance_events ADD COLUMN face_verdict_override BOOLEAN")
    op.execute("ALTER TABLE attendance_events ADD COLUMN location_verdict_override BOOLEAN")

    # The time can be corrected outright — it is a clock reading, not a
    # measurement of the person — but the original is kept the first time it
    # changes, so "what did the device actually report" stays answerable.
    op.execute("ALTER TABLE attendance_events ADD COLUMN original_server_time TIMESTAMPTZ")

    op.execute("ALTER TABLE attendance_events ADD COLUMN edited_at TIMESTAMPTZ")
    op.execute(
        "ALTER TABLE attendance_events ADD COLUMN edited_by UUID REFERENCES users(id) ON DELETE SET NULL"
    )
    op.execute("ALTER TABLE attendance_events ADD COLUMN edit_reason TEXT")


def downgrade() -> None:
    for column in (
        "edit_reason",
        "edited_by",
        "edited_at",
        "original_server_time",
        "location_verdict_override",
        "face_verdict_override",
    ):
        op.execute(f"ALTER TABLE attendance_events DROP COLUMN IF EXISTS {column}")
