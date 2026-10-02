FROM python:3.13-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.12.3
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev
COPY apps/api/rolelens ./rolelens
COPY apps/api/alembic.ini ./
COPY apps/api/migrations ./migrations
RUN useradd --create-home --uid 10001 rolelens
USER rolelens
EXPOSE 8000
CMD [".venv/bin/uvicorn", "rolelens.main:app", "--host", "0.0.0.0", "--port", "8000"]
