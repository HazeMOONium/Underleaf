"""add totp 2fa columns and backup codes table

Revision ID: 006
Revises: 005
Create Date: 2026-03-02
"""

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None

from alembic import op


def upgrade():
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR")
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS totp_backup_codes (
            id VARCHAR NOT NULL,
            user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code_hash VARCHAR NOT NULL,
            used BOOLEAN NOT NULL DEFAULT FALSE,
            PRIMARY KEY (id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_totp_backup_codes_user_id "
        "ON totp_backup_codes (user_id)"
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS totp_backup_codes")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS totp_secret")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS totp_enabled")
