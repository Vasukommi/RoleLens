"""Deterministic evidence retrieval, component aggregation, and dated experience.

None of these functions makes a hiring decision. Literal mentions are partial evidence,
not verified ability; semantic support still comes from Jev.
"""

import re
from datetime import date
from math import ceil

from rolelens.schemas import EvidenceStatus as Status
from rolelens.schemas import Passage

PROTOCOL = "evidence-comparison-v1"
SKILLS = {
    "React": r"\breact(?:\.?(?:js|native))?\b",
    "TypeScript": r"\btypescript\b",
    "Node.js": r"\bnode(?:\.?js)\b",
    "JavaScript": r"\bjavascript\b",
    "SQL": r"\b(?:sql|postgresql|postgres|mysql|sqlite|mssql|oracle)\b",
    "NoSQL": r"\b(?:nosql|mongodb|dynamodb|cassandra|couchdb)\b",
    "Python": r"\bpython\b",
    "Java": r"\bjava\b",
    "Git": r"\bgit\b",
    "CI/CD": (
        r"\b(?:ci\s*/\s*cd|continuous integration|continuous delivery|"
        r"github actions|jenkins)\b"
    ),
    "AWS": r"\b(?:aws|amazon web services)\b",
    "Azure": r"\bazure\b",
    "Google Cloud": r"\b(?:google cloud|gcp)\b",
    "Docker": r"\bdocker\b",
    "Kubernetes": r"\b(?:kubernetes|k8s)\b",
    "Redis": r"\bredis\b",
    "REST APIs": r"\b(?:rest(?:ful)?\s*(?:api|apis|services)|restful)\b",
    "RBAC": r"\b(?:rbac|role.based access control)\b",
    "microservices": r"\bmicroservices?\b",
}
STOP = set(
    "the and with from that this have experience relevant work using usage ability strong "
    "knowledge understanding familiarity modern systems development design of in to or "
    "a an for as such building developing maintaining skills required software".split()
)
INJECTION = re.compile(
    r"ignore (?:all |the |previous )*instructions|ignore previous|"
    r"(?:mark|rate|rank) (?:me|this|the candidate).*?(?:supported|best|100)|"
    r"system prompt|you are (?:an? |the )?(?:ai|assistant)",
    re.I,
)
NEGATION = re.compile(r"\b(?:no experience|never used|not experienced|without experience)\b", re.I)


def targets(text: str) -> tuple[list[dict], str]:
    """Split named technical signals, preserving the parent criterion and ALL/ANY meaning.

    A finite alias vocabulary gives older saved jobs usable components without regenerating
    their definition. Unrecognized/nested conditions stay one semantic question.
    """
    hits = []
    for label, pattern in SKILLS.items():
        # Aliases describe resumes; the JD must actually name the canonical skill.
        jd_pattern = r"\b" + re.escape(label).replace(r"\ ", r"\s+") + r"\b"
        if label == "Node.js":
            jd_pattern = r"\bnode(?:\.?js)\b"
        if label == "REST APIs":
            jd_pattern = r"\brest(?:ful)?\s*apis?\b"
        match = re.search(jd_pattern, text, re.I)
        if match:
            hits.append((match.start(), label, pattern))
    hits.sort()
    if len(hits) > 8 or (
        re.search(r"\bor\b", text, re.I)
        and re.search(r"\band\b", text, re.I)
        and not re.search(r"and/or|such as", text, re.I)
    ):
        return [{"label": text, "pattern": None}], "ALL"
    if len(hits) == 1:
        return [{"label": text, "pattern": hits[0][2]}], "ALL"
    if not hits:
        return [{"label": text, "pattern": None}], "ALL"
    operator = "ANY" if re.search(r"\bor\b|and/or|such as", text, re.I) else "ALL"
    return [{"label": label, "pattern": pattern} for _, label, pattern in hits], operator


def retrieve(passages: list[Passage], criterion: str, target: dict) -> list[Passage]:
    terms = {w.lower() for w in re.findall(r"[\w]+", criterion) if len(w) > 2} - STOP
    scored = []
    for passage in passages:
        if INJECTION.search(passage.text):
            continue
        if target["pattern"]:
            if not re.search(target["pattern"], passage.text, re.I):
                continue
        overlap = len(terms & set(re.findall(r"\w+", passage.text.lower())))
        activity = bool(
            re.search(
                r"\b(built|developed|implemented|maintained|deployed|created)\b", passage.text, re.I
            )
        )
        scored.append((overlap + 2 * activity, passage))
    scored.sort(key=lambda x: (-x[0], int(x[1].id[1:])))
    # Generic criteria can be expressed without shared words. Include context for Jev rather
    # than declaring them absent on lexical overlap alone.
    if not target["pattern"] and not any(score for score, _ in scored):
        return [p for p in passages if not INJECTION.search(p.text)][:3]
    return [p for _, p in scored[:3]]


def combine(statuses: list[Status], operator: str) -> Status:
    if not statuses:
        return Status.UNCLEAR
    if operator == "ANY" and Status.SUPPORTED in statuses:
        return Status.SUPPORTED
    if all(s == Status.SUPPORTED for s in statuses):
        return Status.SUPPORTED
    if any(s in {Status.SUPPORTED, Status.PARTIAL} for s in statuses):
        return Status.PARTIAL
    if all(s == Status.NOT_MENTIONED for s in statuses):
        return Status.NOT_MENTIONED
    return Status.UNCLEAR


MONTHS = {
    name: index
    for index, names in enumerate(
        [
            ("jan", "january"),
            ("feb", "february"),
            ("mar", "march"),
            ("apr", "april"),
            ("may",),
            ("jun", "june"),
            ("jul", "july"),
            ("aug", "august"),
            ("sep", "sept", "september"),
            ("oct", "october"),
            ("nov", "november"),
            ("dec", "december"),
        ],
        1,
    )
    for name in names
}
MONTH_NAME = "|".join(sorted(MONTHS, key=len, reverse=True))
DATE = (
    rf"(?:{MONTH_NAME})[ .,/\-]+(?:19|20)\d{{2}}|"
    r"(?:0?[1-9]|1[0-2])[/\-](?:19|20)\d{2}|(?:19|20)\d{2}"
)
RANGE = re.compile(rf"(?P<start>{DATE})\s*(?:[-–—]|to)\s*(?P<end>present|current|now|{DATE})", re.I)
HEADINGS = re.compile(
    r"^\s*(?:work experience|professional experience|employment(?: history)?|"
    r"experience|education|academic(?:s| background)?|projects?|certifications?|"
    r"skills|technical skills)\s*:?\s*$",
    re.I | re.M,
)


def date_bounds(raw: str, today: date) -> tuple[int, int] | None:
    if raw.lower() in {"present", "current", "now"}:
        index = today.year * 12 + today.month - 1
        return index, index
    year = re.search(r"(?:19|20)\d{2}", raw)
    if not year:
        return None
    year = int(year.group())
    if year > today.year:
        return None
    prefix = raw[: raw.index(str(year))].strip(" .,/-")
    month = MONTHS.get(prefix.lower())
    if prefix.isdigit():
        month = int(prefix) if 1 <= int(prefix) <= 12 else None
    if prefix and month is None:
        return None
    base = year * 12
    return (base + month - 1, base + month - 1) if month else (base, base + 11)


def employment_periods(text: str, today: date) -> list[dict]:
    result = []
    headings = list(HEADINGS.finditer(text))
    for match in RANGE.finditer(text):
        before = [h for h in headings if h.end() <= match.start()]
        section = before[-1].group().strip(" :\n").lower() if before else ""
        if section not in {
            "work experience",
            "professional experience",
            "employment",
            "employment history",
            "experience",
        }:
            continue
        start, end = date_bounds(match["start"], today), date_bounds(match["end"], today)
        if not start or not end or start[0] > end[1]:
            continue
        # Use one employment block, bounded by neighboring date ranges and section headings.
        begin = max(before[-1].end(), text.rfind("\n\n", 0, match.start()) + 2)
        following = [h.start() for h in headings if h.start() > match.end()]
        next_range = RANGE.search(text, match.end())
        stop = min(
            [
                len(text),
                match.end() + 1200,
                *following,
                *([max(match.end(), next_range.start() - 100)] if next_range else []),
            ]
        )
        context = text[begin:stop].strip()
        if not context:
            continue
        # A bound on month coverage avoids treating unspecified year months as exact dates.
        result.append(
            {
                "start_min": start[0],
                "start_max": start[1],
                "end_min": end[0],
                "end_max": min(end[1], today.year * 12 + today.month - 1),
                "quote": context,
                "date_quote": match.group(),
            }
        )
    return result


def union_months(intervals: list[tuple[int, int]]) -> int:
    merged = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return sum(end - start for start, end in merged)


def duration_bounds(periods: list[dict]) -> tuple[int, int]:
    # Known months still leave start/end days unspecified. Use conservative whole-month
    # bounds, union overlapping employment, and never sum simultaneous roles twice.
    lower = union_months([(p["start_max"] + 1, p["end_min"]) for p in periods])
    upper = union_months([(p["start_min"], p["end_max"] + 1) for p in periods])
    return lower, upper


def minimum_months(text: str) -> int | None:
    if re.search(r"\b(?:education|degree|age)\b", text, re.I):
        return None
    m = re.search(r"\b(\d+(?:\.\d+)?)\s*\+?\s*years?\b", text, re.I)
    if not m or not re.search(r"\bexperience\b", text, re.I):
        return None
    if re.search(
        r"\b(?:maximum|up to|less than|under|between|equivalent|or)\b|\d\s*[-–]\s*\d", text, re.I
    ):
        return None
    if len(re.findall(r"\d+(?:\.\d+)?\s*\+?\s*years?", text, re.I)) != 1:
        return None
    months = ceil(float(m[1]) * 12)
    return months if months > 0 else None
