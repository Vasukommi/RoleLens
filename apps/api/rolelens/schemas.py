import math
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_RESUME_CHARS = 24_000
MAX_REQUIREMENTS = 12


class EvidenceStatus(StrEnum):
    SUPPORTED = "SUPPORTED"
    PARTIAL = "PARTIAL"
    NOT_MENTIONED = "NOT_MENTIONED"
    UNCLEAR = "UNCLEAR"


class Requirement(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    text: str = Field(min_length=3, max_length=300)


class Passage(BaseModel):
    id: str
    text: str


class ParsedResume(BaseModel):
    filename: str
    text: str
    passages: list[Passage]
    extraction_method: Literal["native", "ocr", "mixed"] = "native"


class AssessmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    resume_text: str = Field(min_length=30, max_length=MAX_RESUME_CHARS)
    requirements: list[Requirement] = Field(min_length=1, max_length=MAX_REQUIREMENTS)

    @field_validator("requirements")
    @classmethod
    def unique_ids(cls, requirements: list[Requirement]) -> list[Requirement]:
        if len({item.id for item in requirements}) != len(requirements):
            raise ValueError("Requirement IDs must be unique.")
        return requirements


class Finding(BaseModel):
    requirement_id: str
    status: EvidenceStatus
    evidence: Passage | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    probabilities: dict[str, float] | None = None


class Assessment(BaseModel):
    findings: list[Finding]
    model: str
    is_sample: bool = False


class ChoiceAnswer(BaseModel):
    type: str
    choice: str
    confidence: float = Field(ge=0, le=1)
    probabilities: dict[str, float]

    @field_validator("probabilities")
    @classmethod
    def valid_probabilities(cls, values: dict[str, float]) -> dict[str, float]:
        if not values or any(not math.isfinite(v) or not 0 <= v <= 1 for v in values.values()):
            raise ValueError("Invalid probability distribution.")
        if abs(sum(values.values()) - 1) > 0.02:
            raise ValueError("Probability distribution must sum to one.")
        return values
