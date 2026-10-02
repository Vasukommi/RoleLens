"""Transparent evidence counts. No candidate fitness probabilities or automatic selection."""

from rolelens.matching import PROTOCOL


def evidence_summary(requirements: list[dict], assessment: dict | None, overrides=None) -> dict:
    result = {
        priority: {
            "total": 0,
            "supported": 0,
            "partial": 0,
            "not_mentioned": 0,
            "unclear": 0,
            "verification": 0,
        }
        for priority in ("REQUIRED", "PREFERRED", "UNSPECIFIED")
    }
    by_id = {f["requirement_id"]: f for f in (assessment or {}).get("findings", [])}
    for requirement in requirements:
        group = result[requirement.get("priority", "UNSPECIFIED")]
        group["total"] += 1
        finding = by_id.get(requirement["id"], {})
        status = (overrides or {}).get(requirement["id"], finding.get("status", "UNCLEAR"))
        group[status.lower()] += 1
        if finding.get("method") == "separate_verification" or (
            requirement.get("assessment_mode", "RESUME_EVIDENCE") != "RESUME_EVIDENCE"
            and finding.get("method") != "dated_employment"
        ):
            group["verification"] += 1
    result["protocol"] = (assessment or {}).get("protocol", "legacy-single-passage")
    result["needs_refresh"] = assessment is not None and result["protocol"] != PROTOCOL
    result["required_complete"] = result["REQUIRED"]["total"] > 0 and (
        result["REQUIRED"]["supported"] == result["REQUIRED"]["total"]
    )
    result["unresolved"] = sum(
        g["unclear"] for g in [result[p] for p in ("REQUIRED", "PREFERRED", "UNSPECIFIED")]
    )
    result["findings"] = {
        key: (overrides or {}).get(key, finding["status"]) for key, finding in by_id.items()
    }
    return result
