from fastapi import HTTPException
from starlette.responses import JSONResponse


class IntakeBodyLimit:
    """Bound direct intake clients as well as the browser proxy, including chunked bodies."""

    def __init__(self, app, max_bytes=6 * 1024 * 1024):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PATCH", "PUT"}:
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        try:
            too_large = int(headers.get(b"content-length", b"0")) > self.max_bytes
        except ValueError:
            too_large = True
        if too_large:
            return await JSONResponse(status_code=413, content={"detail": "Request exceeds 6 MB."})(
                scope, receive, send
            )
        size = 0

        async def bounded_receive():
            nonlocal size
            message = await receive()
            if message["type"] == "http.request":
                size += len(message.get("body", b""))
                if size > self.max_bytes:
                    raise HTTPException(413, "Request exceeds 6 MB.")
            return message

        await self.app(scope, bounded_receive, send)
