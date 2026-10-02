from io import BytesIO
from typing import Annotated, Literal
from urllib.parse import quote
from uuid import UUID
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from rolelens.dependencies import get_store
from rolelens.job_descriptions import workspace_auth
from rolelens.storage import DocumentBundleTooLarge, Store

router = APIRouter(
    prefix="/api/v1", tags=["Evidence comparison"], dependencies=[Depends(workspace_auth)]
)
Database = Annotated[Store, Depends(get_store)]


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    version: int = Field(ge=1)


class Approval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selections: list[Selection] = Field(min_length=1, max_length=100)
    evidence_reviewed: Literal[True]

    @field_validator("selections")
    @classmethod
    def unique(cls, items):
        if len({item.id for item in items}) != len(items):
            raise ValueError("Choose each application only once.")
        return items


@router.get("/jobs/{job_id}/comparison")
def comparison(
    job_id: UUID,
    store: Database,
    page: Annotated[int, Query(ge=1)] = 1,
    search: Annotated[str, Query(max_length=100)] = "",
    scope: Literal["", "SHORTLISTED", "COMPLETE", "UNRESOLVED"] = "",
    criterion_id: Annotated[str, Query(max_length=80)] = "",
    finding_status: Literal["SUPPORTED", "PARTIAL", "NOT_MENTIONED", "UNCLEAR"] = "SUPPORTED",
):
    return store.comparison(
        str(job_id),
        page=page,
        search=search,
        scope=scope,
        criterion_id=criterion_id,
        finding_status=finding_status,
    )


@router.post("/jobs/{job_id}/shortlist")
def approve(job_id: UUID, request: Approval, store: Database):
    return store.approve_shortlist(
        str(job_id), [{"id": str(item.id), "version": item.version} for item in request.selections]
    )


@router.post("/jobs/{job_id}/reassess")
def reassess(job_id: UUID, store: Database):
    return store.reassess(str(job_id))


@router.get("/applications/{application_id}/document")
def document(application_id: UUID, store: Database):
    filename, content = store.original(str(application_id))
    return Response(
        content,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''" + quote(filename, safe=""),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )


@router.get("/jobs/{job_id}/shortlist/documents")
def documents(job_id: UUID, store: Database):
    try:
        rows = store.shortlist_documents(str(job_id))
    except DocumentBundleTooLarge as error:
        raise HTTPException(413, str(error)) from error
    if not rows:
        raise HTTPException(422, "Approve a shortlist before downloading its resumes.")
    if len(rows) > 100:
        raise HTTPException(422, "This download supports up to 100 approved resumes.")
    if any(row.original_document is None for row in rows):
        raise HTTPException(
            409, "Some original files are unavailable. Restore or reimport them first."
        )
    if sum(len(row.original_document) for row in rows) > 50 * 1024 * 1024:
        raise HTTPException(413, "The selected documents exceed the 50 MB download limit.")
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for row in rows:
            filename = row.filename.replace("\\", "/").split("/")[-1]
            archive.writestr(f"{row.id[:8]}-{filename}", row.original_document)
    return Response(
        output.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="rolelens-{job_id}-shortlist.zip"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )
