# RoleLens

Evidence-based resume review, built to self-host.

RoleLens helps reviewers compare what a resume says against explicit job requirements. Each finding should link to its source text and distinguish supporting evidence, partial evidence, missing mentions, and uncertainty. Reviewers retain the hiring decision.

## Project status

Active development. The first application change will arrive through a reviewed pull request. RoleLens is not yet an enterprise-ready release.

## Direction

- Next.js, React, and TypeScript for the reviewer workspace.
- FastAPI and Python for document parsing and assessment.
- Jev for narrow, typed evidence judgments through a replaceable provider interface.
- Docker Compose for a reproducible local deployment.

Self-hosting the application does not imply local model inference: using the hosted Jev provider sends assessment input to TypeSafe. Deployment documentation will describe this data flow.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). We welcome reproducible bug reports, documentation fixes, and focused pull requests. Use synthetic resumes in public examples and reports.

## License

[MIT](LICENSE).
