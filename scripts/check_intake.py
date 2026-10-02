"""Validate 1,000 synthetic deliveries against an isolated API+worker with Jev disabled."""

import asyncio
import json
import os
import time

import httpx


async def main():
    base = os.environ.get("ROLELENS_API_URL", "http://127.0.0.1:8000").rstrip("/")
    token = os.environ.get("INTAKE_API_KEY", "")
    if not token:
        raise RuntimeError("Set INTAKE_API_KEY for an isolated test deployment.")
    async with httpx.AsyncClient(base_url=base, timeout=30) as client:
        health = (await client.get("/api/v1/health")).json()
        if health["assessment_available"]:
            raise RuntimeError("Disable Jev on both API and worker before this synthetic check.")
        response = await client.post(
            "/api/v1/jobs",
            json={
                "title": "Synthetic intake validation (1,000 applications)",
                "requirements": [{"id": "react", "text": "Built React applications"}],
            },
        )
        response.raise_for_status()
        job_id = response.json()["id"]
        headers = {"Authorization": f"Bearer {token}"}
        semaphore = asyncio.Semaphore(10)

        async def deliver(index):
            body = {
                "job_id": job_id,
                "source": "synthetic_validation",
                "external_id": f"synthetic-{index}",
                "name": f"Synthetic Applicant {index:04}",
                "resume_text": (
                    f"Invented applicant {index}. Built React applications with TypeScript."
                ),
            }
            async with semaphore:
                result = await client.post(
                    "/api/v1/integrations/applications", json=body, headers=headers
                )
                result.raise_for_status()
            return body, result.json()["id"]

        delivered = await asyncio.gather(*(deliver(index) for index in range(1000)))
        assert len({application_id for _, application_id in delivered}) == 1000
        for body, application_id in delivered[:10]:
            duplicate = await client.post(
                "/api/v1/integrations/applications", json=body, headers=headers
            )
            duplicate.raise_for_status()
            assert duplicate.json() == {"id": application_id, "duplicate": True}
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            summary = (await client.get(f"/api/v1/jobs/{job_id}/summary")).json()
            if summary["statuses"].get("AWAITING_PROVIDER", 0) == 1000:
                break
            if summary["statuses"].get("FAILED", 0):
                raise RuntimeError("Synthetic document processing failed.")
            await asyncio.sleep(1)
        else:
            raise RuntimeError("Worker did not finish parsing within the check deadline.")
        assert summary["total"] == 1000
        first = (await client.get(f"/api/v1/jobs/{job_id}/applications")).json()
        last = (await client.get(f"/api/v1/jobs/{job_id}/applications?page=20")).json()
        assert len(first["items"]) == len(last["items"]) == 50
        assert "text" not in first["items"][0] and "payload" not in first["items"][0]
        assert not {r["id"] for r in first["items"]} & {r["id"] for r in last["items"]}
        print(
            json.dumps(
                {
                    "job_id": job_id,
                    "received": summary["total"],
                    "parsed": summary["statuses"]["AWAITING_PROVIDER"],
                    "duplicate_receipts_verified": 10,
                    "pages": 20,
                    "live_model_calls": 0,
                }
            )
        )


if __name__ == "__main__":
    asyncio.run(main())
