import secrets
from pathlib import PurePosixPath
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, field_validator

from rolelens.config import Settings
from rolelens.dependencies import get_settings, get_store
from rolelens.documents import MAX_UPLOAD_BYTES
from rolelens.schemas import MAX_REQUIREMENTS, EvidenceStatus, Requirement
from rolelens.storage import Store

router = APIRouter(prefix="/api/v1", tags=["Application intake"])
Database = Annotated[Store, Depends(get_store)]
bearer = HTTPBearer(auto_error=False)


class NewJob(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=100)
    requirements: list[Requirement] = Field(min_length=1, max_length=MAX_REQUIREMENTS)
    interpretation_id: UUID | None = None
    interpretation_reviewed: bool = False

    @field_validator("requirements")
    @classmethod
    def unique_requirements(cls, items):
        if len({r.id for r in items}) != len(items):
            raise ValueError("Requirement IDs must be unique.")
        return items


class NewBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected: int = Field(ge=1, le=10000)


class IncomingApplication(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    job_id: UUID
    source: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_.-]+$")
    external_id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=100)
    resume_text: str = Field(min_length=30, max_length=24000)


class ReviewUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1)
    notes: str = Field(default="", max_length=2000)
    reviewed: bool = False
    overrides: dict[str, EvidenceStatus] = Field(default_factory=dict, max_length=MAX_REQUIREMENTS)


def intake_auth(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    token = settings.intake_api_key.get_secret_value()
    if not token:
        raise HTTPException(503, "Programmatic intake is disabled. Configure INTAKE_API_KEY.")
    if credentials is None or not secrets.compare_digest(
        credentials.credentials.encode(), token.encode()
    ):
        raise HTTPException(
            401, "Invalid intake credentials.", headers={"WWW-Authenticate": "Bearer"}
        )


@router.get("/jobs")
def list_jobs(store: Database):
    return store.list_jobs()


@router.post("/jobs", status_code=201)
def create_job(request: NewJob, store: Database):
    requirements = [r.model_dump() for r in request.requirements]
    if request.interpretation_id is None:
        for item in requirements:
            item["source_validation"] = "EMPLOYER_AUTHORED"
        return store.create_job(request.title, requirements)
    draft = store.interpretation(str(request.interpretation_id))
    if request.title != draft["title"]:
        raise HTTPException(409, "The title changed after analysis. Analyze the description again.")
    proposed = {item["id"]: item for item in draft["result"]["requirements"]}
    edits = []
    for item in requirements:
        original = proposed.get(item["id"])
        if original is None:
            raise HTTPException(422, "The criterion does not belong to this interpretation.")
        item["source_quote"] = original["source_quote"]
        item["review_note"] = original["review_note"]
        item["components"] = original.get("components", [])
        item["component_operator"] = original.get("component_operator", "ALL")
        text_changed = item["text"] != original["text"]
        item["source_validation"] = (
            "EMPLOYER_AUTHORED"
            if text_changed
            else draft["result"]["validation"].get(item["id"], "REVIEW")
        )
        if text_changed:
            item["components"] = []
        if text_changed or item["priority"] != original["priority"]:
            edits.append(item["id"])
            item["review_note"] = (
                "Criterion edited by the job owner; "
                "source validation refers to the original proposal."
            )
        if not text_changed and draft["result"]["validation"].get(item["id"]) != "GROUNDED":
            item["assessment_mode"] = "VERIFY_SEPARATELY"
            item["review_note"] = (
                (item["review_note"] + " " if item["review_note"] else "")
                + "Source interpretation needs verification; "
                "excluded from automatic evidence assessment."
            )[:600]
        if original["assessment_mode"] != "RESUME_EVIDENCE":
            item["assessment_mode"] = original["assessment_mode"]
    snapshot = {
        **draft["result"],
        "id": draft["id"],
        "reviewed": request.interpretation_reviewed,
        "edited_criteria": edits,
        "approved_requirements": requirements,
        "version": 1,
    }
    return store.create_job(
        request.title, requirements, description=draft["description"], interpretation=snapshot
    )


@router.get("/jobs/{job_id}/summary")
def summary(job_id: UUID, store: Database):
    return store.summary(str(job_id))


@router.post("/jobs/{job_id}/batches", status_code=201)
def create_batch(job_id: UUID, request: NewBatch, store: Database):
    return store.create_batch(str(job_id), request.expected)


@router.get("/jobs/{job_id}/applications")
def application_list(
    job_id: UUID,
    store: Database,
    page: Annotated[int, Query(ge=1)] = 1,
    search: Annotated[str, Query(max_length=100)] = "",
    status: Literal[
        "", "QUEUED", "PROCESSING", "AWAITING_PROVIDER", "RETRY_WAIT", "READY", "FAILED", "REVIEWED"
    ] = "",
):
    return store.list_applications(str(job_id), page=page, search=search, status=status)


async def accept_file(file: UploadFile, store: Store, job_id: str, **values):
    try:
        content = await file.read(MAX_UPLOAD_BYTES + 1)
        filename = PurePosixPath((file.filename or "resume").replace("\\", "/")).name[:255]
        if not content or len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(422, "Each document must be between 1 byte and 5 MB.")
        if not filename.lower().endswith((".pdf", ".docx", ".txt")):
            raise HTTPException(422, "Upload PDF, DOCX, or UTF-8 TXT resumes.")
        return await run_in_threadpool(
            store.accept, job_id, values.pop("name"), filename, payload=content, **values
        )
    finally:
        await file.close()


@router.post("/jobs/{job_id}/applications", status_code=202)
async def bulk_application(
    job_id: UUID,
    store: Database,
    file: Annotated[UploadFile, File()],
    name: Annotated[str, Form(min_length=1, max_length=100)],
    batch_id: Annotated[UUID, Form()],
    receipt_id: Annotated[UUID, Form()],
):
    return await accept_file(
        file,
        store,
        str(job_id),
        name=name.strip(),
        batch_id=str(batch_id),
        receipt_id=str(receipt_id),
    )


@router.get("/applications/{application_id}")
def application_detail(application_id: UUID, store: Database):
    return store.application(str(application_id))


@router.patch("/applications/{application_id}/review")
def save_review(application_id: UUID, request: ReviewUpdate, store: Database):
    return store.save_review(
        str(application_id),
        request.version,
        request.notes,
        request.reviewed,
        {key: value.value for key, value in request.overrides.items()},
    )


@router.post("/jobs/{job_id}/retry")
def retry_failed(job_id: UUID, store: Database):
    return {"queued": store.retry(str(job_id))}


@router.post("/applications/{application_id}/retry")
def retry_one(application_id: UUID, store: Database):
    application = store.application(str(application_id))
    return {"queued": store.retry(application["job_id"], str(application_id))}


@router.post("/integrations/applications", status_code=202, dependencies=[Depends(intake_auth)])
def integration_application(request: IncomingApplication, store: Database, response: Response):
    receipt = store.accept(
        str(request.job_id),
        request.name,
        "integrated-resume.txt",
        text=request.resume_text,
        source=request.source,
        external_id=request.external_id,
    )
    response.headers["Location"] = f"/api/v1/integrations/applications/{receipt['id']}"
    return receipt


@router.post(
    "/integrations/jobs/{job_id}/applications", status_code=202, dependencies=[Depends(intake_auth)]
)
async def integration_file(
    job_id: UUID,
    store: Database,
    file: Annotated[UploadFile, File()],
    name: Annotated[str, Form(min_length=1, max_length=100)],
    source: Annotated[str, Form(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_.-]+$")],
    external_id: Annotated[str, Form(min_length=1, max_length=200)],
):
    return await accept_file(
        file, store, str(job_id), name=name.strip(), source=source, external_id=external_id
    )


@router.get("/integrations/applications/{application_id}", dependencies=[Depends(intake_auth)])
def integration_status(application_id: UUID, store: Database):
    data = store.application(str(application_id))
    return {key: data[key] for key in ("id", "job_id", "status", "reviewed", "error")}
