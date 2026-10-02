from datetime import date

from rolelens.matching import (
    combine,
    duration_bounds,
    employment_periods,
    minimum_months,
    targets,
    union_months,
)
from rolelens.schemas import EvidenceStatus as S


def test_all_and_any_preserve_alternatives():
    assert targets("React and TypeScript usage")[1] == "ALL"
    assert targets("SQL and/or NoSQL databases")[1] == "ANY"
    assert combine([S.SUPPORTED, S.NOT_MENTIONED], "ALL") == S.PARTIAL
    assert combine([S.SUPPORTED, S.NOT_MENTIONED], "ANY") == S.SUPPORTED
    assert (
        targets("React and TypeScript or Angular")[0][0]["label"]
        == "React and TypeScript or Angular"
    )


def test_overlap_is_not_double_counted():
    assert union_months([(0, 24), (12, 36), (0, 12)]) == 36


def test_employment_excludes_education_and_projects():
    text = """Education
Bachelor degree 2015 - 2019
Projects
Website 2020 - 2025
Work Experience
Full Stack Developer, Example Company
Jan 2020 - Dec 2024
Built frontend and backend applications.
"""
    periods = employment_periods(text, date(2026, 10, 2))
    assert len(periods) == 1
    assert periods[0]["date_quote"] == "Jan 2020 - Dec 2024"
    assert duration_bounds(periods) == (58, 60)
    assert periods[0]["quote"] in text


def test_year_only_dates_have_bounds_and_future_dates_are_not_counted():
    text = "Experience\nEngineer\n2020 - 2024\nBuilt APIs.\n\nEngineer\n2028 - 2030\nPlanned work."
    p = employment_periods(text, date(2026, 10, 2))
    assert len(p) == 1
    assert duration_bounds(p) == (36, 60)
    assert minimum_months("4+ years of full stack experience") == 48
    assert minimum_months("15 years full time education") is None
    assert minimum_months("2-4 years experience") is None


def test_present_uses_explicit_as_of_and_does_not_infer_years_from_summary():
    assert employment_periods("Engineer with 5 years in the industry.", date(2026, 10, 2)) == []
    p = employment_periods(
        "Experience\nEngineer\nJan 2024 - Present\nBuilt APIs.", date(2026, 10, 2)
    )
    assert duration_bounds(p) == (32, 34)


def test_ambiguous_or_exempted_duration_does_not_become_a_numeric_gate():
    assert minimum_months("4 years experience or equivalent projects") is None
    assert minimum_months("4 years experience and 2 years Node.js experience") is None
    assert minimum_months("0 years experience") is None
    assert minimum_months("0.3 years experience") == 4


def test_unverified_minimum_years_is_not_sent_for_tenure_assessment():
    import asyncio
    from types import SimpleNamespace

    from rolelens.evidence_matcher import assess_evidence
    from rolelens.schemas import AssessmentRequest

    class Provider:
        settings = SimpleNamespace(typesafe_model="synthetic", model_confidence_floor=0.65)

        async def _evaluate(self, *_args):
            raise AssertionError("Unverified JD criteria must not become tenure questions.")

    request = AssessmentRequest(
        resume_text="Experience\nEngineer\nJan 2020 - Dec 2025\nBuilt React applications.",
        requirements=[
            {
                "id": "years",
                "text": "Minimum 3 years React experience",
                "assessment_mode": "VERIFY_SEPARATELY",
                "source_validation": "REVIEW",
            }
        ],
    )
    assessment = asyncio.run(assess_evidence(Provider(), request))
    assert assessment.findings[0].status == S.UNCLEAR
    assert assessment.findings[0].method == "separate_verification"
