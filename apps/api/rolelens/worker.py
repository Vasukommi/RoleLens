"""Run separately from HTTP: uv run python -m rolelens.worker."""

import asyncio
import contextlib
import logging
import time
from uuid import uuid4

from rolelens.config import Settings
from rolelens.documents import DocumentError, normalize_text, parse_resume
from rolelens.providers import AssessmentProvider, JevProvider, ProviderError
from rolelens.schemas import AssessmentRequest
from rolelens.storage import Store

logger = logging.getLogger("rolelens.worker")


async def process(
    store: Store,
    settings: Settings,
    row: dict,
    provider: AssessmentProvider,
    worker_id: str = "test-worker",
):
    async def renew():
        while True:
            await asyncio.sleep(min(10, settings.worker_lease_seconds / 3))
            if not await asyncio.to_thread(store.renew, row, settings.worker_lease_seconds):
                return
            await asyncio.to_thread(store.worker_heartbeat, worker_id)

    heartbeat = asyncio.create_task(renew())
    try:
        if row["attempts"] > settings.worker_max_attempts:
            await asyncio.to_thread(
                store.finish,
                row,
                "FAILED",
                error="Processing repeatedly interrupted. Inspect the document before retrying.",
            )
            return
        text = row["text"]
        if text is None:
            parsed = await asyncio.to_thread(parse_resume, row["filename"], row["payload"])
            text = parsed.text
        else:
            text = normalize_text(text)
        if not await asyncio.to_thread(store.leased_update, row, text=text, payload=None):
            return
        if not settings.assessment_available:
            await asyncio.to_thread(store.finish, row, "AWAITING_PROVIDER", attempts=0, error=None)
            return
        assessment = await provider.assess(
            AssessmentRequest(resume_text=text, requirements=row["requirements"])
        )
        await asyncio.to_thread(
            store.finish, row, "READY", assessment=assessment.model_dump(mode="json"), error=None
        )
    except DocumentError as error:
        await asyncio.to_thread(store.finish, row, "FAILED", error=str(error))
    except ProviderError as error:
        status = "RETRY_WAIT" if row["attempts"] < settings.worker_max_attempts else "FAILED"
        await asyncio.to_thread(
            store.finish,
            row,
            status,
            error=str(error),
            next_attempt=time.time() + min(300, 10 * 2 ** row["attempts"]),
        )
    except Exception:
        logger.error("Processing failed for application %s", row["id"])
        await asyncio.to_thread(
            store.finish,
            row,
            "FAILED",
            error="Processing failed. Retry or inspect the worker configuration.",
        )
    finally:
        heartbeat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat


async def run():
    settings = Settings()
    store = Store(settings.database_url)
    provider = JevProvider(settings)
    worker_id = str(uuid4())
    logger.info("Application worker started; model configured: %s", settings.assessment_available)
    while True:
        try:
            await asyncio.to_thread(store.worker_heartbeat, worker_id)
            row = await asyncio.to_thread(
                store.claim, settings.assessment_available, settings.worker_lease_seconds
            )
            if row:
                await process(store, settings, row, provider, worker_id)
            else:
                await asyncio.sleep(1)
        except Exception:
            logger.error("Worker database unavailable. Check migrations and database connectivity.")
            await asyncio.sleep(5)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(run())
