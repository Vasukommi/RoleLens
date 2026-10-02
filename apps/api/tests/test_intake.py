import asyncio
import os
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.engine import make_url

from rolelens.config import Settings
from rolelens.dependencies import get_settings, get_store
from rolelens.main import app
from rolelens.providers import ProviderError
from rolelens.schemas import Assessment, EvidenceStatus, Finding, ParsedResume, Passage
from rolelens.storage import IntakeConflict, Store, applications, metadata
from rolelens.worker import process

TEXT = "Synthetic applicant. Built React applications with TypeScript and automated tests."
REQUIREMENTS = [{"id": "react", "text": "Built React applications"}]


@pytest.fixture
def store(tmp_path):
    url = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{tmp_path / 'intake.db'}")
    if "TEST_DATABASE_URL" in os.environ and not make_url(url).database.endswith("_test"):
        pytest.fail("Use a separate database whose name ends with _test.")
    instance = Store(url)
    metadata.drop_all(instance.engine)
    metadata.create_all(instance.engine)
    yield instance
    instance.engine.dispose()


@pytest.fixture
def client(store):
    app.dependency_overrides[get_store] = lambda: store
    app.dependency_overrides[get_settings] = lambda: Settings(
        typesafe_api_key="", intake_api_key="synthetic-test-token", _env_file=None
    )
    with TestClient(app) as instance:
        yield instance
    app.dependency_overrides.clear()


def new_job(store):
    return store.create_job("Frontend Engineer", REQUIREMENTS)


def accept(store, job, external_id="a-1", text=TEXT):
    return store.accept(
        job["id"],
        "Synthetic Applicant",
        "resume.txt",
        text=text,
        source="careers_form",
        external_id=external_id,
    )


class SuccessfulProvider:
    async def assess(self, request):
        return Assessment(
            model="synthetic-test",
            findings=[
                Finding(
                    requirement_id="react",
                    status=EvidenceStatus.SUPPORTED,
                    evidence=Passage(id="p1", text=request.resume_text),
                    confidence=0.9,
                )
            ],
        )


class FailedProvider:
    async def assess(self, _request):
        raise ProviderError("Jev could not be reached. Please try again.")


def test_worker_persists_ocr_provenance_before_assessment(store, monkeypatch):
    job = new_job(store)
    receipt = store.accept(job["id"], "Synthetic scan", "scan.pdf", payload=b"synthetic scan")
    monkeypatch.setattr(
        "rolelens.worker.parse_resume",
        lambda _filename, _content: ParsedResume(
            filename="scan.pdf", text=TEXT, passages=[], extraction_method="ocr"
        ),
    )
    asyncio.run(
        process(
            store,
            Settings(typesafe_api_key="", _env_file=None),
            store.claim(False, 90),
            SuccessfulProvider(),
        )
    )
    stored = store.application(receipt["id"])
    assert stored["extraction_method"] == "ocr"
    assert stored["text"] == TEXT
    assert stored["status"] == "AWAITING_PROVIDER"


def test_authenticated_intake_is_idempotent_and_preserves_source(client, store):
    job = new_job(store)
    body = {
        "job_id": job["id"],
        "source": "careers_form",
        "external_id": "external-31",
        "name": "Synthetic Applicant",
        "resume_text": TEXT,
    }
    endpoint = "/api/v1/integrations/applications"
    assert client.post(endpoint, json=body).status_code == 401
    headers = {"Authorization": "Bearer synthetic-test-token"}
    first = client.post(endpoint, json=body, headers=headers)
    second = client.post(endpoint, json=body, headers=headers)
    assert first.status_code == second.status_code == 202
    assert first.json()["id"] == second.json()["id"]
    assert second.json()["duplicate"] is True
    status = client.get(first.headers["location"], headers=headers).json()
    assert status["status"] == "QUEUED"
    assert "text" not in status and "notes" not in status
    details = store.application(first.json()["id"])
    assert details["external_id"] == "external-31" and details["source"] == "careers_form"
    body["resume_text"] += " Different document."
    assert client.post(endpoint, json=body, headers=headers).status_code == 409


def test_integration_file_is_queued_without_synchronous_parsing(client, store):
    job = new_job(store)
    result = client.post(
        f"/api/v1/integrations/jobs/{job['id']}/applications",
        headers={"Authorization": "Bearer synthetic-test-token"},
        data={"source": "careers_form", "external_id": "file-22", "name": "Synthetic Applicant"},
        files={"file": ("resume.txt", TEXT.encode())},
    )
    assert result.status_code == 202
    details = store.application(result.json()["id"])
    assert details["status"] == "QUEUED" and details["text"] is None


def test_bulk_receipts_do_not_double_count_delivery_retries(client, store):
    job = new_job(store)
    batch = store.create_batch(job["id"], 2)
    endpoint = f"/api/v1/jobs/{job['id']}/applications"
    data = {"name": "Synthetic", "batch_id": batch["id"], "receipt_id": str(uuid4())}
    first = client.post(endpoint, data=data, files={"file": ("synthetic.txt", TEXT.encode())})
    again = client.post(endpoint, data=data, files={"file": ("synthetic.txt", TEXT.encode())})
    assert first.json()["id"] == again.json()["id"]
    data["receipt_id"] = str(uuid4())
    duplicate = client.post(endpoint, data=data, files={"file": ("synthetic.txt", TEXT.encode())})
    assert duplicate.json()["duplicate"] is True
    summary = store.summary(job["id"])
    assert summary["total"] == 1
    assert summary["batches"][0]["received"] == 2
    assert summary["batches"][0]["duplicates"] == 1


def test_receipts_and_batches_cannot_be_reused_across_jobs(store):
    job, other = new_job(store), new_job(store)
    batch = store.create_batch(job["id"], 1)
    with pytest.raises(IntakeConflict):
        store.accept(
            other["id"],
            "Synthetic",
            "a.txt",
            text=TEXT,
            batch_id=batch["id"],
            receipt_id=str(uuid4()),
        )
    assert store.summary(other["id"])["total"] == 0


def test_duplicate_delivery_race_creates_one_application(store):
    job = new_job(store)
    with ThreadPoolExecutor(max_workers=4) as pool:
        ids = list(pool.map(lambda _: accept(store, job)["id"], range(8)))
    assert len(set(ids)) == 1
    assert store.summary(job["id"])["total"] == 1


def test_workers_claim_distinct_applications(store):
    job = new_job(store)
    for index in range(8):
        accept(store, job, external_id=f"claim-{index}")
    with ThreadPoolExecutor(max_workers=4) as pool:
        claims = list(pool.map(lambda _: store.claim(True, 90), range(8)))
    claimed_ids = [row["id"] for row in claims if row]
    assert len(claimed_ids) == len(set(claimed_ids))
    while row := store.claim(True, 90):
        claimed_ids.append(row["id"])
    assert len(claimed_ids) == 8


def test_expired_worker_lease_is_recovered_and_old_worker_cannot_publish(store):
    job = new_job(store)
    receipt = accept(store, job)
    first = store.claim(True, 90)
    assert store.claim(True, 90) is None
    with store.engine.begin() as connection:
        connection.execute(
            update(applications)
            .where(applications.c.id == receipt["id"])
            .values(lease_until=time.time() - 1)
        )
    recovered = store.claim(True, 90)
    assert recovered["id"] == first["id"]
    assert recovered["lease_token"] != first["lease_token"]
    assert store.finish(first, "READY") is False
    assert store.finish(recovered, "READY") is True


def test_missing_key_parses_and_waits_without_fake_findings(store):
    job = new_job(store)
    receipt = store.accept(job["id"], "Synthetic", "a.txt", payload=TEXT.encode())
    row = store.claim(False, 90)
    asyncio.run(
        process(store, Settings(typesafe_api_key="", _env_file=None), row, SuccessfulProvider())
    )
    details = store.application(receipt["id"])
    assert details["status"] == "AWAITING_PROVIDER" and details["text"] == TEXT
    assert details["assessment"] is None
    with store.engine.connect() as connection:
        assert connection.scalar(select(applications.c.payload)) is None
    assert store.claim(False, 90) is None
    assert store.claim(True, 90)["id"] == details["id"]


def test_provider_failures_retry_with_backoff_then_stop(store):
    job = new_job(store)
    receipt = accept(store, job)
    settings = Settings(typesafe_api_key="synthetic", worker_max_attempts=2, _env_file=None)
    asyncio.run(process(store, settings, store.claim(True, 90), FailedProvider()))
    assert store.application(receipt["id"])["status"] == "RETRY_WAIT"
    assert store.claim(True, 90) is None
    with store.engine.begin() as connection:
        connection.execute(update(applications).values(next_attempt=0))
    asyncio.run(process(store, settings, store.claim(True, 90), FailedProvider()))
    assert store.application(receipt["id"])["status"] == "FAILED"
    assert store.retry(job["id"], receipt["id"]) == 1
    assert store.claim(True, 90)["attempts"] == 1


def test_bad_document_failure_does_not_block_other_applications(store):
    job = new_job(store)
    broken = store.accept(job["id"], "Broken", "a.pdf", payload=b"invalid document")
    valid = accept(store, job, "good-1")
    settings = Settings(typesafe_api_key="synthetic", _env_file=None)
    asyncio.run(process(store, settings, store.claim(True, 90), SuccessfulProvider()))
    asyncio.run(process(store, settings, store.claim(True, 90), SuccessfulProvider()))
    assert store.application(broken["id"])["status"] == "FAILED"
    assert store.application(valid["id"])["status"] == "READY"


def test_saved_review_preserves_original_finding_and_rejects_stale_version(client, store):
    job = new_job(store)
    receipt = accept(store, job)
    asyncio.run(
        process(
            store,
            Settings(typesafe_api_key="synthetic", _env_file=None),
            store.claim(True, 90),
            SuccessfulProvider(),
        )
    )
    original = store.application(receipt["id"])
    endpoint = f"/api/v1/applications/{receipt['id']}/review"
    body = {
        "version": original["version"],
        "notes": "Ask for a concrete example.",
        "reviewed": True,
        "overrides": {"react": "PARTIAL"},
    }
    saved = client.patch(endpoint, json=body)
    assert saved.status_code == 200
    reloaded = Store(store.engine.url.render_as_string(hide_password=False)).application(
        receipt["id"]
    )
    assert reloaded["notes"] == body["notes"] and reloaded["reviewed"] is True
    assert reloaded["assessment"]["findings"][0]["status"] == "SUPPORTED"
    assert reloaded["overrides"] == {"react": "PARTIAL"}
    assert client.patch(endpoint, json=body).status_code == 409


def test_thousand_application_inbox_is_paginated_without_document_payloads(store):
    job = new_job(store)
    for index in range(1000):
        store.accept(
            job["id"],
            f"Synthetic {index:04}",
            "resume.txt",
            text=TEXT,
            source="careers_form",
            external_id=f"load-{index}",
        )
    first = store.list_applications(job["id"])
    last = store.list_applications(job["id"], page=20)
    assert first["total"] == 1000 and len(first["items"]) == len(last["items"]) == 50
    assert not set(r["id"] for r in first["items"]) & set(r["id"] for r in last["items"])
    assert "text" not in first["items"][0] and "payload" not in first["items"][0]
    assert store.list_applications(job["id"], search="Synthetic 001")["total"] == 10


def test_direct_intake_rejects_oversize_request(client):
    response = client.post(
        "/api/v1/integrations/applications",
        headers={"Content-Length": str(7 * 1024 * 1024)},
        content=b"x",
    )
    assert response.status_code == 413


def test_repeated_worker_crashes_stop_automatic_processing(store):
    job = new_job(store)
    receipt = accept(store, job)
    with store.engine.begin() as connection:
        connection.execute(update(applications).values(attempts=4))
    asyncio.run(
        process(
            store,
            Settings(typesafe_api_key="synthetic", _env_file=None),
            store.claim(True, 90),
            SuccessfulProvider(),
        )
    )
    assert store.application(receipt["id"])["status"] == "FAILED"
    assert store.claim(True, 90) is None
