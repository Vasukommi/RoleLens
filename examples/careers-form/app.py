"""A runnable intake client. Replace its form with your careers site's existing handler."""

import os
from typing import Annotated
from uuid import UUID, uuid4

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse

app = FastAPI(title="RoleLens careers-form integration example")


@app.get("/", response_class=HTMLResponse)
def form():
    return f'''<!doctype html><html lang="en"><head><title>Apply to the example role</title></head>
    <body><h1>Apply to the example role</h1>
    <p>Local integration example. Use invented resumes only.</p>
    <form action="/apply" method="post" enctype="multipart/form-data">
      <input type="hidden" name="application_id" value="{uuid4()}">
      <p><label>Name <input name="name" required maxlength="100"></label></p>
      <p><label>Resume
        <input type="file" name="resume" accept=".pdf,.docx,.txt" required></label></p>
      <button type="submit">Submit application</button>
    </form></body></html>'''


@app.post("/apply")
async def submit(
    name: Annotated[str, Form(min_length=1, max_length=100)],
    application_id: Annotated[UUID, Form()],
    resume: Annotated[UploadFile, File()],
):
    token, job_id = os.environ.get("INTAKE_API_KEY", ""), os.environ.get("ROLELENS_JOB_ID", "")
    if not token or not job_id:
        raise HTTPException(
            503, "Configure INTAKE_API_KEY and ROLELENS_JOB_ID on this form server."
        )
    try:
        content = await resume.read(5 * 1024 * 1024 + 1)
        if len(content) > 5 * 1024 * 1024:
            raise HTTPException(413, "Resume exceeds 5 MB.")
        url = os.environ.get("ROLELENS_API_URL", "http://127.0.0.1:8000").rstrip("/")
        async with httpx.AsyncClient(timeout=30) as client:
            # Reuse the same external ID after an uncertain response.
            response = await client.post(
                f"{url}/api/v1/integrations/jobs/{UUID(job_id)}/applications",
                headers={"Authorization": f"Bearer {token}"},
                data={"source": "careers_form", "external_id": str(application_id), "name": name},
                files={
                    "file": (
                        resume.filename or "resume.txt",
                        content,
                        resume.content_type or "application/octet-stream",
                    )
                },
            )
        if response.is_error:
            raise HTTPException(
                502, "Intake did not accept this application. Resubmit the same form."
            )
        return {
            "message": "Application received for background processing.",
            "receipt": response.json()["id"],
            "external_id": str(application_id),
        }
    except httpx.RequestError as error:
        raise HTTPException(
            503, "Intake unavailable. Resubmit the same form to retry safely."
        ) from error
    finally:
        await resume.close()
