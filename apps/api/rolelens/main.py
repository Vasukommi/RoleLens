from typing import Annotated

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from rolelens.config import Settings
from rolelens.dependencies import database, get_settings
from rolelens.documents import MAX_UPLOAD_BYTES, DocumentError, parse_resume
from rolelens.intake import router
from rolelens.middleware import IntakeBodyLimit
from rolelens.providers import AssessmentProvider, JevProvider, ProviderError
from rolelens.sample import sample_workspace
from rolelens.schemas import Assessment, AssessmentRequest, ParsedResume
from rolelens.storage import IntakeConflict

app = FastAPI(title="RoleLens API", version="0.1.0")
app.add_middleware(IntakeBodyLimit)
app.include_router(router)


@app.exception_handler(IntakeConflict)
async def conflict(_request: Request, error: IntakeConflict):
    return JSONResponse(status_code=409, content={"detail": str(error)})


@app.exception_handler(KeyError)
async def not_found(_request: Request, _error: KeyError):
    return JSONResponse(status_code=404, content={"detail": "Job or application not found."})


@app.exception_handler(SQLAlchemyError)
async def database_unavailable(_request: Request, _error: SQLAlchemyError):
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Inbox database unavailable. Check connectivity and run database migrations."
        },
    )


def get_provider(settings: Annotated[Settings, Depends(get_settings)]) -> AssessmentProvider:
    return JevProvider(settings)


@app.get("/api/v1/health")
def health(settings: Annotated[Settings, Depends(get_settings)]) -> dict:
    try:
        worker_active = database(settings.database_url).worker_active()
    except SQLAlchemyError:
        worker_active = False
    return {
        "status": "ok",
        "version": "0.1.0",
        "assessment_available": settings.assessment_available,
        "model": settings.typesafe_model if settings.assessment_available else None,
        "worker_active": worker_active,
    }


@app.get("/api/v1/sample")
def sample() -> dict:
    return sample_workspace()


@app.post("/api/v1/resumes", response_model=ParsedResume)
async def upload_resume(file: Annotated[UploadFile, File()]) -> ParsedResume:
    try:
        content = await file.read(MAX_UPLOAD_BYTES + 1)
        return await run_in_threadpool(parse_resume, file.filename or "resume", content)
    except DocumentError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    finally:
        await file.close()


@app.post("/api/v1/assessments", response_model=Assessment)
async def assess(
    request: AssessmentRequest,
    provider: Annotated[AssessmentProvider, Depends(get_provider)],
) -> Assessment:
    try:
        return await provider.assess(request)
    except DocumentError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ProviderError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
