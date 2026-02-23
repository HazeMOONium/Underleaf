"""Add RBAC: ProjectRole enum, update permissions, add project_invites and comments tables

Revision ID: 002
Revises: 001
Create Date: 2026-02-23
"""
from typing import Union
from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drive the whole migration with raw SQL so SQLAlchemy never auto-creates
    # the enum type behind our back.

    # 1. Create the projectrole enum type
    op.execute("CREATE TYPE projectrole AS ENUM ('owner', 'editor', 'commenter', 'viewer')")

    # 2. Add temp column + copy data + drop old + rename
    op.execute("ALTER TABLE permissions ADD COLUMN role_new projectrole")
    op.execute(
        "UPDATE permissions SET role_new = "
        "CASE role "
        "  WHEN 'owner'     THEN 'owner'::projectrole "
        "  WHEN 'editor'    THEN 'editor'::projectrole "
        "  WHEN 'commenter' THEN 'commenter'::projectrole "
        "  ELSE 'viewer'::projectrole "
        "END"
    )
    op.execute("ALTER TABLE permissions ALTER COLUMN role_new SET NOT NULL")
    op.execute("ALTER TABLE permissions DROP COLUMN role")
    op.execute("ALTER TABLE permissions RENAME COLUMN role_new TO role")

    # 3. Add new audit columns to permissions
    op.execute(
        "ALTER TABLE permissions "
        "ADD COLUMN granted_at TIMESTAMP NOT NULL DEFAULT NOW(), "
        "ADD COLUMN granted_by VARCHAR REFERENCES users(id)"
    )

    # 4. Create project_invites table
    op.execute("""
        CREATE TABLE project_invites (
            id          VARCHAR PRIMARY KEY,
            project_id  VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            token       VARCHAR NOT NULL UNIQUE,
            role        projectrole NOT NULL,
            created_by  VARCHAR NOT NULL REFERENCES users(id),
            expires_at  TIMESTAMP,
            use_count   INTEGER NOT NULL DEFAULT 0,
            max_uses    INTEGER,
            created_at  TIMESTAMP NOT NULL
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX ix_project_invites_token ON project_invites (token)"
    )

    # 5. Create comments table
    op.execute("""
        CREATE TABLE comments (
            id          VARCHAR PRIMARY KEY,
            project_id  VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            file_path   VARCHAR NOT NULL,
            line        INTEGER NOT NULL,
            author_id   VARCHAR NOT NULL REFERENCES users(id),
            content     TEXT NOT NULL,
            parent_id   VARCHAR REFERENCES comments(id) ON DELETE CASCADE,
            created_at  TIMESTAMP NOT NULL,
            resolved_at TIMESTAMP
        )
    """)
    op.execute(
        "CREATE INDEX ix_comments_project_file_line "
        "ON comments (project_id, file_path, line)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_comments_project_file_line")
    op.execute("DROP TABLE IF EXISTS comments")
    op.execute("DROP INDEX IF EXISTS ix_project_invites_token")
    op.execute("DROP TABLE IF EXISTS project_invites")
    op.execute("ALTER TABLE permissions DROP COLUMN IF EXISTS granted_by")
    op.execute("ALTER TABLE permissions DROP COLUMN IF EXISTS granted_at")
    # Revert role column back to VARCHAR
    op.execute("ALTER TABLE permissions ADD COLUMN role_str VARCHAR")
    op.execute("UPDATE permissions SET role_str = role::text")
    op.execute("ALTER TABLE permissions DROP COLUMN role")
    op.execute("ALTER TABLE permissions RENAME COLUMN role_str TO role")
    op.execute("DROP TYPE IF EXISTS projectrole")
