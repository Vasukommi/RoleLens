# Application intake integration

RoleLens currently implements an authenticated server-to-server intake API and a runnable careers-form adapter. It does not yet ship a Greenhouse, Lever, Workable, email, or other named connector. A source label is provenance, not proof that an adapter exists.

## Contract

Create a job in the inbox. Its ID is under **Integration and import details**. Set `INTAKE_API_KEY` on FastAPI and restart it. Use the same token only on your source application's server; never embed it in candidate-facing JavaScript.

For already-extracted text:

```http
POST /api/v1/integrations/applications
Authorization: Bearer <intake-token>
Content-Type: application/json

{
  "job_id": "<job-uuid>",
  "source": "careers_form",
  "external_id": "your-stable-application-id",
  "name": "Synthetic Applicant",
  "resume_text": "Invented applicant. Built Python APIs and maintained PostgreSQL databases."
}
```

For a file, post multipart data to `/api/v1/integrations/jobs/{job_id}/applications` with fields `source`, `external_id`, `name`, and `file`. Supported files: PDF, DOCX, UTF-8 TXT; 5 MB per document and 6 MB per HTTP request. The API accepts the record and returns `202` **before** parsing or inference.

Response:

```json
{ "id": "<application-uuid>", "duplicate": false }
```

Retry a failed/uncertain delivery using the **same source, external ID, and document**. It returns the original receipt and does not enqueue another application. Reusing an external ID with changed resume data returns `409`; updates need a deliberate revision policy, which is not implemented here. Distinct application IDs remain distinct even with identical resumes. Bulk file imports use a document hash within the job for duplicate detection.

Poll `GET /api/v1/integrations/applications/{id}` with the bearer token. This exposes processing status and a safe error, not resume text or reviewer notes. Status is one of `QUEUED`, `PROCESSING`, `AWAITING_PROVIDER`, `RETRY_WAIT`, `READY`, or `FAILED`. These are processing states, not hiring outcomes.

Persist your source application's external ID and RoleLens receipt. A delivery response is an acknowledgement of durable intake, not a guarantee of successful parsing or assessment. Failed documents remain inspectable in the inbox. Provider failures retry automatically with backoff, then stop; operators can retry an individual application or a job's failed/waiting work.

## Runnable careers form

The [example server](../examples/careers-form/app.py) accepts an actual browser file upload and forwards it through the authenticated multipart endpoint. It keeps the token on the server and reuses the form's application UUID on resubmission.

Run FastAPI, the worker, and the UI as described in the README. Create a job, and set `INTAKE_API_KEY` in the API's `.env`. In a separate terminal:

```sh
cd apps/api
export INTAKE_API_KEY='<same-token-as-the-api>'
export ROLELENS_JOB_ID='<job-id-from-the-inbox>'
export ROLELENS_API_URL='http://127.0.0.1:8000'
uv run uvicorn --app-dir ../../examples/careers-form app:app --host 127.0.0.1 --port 9000
```

Open `http://localhost:9000` and submit an invented resume. The application appears in the job inbox and processes automatically. The browser suite exercises this flow with actual HTTP requests, a real worker, and a temporary database; Jev stays disabled in these tests.

The example is an integration reference, not a production careers site. Your existing handler should forward the application using its own durable application ID and delivery retry/outbox mechanism. Reviewer authentication, public intake hardening, rate limits, workspace scopes, retention controls, and production secrets management are still required before exposing RoleLens publicly.

## Named connectors

A proper ATS connector must map source job IDs to RoleLens jobs, validate provider-specific authentication/signatures, handle pagination and rate limits during backfills, receive incremental applications, securely retrieve attachments, persist source cursors, and reconcile delivery retries and updates. Write-back should be an explicit supported operation. Generic request samples do not establish these guarantees.

Choose the target ATS and available API permissions before implementing its adapter. This API is the receiving boundary such adapters can use; it is not advertised as compatibility with any ATS.

## Repeat the synthetic intake check

Use an isolated test deployment with Jev disabled on both API and worker. Set `ROLELENS_API_URL` and `INTAKE_API_KEY` on the caller, then run from `apps/api`:

```sh
uv run python ../../scripts/check_intake.py
```

It creates a clearly labeled synthetic job, submits 1,000 text applications through authenticated HTTP intake, verifies repeated receipts, waits for the worker to finish, and checks paginated metadata. It intentionally leaves those invented records in that test database for inspection. This validates the pipeline contract, not production capacity or hosted-model inference. The browser suite uses temporary records and deletes its test database on shutdown.
