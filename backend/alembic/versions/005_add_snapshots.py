"""add snapshots

Revision ID: 005
Revises: 004
Create Date: 2026-03-02
"""
from alembic import op

revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE snapshots (
            id VARCHAR NOT NULL,
            project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            compile_job_id VARCHAR NOT NULL REFERENCES compile_jobs(id) ON DELETE CASCADE,
            label VARCHAR,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            PRIMARY KEY (id),
            CONSTRAINT uq_snapshot_compile_job UNIQUE (compile_job_id)
        )
    """)
    op.execute(
        "CREATE INDEX ix_snapshots_project_created ON snapshots (project_id, created_at DESC)"
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS snapshots")
