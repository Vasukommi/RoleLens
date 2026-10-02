import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.engine import make_url

from rolelens.config import Settings
from rolelens.dependencies import get_settings, get_store
from rolelens.main import app
from rolelens.matching import PROTOCOL
from rolelens.storage import Store, assessment_history, metadata


@pytest.fixture
def setup(tmp_path):
    store = Store(os.environ.get("TEST_DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}"))
    if "TEST_DATABASE_URL" in os.environ and not make_url(store.engine.url).database.endswith(
        "_test"
    ):
        pytest.fail("Use a separate database whose name ends with _test.")
    metadata.drop_all(store.engine)
    metadata.create_all(store.engine)
    settings = Settings(_env_file=None, workspace_api_key="synthetic-screening-token")
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_store] = lambda: store
    job = store.create_job(
        f"Synthetic job {uuid4()}",
        [{"id": "react", "text": "React development", "priority": "REQUIRED"}],
    )
    receipt = store.accept(
        job["id"],
        "Synthetic Applicant",
        "synthetic.txt",
        payload=b"Synthetic resume with React project experience.",
    )
    row = store.claim(True, 90)
    assessment = {
        "model": "synthetic",
        "protocol": PROTOCOL,
        "findings": [{"requirement_id": "react", "status": "SUPPORTED"}],
    }
    store.finish(
        row, "READY", assessment=assessment, text="Synthetic resume with React project experience."
    )
    headers = {"Authorization": "Bearer synthetic-screening-token"}
    with TestClient(app) as client:
        yield client, store, job, receipt, headers
    from sqlalchemy import delete

    from rolelens.storage import jobs

    with store.engine.begin() as connection:
        connection.execute(delete(jobs).where(jobs.c.id == job["id"]))
        connection.execute(delete(jobs).where(jobs.c.title == "Other job"))
    app.dependency_overrides.clear()
    store.engine.dispose()


def test_comparison_filters_without_loading_resume_text(setup):
    c, s, j, r, h = setup
    url = f"/api/v1/jobs/{j['id']}/comparison"
    assert c.get(url).status_code == 401
    result = c.get(
        url, headers=h, params={"criterion_id": "react", "finding_status": "SUPPORTED"}
    ).json()
    assert result["total"] == 1
    assert "text" not in result["items"][0] and "assessment" not in result["items"][0]
    assert result["items"][0]["screening"]["REQUIRED"]["supported"] == 1
    assert (
        c.get(
            url, headers=h, params={"criterion_id": "react", "finding_status": "NOT_MENTIONED"}
        ).json()["total"]
        == 0
    )
    assert c.get(url, headers=h, params={"scope": "COMPLETE"}).json()["total"] == 1
    assert c.get(url, headers=h, params={"criterion_id": "foreign"}).status_code == 409


def test_shortlist_requires_review_and_rejects_stale_versions(setup):
    c, s, j, r, h = setup
    row = s.application(r["id"])
    url = f"/api/v1/jobs/{j['id']}/shortlist"
    body = {"selections": [{"id": r["id"], "version": row["version"]}]}
    assert c.post(url, json=body, headers=h).status_code == 422
    body["evidence_reviewed"] = True
    body["selections"][0]["version"] -= 1
    assert c.post(url, json=body, headers=h).status_code == 409
    body["selections"][0]["version"] = row["version"]
    assert c.post(url, json=body, headers=h).json()["approved"] == 1
    assert s.application(r["id"])["shortlisted"] is True
    assert (
        c.get(
            f"/api/v1/jobs/{j['id']}/comparison", headers=h, params={"scope": "SHORTLISTED"}
        ).json()["total"]
        == 1
    )


def test_original_download_and_zip_require_approval(setup):
    c, s, j, r, h = setup
    assert c.get(f"/api/v1/applications/{r['id']}/document").status_code == 401
    result = c.get(f"/api/v1/applications/{r['id']}/document", headers=h)
    assert result.content == b"Synthetic resume with React project experience."
    assert "attachment" in result.headers["content-disposition"]
    url = f"/api/v1/jobs/{j['id']}/shortlist/documents"
    assert c.get(url, headers=h).status_code == 422
    row = s.application(r["id"])
    s.approve_shortlist(j["id"], [{"id": r["id"], "version": row["version"]}])
    assert c.get(url, headers=h).content.startswith(b"PK")


def test_reassess_archives_and_clears_stale_approval(setup):
    c, s, j, r, h = setup
    row = s.application(r["id"])
    s.approve_shortlist(j["id"], [{"id": r["id"], "version": row["version"]}])
    assert c.post(f"/api/v1/jobs/{j['id']}/reassess", headers=h).json()["queued"] == 1
    row = s.application(r["id"])
    assert row["status"] == "QUEUED" and row["assessment"] is None and not row["shortlisted"]
    assert row["document_available"]
    with s.engine.connect() as connection:
        old = connection.execute(select(assessment_history)).mappings().all()
    assert len(old) == 1 and old[0]["snapshot"]["assessment"]["protocol"] == PROTOCOL


def test_atomic_batch_rejects_foreign_application(setup):
    c, s, j, r, h = setup
    other = s.create_job("Other job", [{"id": "react", "text": "React development"}])
    foreign = s.accept(
        other["id"],
        "Other applicant",
        "other.txt",
        text="Synthetic foreign resume with React experience.",
    )
    row = s.application(r["id"])
    with pytest.raises(ValueError):
        s.approve_shortlist(
            j["id"],
            [{"id": r["id"], "version": row["version"]}, {"id": foreign["id"], "version": 1}],
        )
    assert not s.application(r["id"])["shortlisted"]


def test_correction_updates_server_filters_and_invalidates_approval(setup):
    c, s, j, r, h = setup
    row = s.application(r["id"])
    s.approve_shortlist(j["id"], [{"id": r["id"], "version": row["version"]}])
    row = s.application(r["id"])
    s.save_review(r["id"], row["version"], "", True, {"react": "UNCLEAR"})
    assert not s.application(r["id"])["shortlisted"]
    url = f"/api/v1/jobs/{j['id']}/comparison"
    assert c.get(url, headers=h, params={"scope": "COMPLETE"}).json()["total"] == 0
    assert (
        c.get(url, headers=h, params={"criterion_id": "react", "finding_status": "UNCLEAR"}).json()[
            "total"
        ]
        == 1
    )
