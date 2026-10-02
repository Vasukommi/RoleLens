from functools import lru_cache
from typing import Annotated

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from rolelens.config import Settings
from rolelens.documents import MAX_UPLOAD_BYTES, DocumentError, parse_resume
from rolelens.providers import AssessmentProvider, JevProvider, ProviderError
from rolelens.sample import sample_workspace
from rolelens.schemas import Assessment, AssessmentRequest, ParsedResume

app = FastAPI(title="RoleLens API", version="0.1.0")


@lru_cache
def get_settings() -> Settings:
    return Settings()


def get_provider(settings: Annotated[Settings, Depends(get_settings)]) -> AssessmentProvider:
    return JevProvider(settings)


@app.get("/api/v1/health")
def health(settings: Annotated[Settings, Depends(get_settings)]) -> dict:
    return {
        "status": "ok",
        "version": "0.1.0",
        "assessment_available": settings.assessment_available,
        "model": settings.typesafe_model if settings.assessment_available else None,
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
