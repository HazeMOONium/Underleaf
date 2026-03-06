"""add artifact_hash to compile_jobs

Revision ID: 009
Revises: 008
Create Date: 2026-03-05
"""

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None

from alembic import op


def upgrade():
    op.execute(
        "ALTER TABLE compile_jobs ADD COLUMN IF NOT EXISTS artifact_hash VARCHAR"
    )


def downgrade():
    op.execute("ALTER TABLE compile_jobs DROP COLUMN IF EXISTS artifact_hash")
