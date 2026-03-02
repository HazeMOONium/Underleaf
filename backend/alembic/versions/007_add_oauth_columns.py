"""add oauth provider columns to users

Revision ID: 007
Revises: 006
Create Date: 2026-03-02
"""

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None

from alembic import op


def upgrade():
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider_id VARCHAR")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_users_oauth "
        "ON users (oauth_provider, oauth_provider_id)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_users_oauth")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS oauth_provider")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS oauth_provider_id")
