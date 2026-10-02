# Automatic matching and shortlist workflow

Create a job from a JD and bulk import resumes. OpenAI prepares source-linked criteria and Jev verifies them; workers extract and assess each resume. Applicants meeting the current screening rules enter the shortlist automatically. Open **Shortlists** to download CSV or original resumes, optionally inspect evidence, or adjust the rules. No JD confirmation or applicant approval is required.

The default threshold is **100%** of required and unspecified criteria. Preferred and interview-only criteria are excluded by default and remain visible in the included/excluded list. Separate-verification criteria stay included; uncertain source interpretations and unverifiable requirements stay unresolved rather than silently passing. Simple dated employment requirements can still be supported automatically. Jobs with no selected criteria do not shortlist anyone.

**Adjust screening rules** changes the threshold (1–100%) and included criteria. Match percentage means fully supported selected criteria divided by selected criteria; partial and unclear evidence receive no credit. Selection compares integer counts without rounding. Model confidence is separate from match coverage. A 100% match is not a claim of verified ability or model certainty.

Results are **Shortlisted**, **Below threshold**, **Inconclusive**, **Processing**, or **Processing failed**. Inconclusive means uncertainty could change the outcome, no criteria were selected, or findings are stale/sample results. Findings that are already below the threshold even if all unresolved criteria were supported remain below threshold. Sample and older assessments never qualify automatically.

Policies have versions and reject stale saves. Selection is derived from persisted summaries using the current policy in SQL, so changing rules does not call the models or rewrite applicants. Corrections immediately change the effective findings and shortlist. Changing criterion wording still requires a new job and assessment.

## Research behind the matcher

[TypeSafe's Jev 1.13 guidance](https://docs.typesafe.ai/model-jaggedness/jev-1.13) identifies literal interpretation, compound judgments, date arithmetic, and irrelevant context as failure modes. This implementation uses narrow questions about selected source passages; code owns ALL/ANY aggregation and date arithmetic. It does not ask Jev to generate explanations. The displayed explanations describe the code's method and available evidence.

## What is automatic

1. OpenAI interprets the JD once into source-linked requirements. Prompt `jd-interpretation-v6` also proposes simple ALL/ANY components, preserving constraints and alternatives. The job definition is saved automatically; preview and edits are optional. Strict schemas, source checks, and Jev verification reduce errors without proving the interpretation correct.
2. Code retrieves up to three relevant extracted passages per component. Each passage receives a narrow Jev question. Small batches of 24 questions limit context distraction. Model choices and distributions are validated; malformed responses fail instead of becoming positive evidence.
3. Code combines component statuses. React **and** TypeScript requires supported applied-work evidence for both. SQL **or** NoSQL can be supported by either. A literal skills-list mention is partial evidence, never proof of applied experience. Missing named signals refer only to extracted text, not absent ability.
4. For simple minimum-years requirements, code parses explicit employment date ranges, asks Jev whether each employment block establishes the requested scope, then unions relevant intervals. Overlapping roles count once. Unknown months/days produce conservative whole-month bounds. A general “five years in industry” summary is insufficient for “four years full stack.” Education, personal projects, mixed thresholds, and exemptions do not become automatic tenure calculations.
5. A paginated SQL query returns comparison metadata without loading all source documents. Criterion filters, search, unresolved filters, and automatic-shortlist filters work on saved summaries.

`WORKER_CONCURRENCY` defaults to two applications per worker, configurable from one to eight. Additional workers retain the existing transaction/lease protections. Each application may make several hosted requests; this change is not a validated production throughput benchmark. [TypeSafe's model limits](https://docs.typesafe.ai/models) still apply. There is no global quota coordinator across worker replicas.

## Refreshes and exports

Older assessments are labeled **Refresh needed** and do not qualify until refreshed. **Refresh matching** reuses extracted text, archives findings and corrections, and queues Jev assessment. Pending applicants leave the shortlist and qualify again as assessment completes. OCR is not rerun; an OCR fix requires a corrected document/import. Corrections and policy edits have separate versions and reject stale writes.

Original uploads are retained for downloads. ZIP exports contain only currently matching applicants, with limits of 100 documents and 50 MB. Missing originals are reported. CSV is generated on the server from one policy snapshot and a single streamed SQL result, independently of UI pagination and display filters. It contains match counts, threshold, policy version, decision, and evidence counts; formula-like values are escaped. Empty CSV exports contain a header. Legacy approval snapshots are retained as history but no longer control shortlist membership.

Run `uv run alembic upgrade head` before restarting API and workers. The migration preserves documents, original assessments, corrections, and legacy approvals, annotates existing summaries with sample provenance, and prevents unverified source criteria from qualifying through old positive findings. Existing jobs receive the default rules on read.

The database and backups now retain original files, extracted text, assessments, history, and approvals. Operators must establish access and retention policies. Deletion/retention administration, authenticated editor identities, tenant permissions, and a complete audit history are not implemented. Workspace endpoints use a server-held token, but the development browser proxy does not provide user login. Keep this preview isolated rather than exposing it as an enterprise service.

## Known limits and validation

The fallback for older jobs uses a finite technical alias registry. Unknown skills and nested boolean expressions remain whole semantic conditions. Retrieval can miss evidence; English headings/date formats and OCR errors can leave tenure unresolved. Generic criteria are not declared globally absent from only a retrieved subset. Injection boundaries and obvious-pattern exclusion are defenses with tests, not a complete adversarial guarantee. Four source interpretations already flagged for verification in an older job remain flagged; refreshing evidence does not silently rewrite that job's criteria.

Unit/integration tests cover logical groups, missing components, uncertain responses, negation, injection examples, overlapping dates, non-employment exclusions, threshold boundaries, pagination, stale policy edits, cross-job isolation, authorization, document retention, correction-aware filters, and worker concurrency. Browser tests use fictional persisted records and exercise automatic shortlisting, optional evidence inspection, rule changes, CSV/ZIP downloads, and narrow screens with hosted calls disabled. PostgreSQL CI repeats intake and comparison endpoint checks.

Small live smoke trials can establish that the provider integration runs, but cannot establish accuracy, fairness, hiring quality, or cost/latency superiority. Those claims need a separately labeled evaluation dataset, pinned model versions, measured provider usage, and suitable assessment of errors. Do not publish the user's real resumes as benchmark fixtures.
