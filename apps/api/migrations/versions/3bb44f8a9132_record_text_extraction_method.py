"""Record native/OCR text provenance for reviewer verification."""

import sqlalchemy as sa
from alembic import op

revision = "3bb44f8a9132"
down_revision = "674a2ecd97fa"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "applications", sa.Column("extraction_method", sa.String(length=8), nullable=True)
    )


def downgrade():
    op.drop_column("applications", "extraction_method")
