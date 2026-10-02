# Try the sample workflow

RoleLens receives resumes, processes them in the background, and helps reviewers inspect evidence against explicit job requirements. The [short product video](demo-assets/rolelens-demo-short.mp4) shows bulk intake, a careers-form integration, and a saved review.

## Create a sample job

Start the API, worker, and frontend following the [README](../README.md). Configure a TypeSafe key for live assessments; otherwise documents parse and wait for provider configuration.

Open [localhost:3000](http://localhost:3000), click **New job**, and enter a title such as “Backend Engineer — sample.” Add these requirements, one per line:

```text
Built Python APIs
Worked with PostgreSQL databases
Deployed services on AWS
Wrote automated tests using pytest
Operated Kafka pipelines
```

## Import and review

Download or copy the [fictional sample resume](../examples/demo/fictional-resume.txt), then select it through **Import resumes**. You can select multiple documents together. The API stores accepted applications before the worker extracts their text and performs live assessment.

Open the application when processing finishes. Select a requirement to inspect its source passage. Findings are **Supported**, **Partial evidence**, **Not mentioned**, or **Needs clarification**; model results may vary. A skill appearing in a list is less evidence than a described project, and missing resume evidence does not establish missing ability.

Add a follow-up note, apply a reviewer correction if appropriate, and click **Save review**. Refresh and reopen the application to confirm your work persisted. **Export** downloads the review as CSV. Original model findings are stored separately from reviewer corrections.

For applications arriving automatically, follow the [careers-form integration example](integrations.md). It forwards documents using a server-held intake token; no dedicated ATS connector is implemented yet.

## What the video demonstrates

The recorded batch used 200 randomly selected PDFs from mixed job categories. After local OCR and live assessment, 199 were ready for review and one yielded too little usable text. Processing wait was cut and labeled. The public footage shows aliases and counts for the batch; the close-up review uses the fictional profile above.

This is a workflow demonstration, not an evaluation of model accuracy, fairness, applicant suitability, or production capacity. Raw dataset documents are not distributed with the project. OCR-derived text can contain transcription errors and should be verified against the original document. RoleLens remains a development preview with reviewer authentication, permissions, and retention administration unfinished.
