"""Add email_verified column to users table

Revision ID: 003
Revises: 002
Create Date: 2026-02-24

Rationale: Tracks whether a user has confirmed their email address.
Defaults to FALSE for all existing and new users. The verification flow
stores a single-use token in Redis (24h TTL) and sets this flag to TRUE
when the user follows the link. Unverified users can still authenticate
but the frontend shows a persistent reminder banner.
"""
from typing import Union
from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default='false' is required so PostgreSQL can backfill all
    # existing rows without a NOT NULL violation during the migration.
    op.add_column(
        "users",
        sa.Column(
            "email_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "email_verified")
