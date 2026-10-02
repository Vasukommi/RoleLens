"""Deterministic selection from evidence, independent of model confidence."""

from rolelens.matching import PROTOCOL
from rolelens.schemas import ScreeningPolicy


def default_policy(requirements: list[dict]) -> dict:
    return ScreeningPolicy(
        criterion_ids=[
            r["id"]
            for r in requirements
            if r.get("priority", "UNSPECIFIED") != "PREFERRED"
            and r.get("assessment_mode") != "INTERVIEW"
        ]
    ).model_dump()


def selection(screening: dict | None, status: str, policy: dict) -> dict:
    screening = screening or {}
    findings = screening.get("findings", {})
    ids = policy["criterion_ids"]
    matched = sum(findings.get(key) == "SUPPORTED" for key in ids)
    unresolved = sum(findings.get(key, "UNCLEAR") == "UNCLEAR" for key in ids)
    total = len(ids)
    percentage = round(100 * matched / total, 1) if total else None
    if status == "FAILED":
        decision, reason = "FAILED", "Resume processing failed."
    elif status != "READY":
        decision, reason = "PENDING", "Waiting for resume assessment."
    elif screening.get("protocol") != PROTOCOL:
        decision, reason = "INCONCLUSIVE", "Refresh this older assessment."
    elif screening.get("is_sample"):
        decision, reason = "INCONCLUSIVE", "Sample findings cannot qualify a real application."
    elif not total:
        decision, reason = "INCONCLUSIVE", "Choose at least one screening criterion."
    elif matched * 100 >= policy["threshold"] * total:
        decision, reason = "SHORTLISTED", "Meets the configured screening threshold."
    elif (matched + unresolved) * 100 >= policy["threshold"] * total:
        decision, reason = "INCONCLUSIVE", "Unresolved evidence could change this result."
    else:
        decision, reason = "NOT_MATCHED", "Below the configured screening threshold."
    return dict(
        status=decision,
        reason=reason,
        matched=matched,
        total=total,
        unresolved=unresolved,
        percentage=percentage,
        threshold=policy["threshold"],
    )
