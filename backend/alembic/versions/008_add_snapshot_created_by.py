"""add created_by to snapshots

Revision ID: 008
Revises: 007
Create Date: 2026-03-05
"""

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None

from alembic import op


def upgrade():
    op.execute(
        "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS created_by VARCHAR "
        "REFERENCES users(id)"
    )


def downgrade():
    op.execute("ALTER TABLE snapshots DROP COLUMN IF EXISTS created_by")
