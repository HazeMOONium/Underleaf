"""add engine to projects

Revision ID: 004
Revises: 003
Create Date: 2026-02-25
"""
from alembic import op
import sqlalchemy as sa

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('projects', sa.Column('engine', sa.String(), nullable=False, server_default='pdflatex'))


def downgrade():
    op.drop_column('projects', 'engine')
