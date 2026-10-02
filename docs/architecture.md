# Architecture and current boundaries

## Request path

```text
Browser → Next.js same-origin proxy → FastAPI
                                      ├─ document parser
                                      └─ assessment provider → TypeSafe's hosted Jev API
```

Next.js renders the reviewer workspace. Its server-side proxy permits only the four documented API operations. Backend URLs and Jev credentials are not exposed to the browser. FastAPI owns parsing, request validation, provider calls, source selection, and response validation. No database exists in this first change.

## Assessment

1. A reviewer enters up to twelve explicit requirements.
2. The parser produces resume text and verbatim source passages. It does not rewrite claims.
3. One Jev request selects a relevant passage or `NONE` for each requirement against the whole resume.
4. A second request classifies each selected passage against its corresponding requirement.
5. Code checks the returned choices and distributions, resolves passage IDs to original text, and applies an uncertainty threshold. An irrelevant selected passage produces `UNCLEAR`, not an absence claim about the entire resume.
6. The reviewer inspects, corrects, annotates, and exports the findings.

A supporting resume statement is not verified competence. The application provides no suitability score, candidate ranking, or automated hiring decision. Confidence is a model signal, not a probability of job performance. Numerical tenure checks deliberately require clarification.

Two stages improve source consistency but do not guarantee accurate judgments. The provider's selection can miss relevant text, and one cited passage can omit context. The confidence floor is a configurable development default; it has not been calibrated on a hiring dataset. Evaluation of model accuracy is separate from mocked integration tests.

## Data handling

Uploaded PDF, DOCX, and UTF-8 TXT files have a 5 MB limit. PDF uploads are limited to twenty pages; extracted text is limited to 24,000 characters. DOCX archives are inspected for excessive entry count and unpacked size before parsing. Scanned documents and encrypted PDFs are rejected with an actionable error.

FastAPI reads uploaded files and closes them after parsing. The multipart framework may spool larger files to temporary storage, which is closed after the request. RoleLens does not retain source files or assessment records. The browser holds extracted text, findings, reviewer corrections, and notes in React memory. Refreshing loses the session; CSV export preserves a local copy. Application code does not log resume content or provider credentials.

Live assessment sends resume passages and requirements to `https://api.typesafe.ai/v1/systemone`. This includes any personal details still present in the supplied passages. Provider retention, residency, and contractual settings must be checked with TypeSafe separately; RoleLens does not control them. Sample findings are fixed synthetic fixtures with no generated confidence values and no model calls.

## Deployment boundary

This is a local development preview. There is no authentication, authorization, tenant isolation, persistent audit history, rate limiting, or parser process sandbox. Do not expose this version to a shared or public network. Docker Compose binds the web server to localhost and keeps FastAPI on the internal container network. A configured backend key enables paid hosted model calls for anyone with access to the local app.

## Next changes

- Add persistent roles, document records, and assessment versions with database migrations.
- Add authentication and workspace permissions before supporting shared deployments.
- Preserve original findings and reviewer edits in an audit history.
- Add a background processing queue, resource isolation, and request limits for batches.
- Establish a synthetic evaluation set for evidence selection, missing mentions, ambiguity, and adversarial resume content.
- Add an assessment provider selected through explicit configuration, with parity tests for alternatives.
