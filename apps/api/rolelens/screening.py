import csv
import re
from io import BytesIO, StringIO
from typing import Annotated, Literal
from urllib.parse import quote
from uuid import UUID
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from pydantic import Field

from rolelens.decisions import selection
from rolelens.dependencies import get_store
from rolelens.job_descriptions import workspace_auth
from rolelens.schemas import ScreeningPolicy
from rolelens.storage import DocumentBundleTooLarge, Store

router = APIRouter(
    prefix="/api/v1", tags=["Evidence comparison"], dependencies=[Depends(workspace_auth)]
)
Database = Annotated[Store, Depends(get_store)]


class PolicyUpdate(ScreeningPolicy):
    version: int = Field(ge=1, strict=True)


@router.patch("/jobs/{job_id}/screening-policy")
def update_policy(job_id: UUID, request: PolicyUpdate, store: Database):
    return store.update_policy(
        str(job_id), ScreeningPolicy(**request.model_dump(exclude={"version"})), request.version
    )


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


@router.get("/jobs/{job_id}/shortlist/csv")
def shortlist_csv(job_id: UUID, store: Database):
    job = store.job(str(job_id))
    policy = job["screening_policy"]

    def generate():
        buffer = StringIO()
        writer = csv.writer(buffer)

        def line(values):
            buffer.seek(0)
            buffer.truncate()
            writer.writerow(
                [
                    "'" + str(value) if re.match(r"^[=+@\-\t\r]", str(value)) else value
                    for value in values
                ]
            )
            return buffer.getvalue()

        yield line(
            [
                "Applicant",
                "File",
                "Matched criteria",
                "Screening criteria",
                "Match %",
                "Threshold %",
                "Policy version",
                "Decision",
                "Required supported",
                "Preferred supported",
                "Unresolved",
            ]
        )
        for row in store.shortlist_rows(str(job_id), policy):
            result = selection(row["screening"], "READY", policy)
            yield line(
                [
                    row["name"],
                    row["filename"],
                    result["matched"],
                    result["total"],
                    result["percentage"],
                    policy["threshold"],
                    job["policy_version"],
                    result["status"],
                    row["screening"]["REQUIRED"]["supported"],
                    row["screening"]["PREFERRED"]["supported"],
                    row["screening"]["unresolved"],
                ]
            )

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="rolelens-{job_id}-shortlist.csv"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/jobs/{job_id}/shortlist/documents")
def documents(job_id: UUID, store: Database):
    try:
        rows = store.shortlist_documents(str(job_id))
    except DocumentBundleTooLarge as error:
        raise HTTPException(413, str(error)) from error
    if not rows:
        raise HTTPException(422, "No applications currently meet the screening rules.")
    if len(rows) > 100:
        raise HTTPException(422, "This download supports up to 100 shortlisted resumes.")
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
