from fastapi.testclient import TestClient

from rolelens.config import Settings
from rolelens.main import app, get_settings


def setup_function():
    app.dependency_overrides[get_settings] = lambda: Settings(typesafe_api_key="", _env_file=None)


def teardown_function():
    app.dependency_overrides.clear()


def test_health_does_not_expose_credentials():
    app.dependency_overrides[get_settings] = lambda: Settings(
        typesafe_api_key="secret", _env_file=None
    )
    response = TestClient(app).get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["assessment_available"] is True
    assert "secret" not in response.text


def test_samples_are_explicitly_labeled_and_have_verbatim_evidence():
    response = TestClient(app).get("/api/v1/sample")
    assert response.status_code == 200
    for candidate in response.json()["candidates"]:
        assert candidate["assessment"]["is_sample"] is True
        for finding in candidate["assessment"]["findings"]:
            assert finding["confidence"] is None
            if finding["evidence"]:
                assert finding["evidence"]["text"] in candidate["text"]


def test_upload_and_preview_text():
    response = TestClient(app).post(
        "/api/v1/resumes",
        files={
            "file": (
                "resume.txt",
                b"Synthetic engineer. Built applications with React and TypeScript.",
            )
        },
    )
    assert response.status_code == 200
    assert response.json()["passages"]


def test_no_key_does_not_fall_back_to_fake_assessments():
    response = TestClient(app).post(
        "/api/v1/assessments",
        json={
            "resume_text": "Synthetic engineer. Built applications with React and TypeScript.",
            "requirements": [{"id": "react", "text": "Built React applications"}],
        },
    )
    assert response.status_code == 503
    assert "TYPESAFE_API_KEY" in response.json()["detail"]


def test_duplicate_requirement_ids_rejected():
    response = TestClient(app).post(
        "/api/v1/assessments",
        json={
            "resume_text": "Synthetic engineer. Built applications with React and TypeScript.",
            "requirements": [
                {"id": "react", "text": "Built React applications"},
                {"id": "react", "text": "Used TypeScript"},
            ],
        },
    )
    assert response.status_code == 422
