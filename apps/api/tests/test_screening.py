import csv
import io
import os
from uuid import uuid4
from zipfile import ZipFile

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


def test_shortlist_is_automatic_without_review(setup):
    c, s, j, r, h = setup
    row = s.application(r["id"])
    assert row["shortlisted"] and not row["reviewed"]
    assert row["selection"]["percentage"] == 100
    result = c.get(
        f"/api/v1/jobs/{j['id']}/comparison", headers=h, params={"scope": "SHORTLISTED"}
    ).json()
    assert result["total"] == result["shortlisted"] == 1
    assert result["items"][0]["selection"]["status"] == "SHORTLISTED"


def test_original_download_and_zip_need_no_approval(setup):
    c, s, j, r, h = setup
    assert c.get(f"/api/v1/applications/{r['id']}/document").status_code == 401
    result = c.get(f"/api/v1/applications/{r['id']}/document", headers=h)
    assert result.content == b"Synthetic resume with React project experience."
    assert "attachment" in result.headers["content-disposition"]
    url = f"/api/v1/jobs/{j['id']}/shortlist/documents"
    assert c.get(url).status_code == 401
    bundle = c.get(url, headers=h)
    assert bundle.status_code == 200
    with ZipFile(io.BytesIO(bundle.content)) as archive:
        assert len(archive.namelist()) == 1
        assert archive.read(archive.namelist()[0]) == result.content


def test_reassess_archives_and_removes_pending_applicants_from_shortlist(setup):
    c, s, j, r, h = setup
    row = s.application(r["id"])
    assert c.post(f"/api/v1/jobs/{j['id']}/reassess", headers=h).json()["queued"] == 1
    row = s.application(r["id"])
    assert row["status"] == "QUEUED" and row["assessment"] is None and not row["shortlisted"]
    assert row["document_available"]
    with s.engine.connect() as connection:
        old = connection.execute(select(assessment_history)).mappings().all()
    assert len(old) == 1 and old[0]["snapshot"]["assessment"]["protocol"] == PROTOCOL


def test_policy_is_versioned_authenticated_and_job_scoped(setup):
    c, s, j, r, h = setup
    url = f"/api/v1/jobs/{j['id']}/screening-policy"
    body = {"threshold": 80, "criterion_ids": ["react"], "version": 1}
    assert c.patch(url, json=body).status_code == 401
    assert c.patch(url, headers=h, json={**body, "criterion_ids": ["foreign"]}).status_code == 409
    assert s.job(j["id"])["policy_version"] == 1
    assert c.patch(url, headers=h, json=body).status_code == 200
    assert c.patch(url, headers=h, json=body).status_code == 409
    for threshold in [0, 101, 50.5, True]:
        assert (
            c.patch(url, headers=h, json={**body, "version": 2, "threshold": threshold}).status_code
            == 422
        )
    assert (
        c.patch(
            url, headers=h, json={**body, "version": 2, "criterion_ids": ["react", "react"]}
        ).status_code
        == 422
    )


def test_correction_updates_filters_and_automatic_selection(setup):
    c, s, j, r, h = setup
    row = s.application(r["id"])
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

    assert c.get(url, headers=h, params={"scope": "SHORTLISTED"}).json()["total"] == 0
    assert c.get(f"/api/v1/jobs/{j['id']}/shortlist/documents", headers=h).status_code == 422
    latest = s.application(r["id"])
    with pytest.raises(ValueError):
        s.save_review(r["id"], row["version"], "", True, {"react": "SUPPORTED"})
    assert not s.application(r["id"])["shortlisted"]
    s.save_review(r["id"], latest["version"], "", False, {})
    assert s.application(r["id"])["shortlisted"]


def assessed_application(store, job, name, statuses, **extra):
    receipt = store.accept(
        job["id"], name, name + ".txt", payload=(name + " fictional resume.").encode()
    )
    row = store.claim(True, 90)
    assert row["id"] == receipt["id"]
    store.finish(
        row,
        "READY",
        text=name + " fictional resume.",
        assessment={
            "model": "synthetic",
            "protocol": PROTOCOL,
            "findings": [
                {"requirement_id": key, "status": status} for key, status in statuses.items()
            ],
            **extra,
        },
    )
    return receipt["id"]


def test_100_resumes_threshold_pagination_and_exports_agree(setup):
    c, s, j, r, h = setup
    # Use the existing job so fixture cleanup remains scoped to this test.
    from rolelens.storage import jobs

    requirements = [
        {"id": key, "text": key + " development", "priority": "REQUIRED"}
        for key in ["react", "node", "sql"]
    ]
    from rolelens.decisions import default_policy

    with s.engine.begin() as connection:
        connection.execute(
            jobs.update()
            .where(jobs.c.id == j["id"])
            .values(requirements=requirements, screening_policy=default_policy(requirements))
        )
    # Existing resume supports only React. Add 99 more, 60 fully matching.
    for index in range(99):
        assessed_application(
            s,
            j,
            f"Applicant {index:03}",
            {
                "react": "SUPPORTED",
                "node": "SUPPORTED",
                "sql": "SUPPORTED" if index < 60 else "NOT_MENTIONED",
            },
        )
    url = f"/api/v1/jobs/{j['id']}/comparison"
    first = c.get(url, headers=h, params={"scope": "SHORTLISTED"}).json()
    second = c.get(url, headers=h, params={"scope": "SHORTLISTED", "page": 2}).json()
    assert first["total"] == first["shortlisted"] == 60
    assert len(first["items"]) == 50 and len(second["items"]) == 10
    assert {row["id"] for row in first["items"]}.isdisjoint({row["id"] for row in second["items"]})
    csv_url = f"/api/v1/jobs/{j['id']}/shortlist/csv"
    assert c.get(csv_url).status_code == 401
    assert len(list(csv.DictReader(io.StringIO(c.get(csv_url, headers=h).text)))) == 60
    zip_url = f"/api/v1/jobs/{j['id']}/shortlist/documents"
    with ZipFile(io.BytesIO(c.get(zip_url, headers=h).content)) as archive:
        assert len(archive.namelist()) == 60
    versions = {row["id"]: row["version"] for row in s.list_applications(j["id"])["items"]}
    policy_url = f"/api/v1/jobs/{j['id']}/screening-policy"
    # Two of three is 66.666...%, never rounded up to satisfy a 67% rule.
    for version, threshold, expected in [(1, 67, 60), (2, 66, 99)]:
        assert (
            c.patch(
                policy_url,
                headers=h,
                json={
                    "version": version,
                    "threshold": threshold,
                    "criterion_ids": ["react", "node", "sql"],
                },
            ).status_code
            == 200
        )
        result = c.get(url, headers=h, params={"scope": "SHORTLISTED"}).json()
        assert result["total"] == result["shortlisted"] == expected
        assert len(list(csv.DictReader(io.StringIO(c.get(csv_url, headers=h).text)))) == expected
    assert versions == {row["id"]: row["version"] for row in s.list_applications(j["id"])["items"]}
    assert (
        c.patch(
            policy_url, headers=h, json={"version": 3, "threshold": 100, "criterion_ids": ["react"]}
        ).status_code
        == 200
    )
    assert c.get(url, headers=h, params={"scope": "SHORTLISTED"}).json()["total"] == 100
    assert (
        c.patch(
            policy_url, headers=h, json={"version": 4, "threshold": 100, "criterion_ids": []}
        ).status_code
        == 200
    )
    assert c.get(url, headers=h, params={"scope": "SHORTLISTED"}).json()["total"] == 0
    assert s.application(r["id"])["selection"]["status"] == "INCONCLUSIVE"


@pytest.mark.parametrize(
    "statuses,extra,decision",
    [
        ({"react": "PARTIAL"}, {}, "NOT_MATCHED"),
        ({"react": "UNCLEAR"}, {}, "INCONCLUSIVE"),
        ({}, {}, "INCONCLUSIVE"),
        ({"react": "SUPPORTED"}, {"is_sample": True}, "INCONCLUSIVE"),
        ({"react": "SUPPORTED"}, {"protocol": "older"}, "INCONCLUSIVE"),
    ],
)
def test_uncertain_partial_sample_and_stale_results_never_qualify(setup, statuses, extra, decision):
    c, s, j, r, h = setup
    identifier = assessed_application(s, j, "Uncertain Applicant", statuses, **extra)
    row = s.application(identifier)
    assert not row["shortlisted"] and row["selection"]["status"] == decision
    result = c.get(
        f"/api/v1/jobs/{j['id']}/comparison", headers=h, params={"scope": "SHORTLISTED"}
    ).json()
    assert result["total"] == 1 and result["items"][0]["id"] == r["id"]
    csv_rows = list(
        csv.DictReader(io.StringIO(c.get(f"/api/v1/jobs/{j['id']}/shortlist/csv", headers=h).text))
    )
    assert [row["Applicant"] for row in csv_rows] == ["Synthetic Applicant"]


def test_defaults_show_interview_and_preferred_exclusions_but_keep_verification(setup):
    c, s, j, r, h = setup
    from rolelens.decisions import default_policy

    requirements = [
        {"id": "skill", "text": "SQL experience"},
        {
            "id": "interview",
            "text": "Communication skills",
            "priority": "REQUIRED",
            "assessment_mode": "INTERVIEW",
        },
        {"id": "preferred", "text": "React experience", "priority": "PREFERRED"},
        {
            "id": "verify",
            "text": "Required certification",
            "priority": "REQUIRED",
            "assessment_mode": "VERIFY_SEPARATELY",
        },
    ]
    assert default_policy(requirements) == {"threshold": 100, "criterion_ids": ["skill", "verify"]}


def test_csv_escapes_formulas_and_is_scoped_to_job(setup):
    c, s, j, r, h = setup
    assessed_application(s, j, "=formula", {"react": "SUPPORTED"})
    other = s.create_job("Other job", [{"id": "react", "text": "React experience"}])
    assessed_application(s, other, "Foreign applicant", {"react": "SUPPORTED"})
    rows = list(
        csv.DictReader(io.StringIO(c.get(f"/api/v1/jobs/{j['id']}/shortlist/csv", headers=h).text))
    )
    assert {row["Applicant"] for row in rows} == {"Synthetic Applicant", "'=formula"}
    assert all(row["Decision"] == "SHORTLISTED" for row in rows)


def test_unverified_source_cannot_be_overridden_into_shortlist(setup):
    c, s, j, r, h = setup
    from rolelens.storage import jobs

    with s.engine.begin() as connection:
        connection.execute(
            jobs.update()
            .where(jobs.c.id == j["id"])
            .values(
                requirements=[
                    {
                        "id": "react",
                        "text": "React development",
                        "priority": "REQUIRED",
                        "source_validation": "REVIEW",
                    }
                ]
            )
        )
    row = s.application(r["id"])
    s.save_review(r["id"], row["version"], "", False, {"react": "SUPPORTED"})
    assert not s.application(r["id"])["shortlisted"]
    assert (
        c.get(
            f"/api/v1/jobs/{j['id']}/comparison", headers=h, params={"scope": "SHORTLISTED"}
        ).json()["total"]
        == 0
    )


def test_migration_preserves_documents_history_and_guards_existing_findings(
    setup, tmp_path, monkeypatch
):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import MetaData, Table, create_engine

    from rolelens.storage import applications, jobs

    c, s, j, r, h = setup
    with s.engine.connect() as connection:
        job_data = dict(connection.execute(select(jobs)).mappings().one())
        applicant_data = dict(connection.execute(select(applications)).mappings().one())
    job_data.pop("screening_policy")
    job_data.pop("policy_version")
    job_data["interpretation"] = {"validation": {"react": "REVIEW"}, "edited_criteria": []}
    job_data["requirements"][0].pop("source_validation", None)
    applicant_data["screening"].pop("is_sample")
    applicant_data["shortlisted"] = True
    applicant_data["shortlist_approval"] = {"evidence_reviewed": True}
    url = f"sqlite:///{tmp_path / 'migration.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    config = Config("alembic.ini")
    command.upgrade(config, "9ccab034f821")
    engine = create_engine(url)
    old_metadata = MetaData()
    old_jobs = Table("jobs", old_metadata, autoload_with=engine)
    old_applications = Table("applications", old_metadata, autoload_with=engine)
    with engine.begin() as connection:
        connection.execute(old_jobs.insert().values(**job_data))
        connection.execute(old_applications.insert().values(**applicant_data))
    command.upgrade(config, "head")
    migrated = Store(url)
    assert migrated.job(j["id"])["screening_policy"] == {
        "threshold": 100,
        "criterion_ids": ["react"],
    }
    result = migrated.application(r["id"])
    assert result["document_available"] and result["assessment"] == applicant_data["assessment"]
    assert result["shortlist_approval"] == applicant_data["shortlist_approval"]
    assert not result["shortlisted"]
    assert result["selection"]["status"] == "INCONCLUSIVE"
    assert result["screening"]["REQUIRED"]["supported"] == 0
    migrated.engine.dispose()
    engine.dispose()
