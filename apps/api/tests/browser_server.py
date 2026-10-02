"""An isolated real API+worker for browser tests. Never use developer credentials/data."""

import os
import signal
import subprocess
import sys
import tempfile
import time

import httpx


def stop(_signal, _frame):
    raise SystemExit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
with tempfile.TemporaryDirectory(prefix="rolelens-browser-") as directory:
    environment = {
        **os.environ,
        "DATABASE_URL": f"sqlite:///{directory}/browser.db",
        "TYPESAFE_API_KEY": "",
        "INTAKE_API_KEY": "synthetic-browser-token",
    }
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], env=environment, check=True
    )
    api = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "rolelens.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8010",
        ],
        env=environment,
    )
    worker = subprocess.Popen([sys.executable, "-m", "rolelens.worker"], env=environment)
    careers = None
    try:
        for attempt in range(50):
            try:
                response = httpx.post(
                    "http://127.0.0.1:8010/api/v1/jobs",
                    json={
                        "title": "Careers Form Example",
                        "requirements": [{"id": "python", "text": "Built Python APIs"}],
                    },
                    timeout=2,
                )
                response.raise_for_status()
                break
            except httpx.RequestError:
                if attempt == 49:
                    raise
                time.sleep(0.1)
        careers_environment = {
            **environment,
            "ROLELENS_JOB_ID": response.json()["id"],
            "ROLELENS_API_URL": "http://127.0.0.1:8010",
        }
        careers = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "--app-dir",
                "../../examples/careers-form",
                "app:app",
                "--host",
                "127.0.0.1",
                "--port",
                "9010",
            ],
            env=careers_environment,
        )
        api.wait()
    finally:
        children = [api, worker] + ([careers] if careers else [])
        for child in children:
            child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
