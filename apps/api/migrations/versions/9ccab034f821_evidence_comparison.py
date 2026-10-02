"""Evidence comparison, explicit shortlist approval, documents, and assessment history."""

import sqlalchemy as sa
from alembic import op

revision = "9ccab034f821"
down_revision = "87be21c9fa02"
branch_labels = depends_on = None


def upgrade():
    op.add_column("applications", sa.Column("original_document", sa.LargeBinary(), nullable=True))
    op.add_column("applications", sa.Column("screening", sa.JSON(), nullable=True))
    op.add_column(
        "applications",
        sa.Column("shortlisted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("applications", sa.Column("shortlist_approval", sa.JSON(), nullable=True))
    op.create_table(
        "assessment_history",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "application_id",
            sa.String(36),
            sa.ForeignKey("applications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
    )


def downgrade():
    op.drop_table("assessment_history")
    for name in ("shortlist_approval", "shortlisted", "screening", "original_document"):
        op.drop_column("applications", name)
