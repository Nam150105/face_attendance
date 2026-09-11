"""Lượt ra do máy tự bịa được ghi đúng bản chất của nó.

Revision ID: 024_no_invented
Revises: 023_drop_verdicts
"""

from alembic import op


revision = "024_no_invented"
down_revision = "023_drop_verdicts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The old auto-close wrote a CHECK_OUT at latitude 0, longitude 0, status
    # SUCCESS, source DEVICE — a departure at sea that nobody made. The code
    # that wrote them is gone; the rows it left are relabelled so they can no
    # longer be mistaken for a measurement. They are soft-deleted rather than
    # removed: the day they "closed" is now honestly "chưa chấm ra", and a
    # manager can still see what the system once did.
    op.execute("""
        UPDATE attendance_events
        SET source = 'MANUAL',
            latitude = NULL, longitude = NULL,
            gps_accuracy_meters = NULL, distance_meters = NULL,
            deleted_at = COALESCE(deleted_at, now()),
            delete_reason = COALESCE(delete_reason,
                'Lượt ra do hệ thống cũ tự sinh sau 24 giờ; quy tắc mới không bịa lượt ra')
        WHERE idempotency_key LIKE 'auto-checkout-%'
    """)


def downgrade() -> None:
    pass
