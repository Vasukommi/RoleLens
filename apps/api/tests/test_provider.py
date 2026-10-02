import asyncio
import json

import httpx
import pytest

from rolelens.config import Settings
from rolelens.providers import JevProvider, ProviderError
from rolelens.schemas import AssessmentRequest, EvidenceStatus

REQUEST = AssessmentRequest(
    resume_text="Synthetic engineer\n\nBuilt and maintained React applications using TypeScript.",
    requirements=[{"id": "react", "text": "Built React applications"}],
)


def provider(transport):
    return JevProvider(Settings(typesafe_api_key="test-key", _env_file=None), transport)


def answer(options, choice, confidence=0.9):
    return {
        "type": "choice",
        "choice": choice,
        "confidence": confidence,
        "probabilities": {option: 1.0 if option == choice else 0.0 for option in options},
    }


def test_verbatim_evidence_is_checked_in_second_stage():
    calls = []

    def handler(request):
        data = json.loads(request.content)
        calls.append(data)
        questions = data["questions"]
        if "e0" in questions:
            result = answer(questions["e0"]["criteria"], "p2")
            return httpx.Response(200, json={"model": "jev-test", "answers": {"e0": result}})
        assert (
            data["state"]["r0"]["source"]
            == "Built and maintained React applications using TypeScript."
        )
        result = answer(questions["r0"]["criteria"], "SUPPORTED")
        return httpx.Response(200, json={"model": "jev-test", "answers": {"r0": result}})

    assessment = asyncio.run(provider(httpx.MockTransport(handler)).assess(REQUEST))
    assert len(calls) == 2
    assert assessment.findings[0].status == EvidenceStatus.SUPPORTED
    assert assessment.findings[0].evidence.text in REQUEST.resume_text
    assert not assessment.is_sample


def test_uncertain_evidence_selection_is_not_promoted_to_supported():
    def handler(request):
        questions = json.loads(request.content)["questions"]
        result = answer(questions["e0"]["criteria"], "p2", 0.3)
        return httpx.Response(200, json={"model": "jev-test", "answers": {"e0": result}})

    assessment = asyncio.run(provider(httpx.MockTransport(handler)).assess(REQUEST))
    assert assessment.findings[0].status == EvidenceStatus.UNCLEAR


def test_irrelevant_selected_passage_is_not_proof_of_absence():
    def handler(request):
        questions = json.loads(request.content)["questions"]
        key = next(iter(questions))
        choice = "p2" if key == "e0" else "NOT_MENTIONED"
        result = answer(questions[key]["criteria"], choice)
        return httpx.Response(200, json={"model": "jev-test", "answers": {key: result}})

    assessment = asyncio.run(provider(httpx.MockTransport(handler)).assess(REQUEST))
    assert assessment.findings[0].status == EvidenceStatus.UNCLEAR


def test_missing_mention_uses_whole_resume_selection():
    def handler(request):
        questions = json.loads(request.content)["questions"]
        result = answer(questions["e0"]["criteria"], "NONE")
        return httpx.Response(200, json={"model": "jev-test", "answers": {"e0": result}})

    assessment = asyncio.run(provider(httpx.MockTransport(handler)).assess(REQUEST))
    assert assessment.findings[0].status == EvidenceStatus.NOT_MENTIONED
    assert assessment.findings[0].evidence is None


@pytest.mark.parametrize(
    "malformed",
    [
        {"model": "jev-test", "answers": {}},
        {
            "model": "jev-test",
            "answers": {
                "e0": {
                    "type": "choice",
                    "choice": "invented",
                    "confidence": 0.9,
                    "probabilities": {"invented": 1.0},
                }
            },
        },
    ],
)
def test_invalid_responses_never_become_findings(malformed):
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=malformed))
    with pytest.raises(ProviderError, match="invalid assessment"):
        asyncio.run(provider(transport).assess(REQUEST))


def test_upstream_error_does_not_expose_provider_body():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(401, text="secret-upstream-details")
    )
    with pytest.raises(ProviderError) as caught:
        asyncio.run(provider(transport).assess(REQUEST))
    assert "secret-upstream-details" not in str(caught.value)
