"""Persist source descriptions and immutable interpretation snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "87be21c9fa02"
down_revision = "3bb44f8a9132"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("jobs", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("jobs", sa.Column("interpretation", sa.JSON(), nullable=True))
    op.create_table(
        "job_interpretations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("cache_key", sa.String(64), nullable=False, unique=True),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
    )


def downgrade():
    op.drop_table("job_interpretations")
    op.drop_column("jobs", "interpretation")
    op.drop_column("jobs", "description")
