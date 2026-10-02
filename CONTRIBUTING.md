# Contributing to RoleLens

## Start with a focused change

For substantial changes, open an issue describing the user problem and proposed scope before implementation. Documentation fixes and small bug fixes can go straight to a pull request. Contributor participation does not require sharing real candidate data or an API key.

## Branches and commits

Create a branch from `main`, for example `feat/resume-upload`, `fix/document-parsing`, or `docs/deployment`.

Use descriptive commits with a conventional prefix:

```text
feat(api): parse resume documents with source passages
fix(web): retain reviewer notes when switching candidates
docs: explain hosted model data flow
```

Explain consequential choices in the commit body. Keep unrelated changes in separate commits and pull requests. Open draft PRs early for work in progress; mark them ready only after the documented checks pass. Application work reaches `main` through pull requests.

## Pull requests

Describe the problem, resulting behavior, validation performed, and material limitations. Include screenshots for UI changes and reproduction steps for fixes. A PR should be reviewable by someone who has not seen the original conversation.

Run the checks documented in the README for the affected application. Meaningful tests should cover user-visible behavior, failure handling, and data boundaries. Hosted model accuracy claims must identify their evaluation dataset and model version.

## Candidate data and assessment behavior

Use invented names and synthetic resumes in fixtures, screenshots, and issue reports. Never commit credentials or real resumes. Assess explicit job-related requirements, preserve uncertainty, and keep source references inspectable. Missing evidence is not proof of missing ability. Automatic shortlist selection must use explicit, configurable screening rules, preserve unresolved findings, and distinguish resume evidence from verified ability.

## License

Contributions are provided under the repository's MIT license. Preserve attribution for reused code and verify license compatibility.
