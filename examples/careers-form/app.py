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
    return f'''<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Apply to the example role · RoleLens</title>
    <style>
    * {{box-sizing:border-box}} body {{margin:0;background:#f6f7f9;color:#20252a;
    font:16px/1.6 system-ui,sans-serif}} main {{max-width:640px;margin:8vh auto;padding:32px}}
    .brand {{font-size:22px;font-weight:750;letter-spacing:-.8px}} .brand span {{color:#08756a}}
    .eyebrow {{color:#68727e;font-size:13px;margin:40px 0 8px}}
    h1 {{font-size:32px;letter-spacing:-1px;margin:0 0 8px}}
    .description {{color:#647080;margin:0 0 28px}}
    form {{background:white;border:1px solid #dfe3e8;border-radius:12px;padding:28px}}
    label {{display:block;font-size:14px;font-weight:600;margin-bottom:24px}}
    input {{display:block;margin-top:8px;width:100%;padding:12px;border:1px solid #d8dee6;
    border-radius:6px;background:white;color:#20252a;font:inherit;font-weight:400}}
    input::file-selector-button {{background:#eef1f5;border:0;border-radius:4px;padding:8px;
    margin-right:12px;color:#394451}} button {{width:100%;border:0;border-radius:6px;
    background:#24292e;color:white;padding:13px;font:600 14px system-ui;cursor:pointer}}
    button:disabled {{opacity:.6}} .footnote {{font-size:12px;color:#78828d;margin-top:20px}}
    #result {{margin:16px 0 0;font-size:14px}} .success {{color:#08756a}}
    </style></head><body><main>
    <div class="brand">Role<span>Lens</span> <small> / careers</small></div>
    <p class="eyebrow">EXAMPLE CAREERS FORM</p><h1>Backend Engineer</h1>
    <p class="description">Python · PostgreSQL · AWS. Share your experience with the team.</p>
    <form action="/apply" method="post" enctype="multipart/form-data" id="application">
      <input type="hidden" name="application_id" value="{uuid4()}">
      <label>Name <input name="name" required maxlength="100" placeholder="Your name"></label>
      <label>Resume
        <input type="file" name="resume" accept=".pdf,.docx,.txt" required></label>
      <button type="submit">Submit application</button>
      <p id="result" role="status" aria-live="polite"></p>
    </form><p class="footnote">Local integration example. Use fictional resumes only.
    Applications go to the reviewer inbox; this form does not make hiring decisions.</p>
    </main><script>
    const form = document.querySelector('#application');
    form.addEventListener('submit', async (event) => {{
      event.preventDefault();
      const button = form.querySelector('button');
      const result = document.querySelector('#result');
      button.disabled = true;
      result.className = '';
      result.textContent = 'Submitting application…';
      try {{
        const response = await fetch('/apply', {{method:'POST',body:new FormData(form)}});
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || 'Could not submit. Please retry.');
        result.className = 'success';
        result.textContent = 'Application received. The team can now review your resume.';
        button.textContent = 'Application submitted';
      }} catch (error) {{
        result.textContent = error.message;
        button.disabled = false;
      }}
    }});
    </script></body></html>'''


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
