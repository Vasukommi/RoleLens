import asyncio

from rolelens.config import Settings
from rolelens.worker import run


def test_worker_concurrency_is_bounded_and_shutdown_cancels_active_tasks(monkeypatch):
    settings = Settings(_env_file=None, worker_concurrency=2, typesafe_api_key="")
    claimed, started, cancelled = [], [], []

    class FakeStore:
        def __init__(self, _url):
            pass

        def worker_heartbeat(self, _worker):
            pass

        def claim(self, _available, _lease):
            row = {"id": len(claimed)}
            claimed.append(row)
            return row

    async def check():
        ready = asyncio.Event()

        async def fake_process(_store, _settings, row, _provider, _worker):
            started.append(row["id"])
            if len(started) == 2:
                ready.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.append(row["id"])

        monkeypatch.setattr("rolelens.worker.Settings", lambda: settings)
        monkeypatch.setattr("rolelens.worker.Store", FakeStore)
        monkeypatch.setattr("rolelens.worker.process", fake_process)
        task = asyncio.create_task(run())
        await asyncio.wait_for(ready.wait(), 3)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(check())
    assert len(claimed) == 2 and sorted(cancelled) == [0, 1]


def test_fast_jobs_refill_slots_without_a_poll_delay(monkeypatch):
    settings = Settings(_env_file=None, worker_concurrency=2, typesafe_api_key="")
    claimed = []
    completed = []
    active_count = 0
    peak_active = 0

    class FakeStore:
        def __init__(self, _url):
            pass

        def worker_heartbeat(self, _worker):
            pass

        def claim(self, _available, _lease):
            if len(claimed) == 40:
                return None
            row = {"id": len(claimed)}
            claimed.append(row)
            return row

    async def check():
        done = asyncio.Event()

        async def fast_process(_store, _settings, row, _provider, _worker):
            nonlocal active_count, peak_active
            active_count += 1
            peak_active = max(peak_active, active_count)
            await asyncio.sleep(0.001)
            active_count -= 1
            completed.append(row["id"])
            if len(completed) == 40:
                done.set()

        monkeypatch.setattr("rolelens.worker.Settings", lambda: settings)
        monkeypatch.setattr("rolelens.worker.Store", FakeStore)
        monkeypatch.setattr("rolelens.worker.process", fast_process)
        task = asyncio.create_task(run())
        try:
            await asyncio.wait_for(done.wait(), 3)
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    asyncio.run(check())
    assert len(completed) == 40 and peak_active <= 2
