from rolelens.documents import make_passages

REQUIREMENTS = [
    {"id": "react", "text": "Built and maintained React applications"},
    {"id": "typescript", "text": "Used TypeScript in application development"},
    {"id": "testing", "text": "Written automated tests for web applications"},
    {"id": "accessibility", "text": "Implemented accessible user interfaces"},
    {"id": "aws", "text": "Deployed applications on AWS"},
]

SAMPLE_RESUMES = [
    (
        "sample-maya",
        "Maya Chen",
        "Frontend engineer",
        "Maya Chen — Synthetic resume\n\n"
        "Frontend engineer, Example Studio\n"
        "Built and maintained React applications using TypeScript for a customer dashboard. "
        "Wrote Playwright end-to-end tests and React Testing Library component tests. "
        "Implemented keyboard navigation, accessible form labels, "
        "and screen-reader announcements.\n\n"
        "Skills: React, TypeScript, CSS, Playwright, AWS.\n"
        "This is invented sample data for exploring RoleLens.",
        ["SUPPORTED", "SUPPORTED", "SUPPORTED", "SUPPORTED", "PARTIAL"],
    ),
    (
        "sample-noah",
        "Noah Williams",
        "Software engineer",
        "Noah Williams — Synthetic resume\n\n"
        "Software engineer, Example Labs\n"
        "Built internal applications with React and TypeScript. "
        "Deployed a web application to AWS using an existing deployment pipeline.\n\n"
        "Skills: React, TypeScript, AWS.\n"
        "This is invented sample data for exploring RoleLens.",
        ["SUPPORTED", "SUPPORTED", "NOT_MENTIONED", "NOT_MENTIONED", "SUPPORTED"],
    ),
    (
        "sample-aria",
        "Aria Patel",
        "Web developer",
        "Aria Patel — Synthetic resume\n\n"
        "Web developer, Example Collective\n"
        "Maintained a JavaScript website and wrote automated browser tests. "
        "Worked on UI accessibility, but implementation responsibilities are not specified.\n\n"
        "Skills: React, JavaScript, HTML, CSS.\n"
        "This is invented sample data for exploring RoleLens.",
        ["PARTIAL", "NOT_MENTIONED", "SUPPORTED", "UNCLEAR", "NOT_MENTIONED"],
    ),
]


def sample_workspace() -> dict:
    candidates = []
    for identifier, name, headline, text, statuses in SAMPLE_RESUMES:
        passages = make_passages(text)
        findings = []
        for requirement, status in zip(REQUIREMENTS, statuses, strict=True):
            evidence = None if status == "NOT_MENTIONED" else passages[1].model_dump()
            if identifier == "sample-maya" and requirement["id"] == "aws":
                evidence = next(p for p in passages if "Skills:" in p.text).model_dump()
            if identifier == "sample-aria" and requirement["id"] == "react":
                evidence = next(p for p in passages if "Skills:" in p.text).model_dump()
            findings.append(
                {
                    "requirement_id": requirement["id"],
                    "status": status,
                    "evidence": evidence,
                    "confidence": None,
                    "probabilities": None,
                }
            )
        candidates.append(
            {
                "id": identifier,
                "name": name,
                "headline": headline,
                "filename": f"{identifier}.txt",
                "text": text,
                "passages": [p.model_dump() for p in passages],
                "assessment": {
                    "findings": findings,
                    "model": "synthetic-fixture",
                    "is_sample": True,
                },
            }
        )
    return {
        "role_title": "Frontend Engineer",
        "requirements": REQUIREMENTS,
        "candidates": candidates,
    }
