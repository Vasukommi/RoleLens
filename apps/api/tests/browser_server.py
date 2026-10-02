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
        "OPENAI_API_KEY": "",
        "WORKSPACE_API_KEY": "synthetic-browser-workspace-token",
        "INTAKE_API_KEY": "synthetic-browser-token",
    }
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], env=environment, check=True
    )
    # A completed fictional assessment exercises reviewer controls without hosted model calls.
    subprocess.run(
        [
            sys.executable,
            "-c",
            """
from rolelens.storage import Store
from rolelens.schemas import Assessment, Finding, Passage
from rolelens.config import Settings
from rolelens.job_descriptions import cache_key, InterpretationRequest, PROMPT_VERSION
store = Store(Settings().database_url)
description = ('Must have Node.js experience. React or Angular preferred. '
               'Minimum 3 years in Node.js.')
request = InterpretationRequest(title='JD browser fixture', description=description)
store.save_interpretation(cache_key(request, Settings()), request.title, description, {
    'requirements': [
        {'id': 'node', 'text': 'Node.js experience', 'priority': 'REQUIRED',
         'assessment_mode': 'RESUME_EVIDENCE', 'source_quote': 'Must have Node.js experience.',
         'review_note': None},
        {'id': 'frontend', 'text': 'React or Angular', 'priority': 'PREFERRED',
         'assessment_mode': 'RESUME_EVIDENCE', 'source_quote': 'React or Angular preferred.',
         'review_note': None},
        {'id': 'duration', 'text': 'Minimum 3 years in Node.js', 'priority': 'REQUIRED',
         'assessment_mode': 'VERIFY_SEPARATELY', 'source_quote': 'Minimum 3 years in Node.js.',
         'review_note': 'Duration needs separate verification.'},
    ],
    'validation': {'node': 'GROUNDED', 'frontend': 'GROUNDED', 'duration': 'GROUNDED'},
    'review_notes': ['This is a synthetic browser-test interpretation; no model calls.'],
    'model': 'synthetic-browser-fixture', 'verifier_model': 'synthetic-browser-fixture',
    'prompt_version': PROMPT_VERSION, 'usage': {},
})
text = 'Fictional browser fixture. Built Python APIs with FastAPI and background jobs.'
job = store.create_job('Dropdown review fixture', [{'id': 'python', 'text': 'Built Python APIs'}])
receipt = store.accept(job['id'], 'Dropdown Test Applicant', 'fictional.txt', text=text,
                       source='synthetic_fixture', external_id='dropdown-review')
row = store.claim(False, 90)
assert row['id'] == receipt['id']
assessment = Assessment(model='synthetic-browser-fixture', is_sample=True, findings=[
    Finding(requirement_id='python', status='SUPPORTED',
            evidence=Passage(id='p1', text=text), confidence=0.9)
])
store.finish(row, 'READY', extraction_method='native',
             assessment=assessment.model_dump(mode='json'))
from rolelens.matching import PROTOCOL
job = store.create_job('Comparison fixture', [
    {'id': 'react', 'text': 'React development', 'priority': 'REQUIRED'},
    {'id': 'typescript', 'text': 'TypeScript development', 'priority': 'REQUIRED'},
])
for name, has_typescript in [('Alex Fixture', True), ('Sam Fixture', False)]:
    text = 'Fictional resume. Built React applications.'
    if has_typescript:
        text += ' Implemented TypeScript components in a production project.'
    receipt = store.accept(job['id'], name, name.replace(' ', '-') + '.txt',
                           payload=text.encode(), source='synthetic_fixture')
    row = store.claim(False, 90)
    assert row['id'] == receipt['id']
    assessment = Assessment(model='synthetic-browser-fixture', is_sample=True,
        protocol=PROTOCOL, findings=[
            Finding(requirement_id='react', status='SUPPORTED',
                    evidence=Passage(id='p1', text=text),
                    evidence_passages=[Passage(id='p1', text=text)],
                    reason='Synthetic applied-work evidence.', confidence=0.9),
            Finding(requirement_id='typescript',
                    status='SUPPORTED' if has_typescript else 'NOT_MENTIONED',
                    evidence=Passage(id='p1', text=text) if has_typescript else None,
                    reason='Synthetic fixture result.'),
        ])
    store.finish(row, 'READY', text=text, extraction_method='native',
                 payload=None, assessment=assessment.model_dump(mode='json'))

""",
        ],
        env=environment,
        check=True,
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
