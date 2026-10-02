"""Persist automatic screening rules; retain historical approval provenance."""

import sqlalchemy as sa
from alembic import op

revision = "a51b793cd402"
down_revision = "9ccab034f821"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("jobs", sa.Column("screening_policy", sa.JSON(), nullable=True))
    op.add_column(
        "jobs", sa.Column("policy_version", sa.Integer(), nullable=False, server_default="1")
    )
    # Backfill summaries without changing original assessments, documents, or review history.
    jobs = sa.table(
        "jobs",
        sa.column("id", sa.String),
        sa.column("requirements", sa.JSON),
        sa.column("interpretation", sa.JSON),
    )
    applications = sa.table(
        "applications",
        sa.column("id", sa.String),
        sa.column("job_id", sa.String),
        sa.column("assessment", sa.JSON),
        sa.column("screening", sa.JSON),
    )
    connection = op.get_bind()
    for job in connection.execute(sa.select(jobs)).mappings():
        requirements = job["requirements"]
        interpretation = job["interpretation"] or {}
        validation = interpretation.get("validation", {})
        edits = interpretation.get("edited_criteria", [])
        for requirement in requirements:
            requirement["source_validation"] = (
                validation.get(requirement["id"], "REVIEW")
                if interpretation and requirement["id"] not in edits
                else "EMPLOYER_AUTHORED"
            )
        connection.execute(
            jobs.update().where(jobs.c.id == job["id"]).values(requirements=requirements)
        )
        for row in connection.execute(
            sa.select(applications).where(applications.c.job_id == job["id"])
        ).mappings():
            if row["screening"] is None:
                continue
            summary = dict(row["screening"])
            summary["is_sample"] = bool((row["assessment"] or {}).get("is_sample", False))
            for requirement in requirements:
                if requirement["source_validation"] != "REVIEW":
                    continue
                key = requirement["id"]
                prior = summary["findings"].get(key, "UNCLEAR")
                if prior != "UNCLEAR":
                    group = summary[requirement.get("priority", "UNSPECIFIED")]
                    group[prior.lower()] -= 1
                    group["unclear"] += 1
                    summary["unresolved"] += 1
                summary["findings"][key] = "UNCLEAR"
            summary["required_complete"] = summary["REQUIRED"]["total"] > 0 and (
                summary["REQUIRED"]["total"] == summary["REQUIRED"]["supported"]
            )
            connection.execute(
                applications.update()
                .where(applications.c.id == row["id"])
                .values(screening=summary)
            )


def downgrade():
    op.drop_column("jobs", "policy_version")
    op.drop_column("jobs", "screening_policy")
