"""Persistent intake and a leased work queue. One transaction accepts each delivery."""

import hashlib
import json
import time
from pathlib import Path
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    and_,
    create_engine,
    delete,
    event,
    func,
    insert,
    or_,
    select,
    update,
)
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

metadata = MetaData()
jobs = Table(
    "jobs",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("title", String(100), nullable=False),
    Column("requirements", JSON, nullable=False),
    Column("created_at", Float, nullable=False),
)
batches = Table(
    "batches",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("job_id", ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
    Column("expected", Integer, nullable=False),
    Column("created_at", Float, nullable=False),
)
applications = Table(
    "applications",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("job_id", ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
    Column("name", String(100), nullable=False),
    Column("filename", String(255), nullable=False),
    Column("source", String(80), nullable=False),
    Column("external_id", String(200)),
    Column("dedupe_key", String(64), nullable=False),
    Column("fingerprint", String(64), nullable=False),
    Column("payload", LargeBinary),
    Column("text", Text),
    Column("extraction_method", String(8)),
    Column("assessment", JSON),
    Column("overrides", JSON, nullable=False),
    Column("notes", Text, nullable=False),
    Column("reviewed", Boolean, nullable=False),
    Column("status", String(24), nullable=False),
    Column("error", Text),
    Column("attempts", Integer, nullable=False),
    Column("next_attempt", Float, nullable=False),
    Column("lease_token", String(36)),
    Column("lease_until", Float),
    Column("version", Integer, nullable=False),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
    UniqueConstraint("job_id", "dedupe_key", name="uq_application_delivery"),
)
Index("ix_application_queue", applications.c.status, applications.c.next_attempt)
Index("ix_application_job", applications.c.job_id, applications.c.created_at)
receipts = Table(
    "receipts",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("batch_id", ForeignKey("batches.id", ondelete="CASCADE"), nullable=False),
    Column("application_id", ForeignKey("applications.id", ondelete="CASCADE"), nullable=False),
    Column("fingerprint", String(64), nullable=False),
    Column("duplicate", Boolean, nullable=False),
)
workers = Table(
    "workers",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("heartbeat", Float, nullable=False),
)


class IntakeConflict(ValueError):
    pass


class Store:
    def __init__(self, url: str):
        parsed = make_url(url)
        if parsed.drivername.startswith("sqlite") and parsed.database not in {None, ":memory:"}:
            Path(parsed.database).parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(url, pool_pre_ping=True)
        if self.engine.dialect.name == "sqlite":

            @event.listens_for(self.engine, "connect")
            def configure_sqlite(connection, _record):
                connection.execute("PRAGMA foreign_keys=ON")
                connection.execute("PRAGMA busy_timeout=10000")
                connection.execute("PRAGMA journal_mode=WAL")

    def create_job(self, title: str, requirements: list[dict]) -> dict:
        row = {
            "id": str(uuid4()),
            "title": title,
            "requirements": requirements,
            "created_at": time.time(),
        }
        with self.engine.begin() as connection:
            connection.execute(insert(jobs).values(**row))
        return row

    def list_jobs(self) -> list[dict]:
        with self.engine.connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    select(jobs).order_by(jobs.c.created_at.desc())
                ).mappings()
            ]

    def job(self, job_id: str) -> dict:
        with self.engine.connect() as connection:
            row = connection.execute(select(jobs).where(jobs.c.id == job_id)).mappings().first()
        if row is None:
            raise KeyError("Job not found.")
        return dict(row)

    def create_batch(self, job_id: str, expected: int) -> dict:
        self.job(job_id)
        row = {
            "id": str(uuid4()),
            "job_id": job_id,
            "expected": expected,
            "created_at": time.time(),
        }
        with self.engine.begin() as connection:
            connection.execute(insert(batches).values(**row))
        return row

    def accept(
        self,
        job_id: str,
        name: str,
        filename: str,
        *,
        payload: bytes | None = None,
        text: str | None = None,
        source: str = "bulk_upload",
        external_id: str | None = None,
        batch_id: str | None = None,
        receipt_id: str | None = None,
    ) -> dict:
        self.job(job_id)
        fingerprint = hashlib.sha256(payload if payload is not None else text.encode()).hexdigest()
        identity = [source, external_id] if external_id else ["document", fingerprint]
        dedupe = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
        # A unique constraint resolves concurrent/repeated delivery races, not a read-before-write.
        for attempt in range(3):
            try:
                with self.engine.begin() as connection:
                    if batch_id:
                        batch = (
                            connection.execute(
                                select(batches).where(
                                    batches.c.id == batch_id, batches.c.job_id == job_id
                                )
                            )
                            .mappings()
                            .first()
                        )
                        if not batch or not receipt_id:
                            raise IntakeConflict("Batch or delivery receipt is invalid.")
                        prior = (
                            connection.execute(select(receipts).where(receipts.c.id == receipt_id))
                            .mappings()
                            .first()
                        )
                        if prior:
                            if prior["batch_id"] != batch_id or prior["fingerprint"] != fingerprint:
                                raise IntakeConflict(
                                    "Delivery receipt was reused with different data."
                                )
                            return {"id": prior["application_id"], "duplicate": prior["duplicate"]}
                    existing = (
                        connection.execute(
                            select(applications).where(
                                applications.c.job_id == job_id, applications.c.dedupe_key == dedupe
                            )
                        )
                        .mappings()
                        .first()
                    )
                    duplicate = existing is not None
                    if duplicate:
                        if existing["fingerprint"] != fingerprint:
                            raise IntakeConflict(
                                "This external ID already contains different resume data."
                            )
                        application_id = existing["id"]
                    else:
                        application_id = str(uuid4())
                        now = time.time()
                        connection.execute(
                            insert(applications).values(
                                id=application_id,
                                job_id=job_id,
                                name=name,
                                filename=filename,
                                source=source,
                                external_id=external_id,
                                dedupe_key=dedupe,
                                fingerprint=fingerprint,
                                payload=payload,
                                text=text,
                                assessment=None,
                                overrides={},
                                notes="",
                                reviewed=False,
                                status="QUEUED",
                                error=None,
                                attempts=0,
                                next_attempt=0,
                                lease_token=None,
                                lease_until=None,
                                version=1,
                                created_at=now,
                                updated_at=now,
                            )
                        )
                    if batch_id:
                        connection.execute(
                            insert(receipts).values(
                                id=receipt_id,
                                batch_id=batch_id,
                                application_id=application_id,
                                fingerprint=fingerprint,
                                duplicate=duplicate,
                            )
                        )
                    return {"id": application_id, "duplicate": duplicate}
            except IntegrityError:
                if attempt == 2:
                    raise
        raise RuntimeError("Could not accept delivery.")

    def summary(self, job_id: str) -> dict:
        self.job(job_id)
        with self.engine.connect() as connection:
            counts = dict(
                connection.execute(
                    select(applications.c.status, func.count())
                    .where(applications.c.job_id == job_id)
                    .group_by(applications.c.status)
                ).all()
            )
            reviewed = connection.scalar(
                select(func.count())
                .select_from(applications)
                .where(applications.c.job_id == job_id, applications.c.reviewed.is_(True))
            )
            imports = []
            for batch in connection.execute(
                select(batches)
                .where(batches.c.job_id == job_id)
                .order_by(batches.c.created_at.desc())
                .limit(5)
            ).mappings():
                received, duplicates = connection.execute(
                    select(
                        func.count(),
                        func.coalesce(func.sum(func.cast(receipts.c.duplicate, Integer)), 0),
                    )
                    .select_from(receipts)
                    .where(receipts.c.batch_id == batch["id"])
                ).one()
                imports.append({**dict(batch), "received": received, "duplicates": duplicates})
        return {
            "total": sum(counts.values()),
            "reviewed": reviewed,
            "statuses": counts,
            "batches": imports,
        }

    def list_applications(
        self, job_id: str, *, page: int = 1, search: str = "", status: str = "", limit: int = 50
    ) -> dict:
        self.job(job_id)
        where = [applications.c.job_id == job_id]
        if search:
            where.append(func.lower(applications.c.name).contains(search.lower(), autoescape=True))
        if status == "REVIEWED":
            where.append(applications.c.reviewed.is_(True))
        elif status:
            where.append(applications.c.status == status)
        columns = [
            applications.c[key]
            for key in (
                "id",
                "name",
                "filename",
                "source",
                "external_id",
                "status",
                "reviewed",
                "error",
                "created_at",
                "updated_at",
                "version",
            )
        ]
        with self.engine.connect() as connection:
            total = connection.scalar(select(func.count()).select_from(applications).where(*where))
            rows = (
                connection.execute(
                    select(*columns)
                    .where(*where)
                    .order_by(applications.c.created_at.desc(), applications.c.id)
                    .offset((page - 1) * limit)
                    .limit(limit)
                )
                .mappings()
                .all()
            )
        return {"items": [dict(row) for row in rows], "total": total, "page": page, "limit": limit}

    def application(self, application_id: str) -> dict:
        with self.engine.connect() as connection:
            row = (
                connection.execute(select(applications).where(applications.c.id == application_id))
                .mappings()
                .first()
            )
        if row is None:
            raise KeyError("Application not found.")
        data = dict(row)
        for key in ("payload", "dedupe_key", "fingerprint", "lease_token", "lease_until"):
            data.pop(key)
        return data

    def save_review(
        self, application_id: str, version: int, notes: str, reviewed: bool, overrides: dict
    ) -> dict:
        application = self.application(application_id)
        known_ids = {r["id"] for r in self.job(application["job_id"])["requirements"]}
        if not set(overrides) <= known_ids:
            raise IntakeConflict("Correction refers to an unknown role requirement.")
        if overrides and not application["assessment"]:
            raise IntakeConflict("There is no assessment to correct.")
        with self.engine.begin() as connection:
            result = connection.execute(
                update(applications)
                .where(applications.c.id == application_id, applications.c.version == version)
                .values(
                    notes=notes,
                    reviewed=reviewed,
                    overrides=overrides,
                    updated_at=time.time(),
                    version=applications.c.version + 1,
                )
            )
            if result.rowcount != 1:
                raise IntakeConflict(
                    "This application changed. Reload it before saving your review."
                )
        return self.application(application_id)

    def retry(self, job_id: str, application_id: str | None = None) -> int:
        self.job(job_id)
        where = [
            applications.c.job_id == job_id,
            applications.c.status.in_(["FAILED", "RETRY_WAIT", "AWAITING_PROVIDER"]),
        ]
        if application_id:
            where.append(applications.c.id == application_id)
        with self.engine.begin() as connection:
            return connection.execute(
                update(applications)
                .where(*where)
                .values(
                    status="QUEUED",
                    error=None,
                    attempts=0,
                    next_attempt=0,
                    updated_at=time.time(),
                    version=applications.c.version + 1,
                )
            ).rowcount

    def claim(self, provider_available: bool, lease_seconds: int) -> dict | None:
        now, token = time.time(), str(uuid4())
        statuses = ["QUEUED", "RETRY_WAIT"] + (["AWAITING_PROVIDER"] if provider_available else [])
        eligible = or_(
            and_(applications.c.status.in_(statuses), applications.c.next_attempt <= now),
            and_(applications.c.status == "PROCESSING", applications.c.lease_until < now),
        )
        chosen = (
            select(applications.c.id)
            .where(eligible)
            .order_by(applications.c.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
            .scalar_subquery()
        )
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    update(applications)
                    .where(applications.c.id == chosen, eligible)
                    .values(
                        status="PROCESSING",
                        lease_token=token,
                        lease_until=now + lease_seconds,
                        attempts=applications.c.attempts + 1,
                        updated_at=now,
                        version=applications.c.version + 1,
                    )
                    .returning(*applications.c)
                )
                .mappings()
                .first()
            )
            if row is None:
                return None
            data = dict(row)
            data["requirements"] = connection.scalar(
                select(jobs.c.requirements).where(jobs.c.id == row["job_id"])
            )
        return data

    def leased_update(self, row: dict, **values) -> bool:
        with self.engine.begin() as connection:
            result = connection.execute(
                update(applications)
                .where(
                    applications.c.id == row["id"], applications.c.lease_token == row["lease_token"]
                )
                .values(**values, updated_at=time.time(), version=applications.c.version + 1)
            )
            return result.rowcount == 1

    def renew(self, row: dict, lease_seconds: int) -> bool:
        with self.engine.begin() as connection:
            return (
                connection.execute(
                    update(applications)
                    .where(
                        applications.c.id == row["id"],
                        applications.c.lease_token == row["lease_token"],
                    )
                    .values(lease_until=time.time() + lease_seconds)
                ).rowcount
                == 1
            )

    def finish(self, row: dict, status: str, **values) -> bool:
        return self.leased_update(row, status=status, lease_token=None, lease_until=None, **values)

    def worker_heartbeat(self, worker_id: str):
        with self.engine.begin() as connection:
            found = connection.execute(
                update(workers).where(workers.c.id == worker_id).values(heartbeat=time.time())
            ).rowcount
            if not found:
                connection.execute(insert(workers).values(id=worker_id, heartbeat=time.time()))
            connection.execute(delete(workers).where(workers.c.heartbeat < time.time() - 86400))

    def worker_active(self) -> bool:
        with self.engine.connect() as connection:
            return bool(
                connection.scalar(
                    select(func.count())
                    .select_from(workers)
                    .where(workers.c.heartbeat > time.time() - 30)
                )
            )
