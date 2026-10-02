"""An isolated local API, worker, and careers form for recording a real demo."""

import json
import os
import secrets
import signal
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "apps/api"
DIRECTORY = ROOT / "data/demo"
sys.path.insert(0, str(API))

from rolelens.config import Settings  # noqa: E402


def stop(_signal, _frame):
    raise SystemExit(0)


def main():
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    settings = Settings(_env_file=API / ".env")
    if not settings.assessment_available:
        raise SystemExit("Configure TYPESAFE_API_KEY in apps/api/.env for the live demo.")
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    environment = {
        **os.environ,
        "PATH": str(DIRECTORY / "ocr-tools/bin") + os.pathsep + os.environ.get("PATH", ""),
        "DATABASE_URL": f"sqlite:///{DIRECTORY / 'rolelens.db'}",
        "TYPESAFE_API_KEY": settings.typesafe_api_key.get_secret_value(),
        "TYPESAFE_MODEL": settings.typesafe_model,
        "INTAKE_API_KEY": secrets.token_urlsafe(32),
        "PYTHONPATH": str(API),
    }
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=API,
        env=environment,
        check=True,
    )
    children = []
    try:
        children.append(
            subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "rolelens.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8011",
                    "--no-access-log",
                ],
                cwd=API,
                env=environment,
            )
        )
        for attempt in range(100):
            try:
                response = httpx.get("http://127.0.0.1:8011/api/v1/jobs", timeout=2)
                response.raise_for_status()
                break
            except httpx.RequestError:
                if attempt == 99:
                    raise
                time.sleep(0.1)
        title = "Backend Engineer — fictional example"
        existing = next((j for j in response.json() if j["title"] == title), None)
        if existing:
            job = existing
        else:
            response = httpx.post(
                "http://127.0.0.1:8011/api/v1/jobs",
                json={
                    "title": title,
                    "requirements": [
                        {"id": "python", "text": "Built Python APIs"},
                        {"id": "postgres", "text": "Worked with PostgreSQL databases"},
                        {"id": "aws", "text": "Deployed services on AWS"},
                        {"id": "testing", "text": "Wrote automated tests using pytest"},
                        {"id": "kafka", "text": "Operated Kafka pipelines"},
                    ],
                },
                timeout=10,
            )
            response.raise_for_status()
            job = response.json()
        state = {
            "api_url": "http://127.0.0.1:8011",
            "web_url": "http://127.0.0.1:3011",
            "careers_url": "http://127.0.0.1:9011",
            "example_job_id": job["id"],
            "example_job_title": job["title"],
        }
        (DIRECTORY / "state.json").write_text(json.dumps(state, indent=2))
        children.append(
            subprocess.Popen([sys.executable, "-m", "rolelens.worker"], cwd=API, env=environment)
        )
        children.append(
            subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "app:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "9011",
                    "--no-access-log",
                ],
                cwd=ROOT / "examples/careers-form",
                env={
                    **environment,
                    "ROLELENS_JOB_ID": job["id"],
                    "ROLELENS_API_URL": state["api_url"],
                },
            )
        )
        print("Isolated live demo ready: API 8011, careers form 9011.", flush=True)
        while True:
            if any(child.poll() is not None for child in children):
                raise RuntimeError("A demo service stopped unexpectedly.")
            time.sleep(1)
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    main()
