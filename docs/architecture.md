# Intake, processing, and review architecture

Scanned and hybrid PDFs use local English OCR for pages with fewer than 30 extracted characters. PDFium renders each page within a six-million-pixel budget, and Tesseract reads the rendered image. Each OCR subprocess has a 25-second timeout and the document has a 120-second elapsed-time budget checked around page processing. Native rendering is not a separately sandboxed process. The worker renews its lease during extraction. Missing OCR software or unusable scans fail visibly instead of producing invented text.

Extraction provenance is stored as `native`, `ocr`, or `mixed`; reviewers see a notice for OCR-derived text. Evidence passages are substrings of the extracted text, which may contain OCR errors. Original upload bytes are cleared after extraction in this version, so verifying transcription requires retaining the original document in the source system. No OCR accuracy claim or automatic hiring decision follows from this extraction.

```text
Careers site / future source adapter ── authenticated intake API ──┐
                                                                 │
Reviewer → Next.js → bulk upload / jobs API ───────────────────────┤
                                                                 ▼
                                    PostgreSQL (SQLite locally)
                                    jobs + applications + receipts
                                              │
                                              ▼
                                   Separate leased queue worker
                                    ├─ bounded document parsing
                                    └─ evidence provider → hosted Jev
                                              │
                                              ▼
                              persisted original findings + review edits
                                              │
                                              ▼
                                    paginated reviewer inbox
```

## Acceptance and duplicate delivery

An intake transaction stores the application and queue state together. There is no second broker publication that can be lost between database commit and scheduling. A unique job/delivery key resolves concurrent duplicate submissions. Integrated sources key by source and stable external application ID; manual bulk import keys by document hash within the job. Changed content under an existing source ID is a conflict, not a silent overwrite.

Bulk selection uploads three files concurrently, each bounded to 5 MB. Per-file receipt UUIDs survive retries within that browser session, so an uncertain upload response does not create another application or count another receipt. Batch records show expected versus received deliveries. Closing the tab stops files not yet uploaded; already accepted applications remain durable and process independently. Reimporting unsubmitted files is safe, with duplicate detection for already received documents.

API and Next.js cap request bodies at 6 MB. Job lists contain only metadata, with server-side search/status filtering and fifty rows per page. Full text and findings load for the selected application.

## Queue guarantees

The separate worker claims work with an atomic database update and a unique expiring lease. PostgreSQL skips rows locked by another claim; a second conditional check prevents duplicate ownership. SQLite is supported for single-host development. Lease renewal runs during parsing and hosted calls; expired work is reclaimable after worker termination. Writes carry the lease token so a replaced worker cannot publish its old result.

Provider failures back off exponentially, capped at five minutes, for a bounded number of attempts. Invalid documents fail individually. Repeated hard interruptions also stop automatic processing. With no Jev key, documents parse and become `AWAITING_PROVIDER`; a worker restarted with a key automatically resumes them. Worker heartbeat freshness is visible in the UI.

This is **at-least-once processing**, not exactly-once external inference. A worker can die after a paid provider response but before committing it, causing a repeated call on recovery. Inbound delivery deduplication prevents repeated submissions from scheduling duplicate applications; it does not eliminate this external side-effect window. Live quotas, cost ceilings, parser isolation, retention, and capacity monitoring require further work.

The implementation uses SQLAlchemy's [DML/RETURNING support](https://docs.sqlalchemy.org/en/20/core/dml.html). Processing is independent of HTTP request lifetimes, consistent with FastAPI's [guidance on heavier background work](https://fastapi.tiangolo.com/tutorial/background-tasks/#caveat).

## Evidence and saved reviews

Jobs contain fixed criteria for this version. Jev first selects a source passage for each criterion, then classifies that selected passage using closed-set questions. Response choices/distributions are checked, IDs resolve to verbatim text, and low confidence or irrelevant evidence retains uncertainty. The model does not rank candidates or decide hiring outcomes.

Original findings stay separate from reviewer overrides and notes. A version check rejects stale review writes rather than losing a concurrent update. This retains original model output and the latest review, **not** a complete authenticated audit trail of every editor and edit. Full audit history and role revisions remain future work.

A resume claim is not verified competence, and missing mentions are not proof of absent skills. The confidence floor is an uncalibrated development default. Model evaluation and production throughput testing are separate from integration tests with synthetic responses.

## Stored candidate data

Pending/failed source bytes, extracted text, source IDs, original assessments, and reviewer data are stored in the database. Source bytes are cleared after successful extraction; failures retain bytes so parsing can be retried. Extracted text and review records persist. The Compose `database` volume therefore contains candidate information and must be protected, backed up, and governed by a retention policy. Deletion/retention administration is not implemented yet.

PDFs are limited to twenty pages, DOCX unpacked content to 15 MB, and extracted text to 24,000 characters. Scanned/encrypted documents fail clearly; there is no OCR. Multipart uploads may spool to temporary disk before acceptance. Application logs exclude source text, credentials, and provider response bodies.

Live inference sends passages and requirements to TypeSafe. Self-hosting the app does not imply local inference, residency guarantees, or control over the hosted provider's retention. Verify provider arrangements separately. Synthetic fixtures remain at `/demo` and are never automatically ingested into real jobs.

## Current deployment boundary

Compose starts PostgreSQL, migrations, FastAPI, a worker, and Next.js. Only the web port is published, bound to localhost. Programmatic intake requires a separate bearer token and is not forwarded by the browser proxy. Human reviewer endpoints currently rely on the isolated local deployment; they have no user authentication, permissions, tenant isolation, or public service protections. Do not expose this preview to shared/public networks.
