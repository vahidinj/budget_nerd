# Multi-stage (simple) Dockerfile for backend API deployment (App Runner / ECS / local)
# Build context: repository root

FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    API_ENV=production \
    PORT=8000

# (Optional) System deps if later needed (kept minimal for now)
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only dependency files first for layer caching
COPY backend/requirements.txt backend/requirements-ai.txt backend/requirements-viz.txt ./backend/

RUN pip install --upgrade pip && \
    pip install -r backend/requirements.txt

# Copy application source (backend only; exclude frontend to keep image small)
COPY backend/src ./backend/src

# Optional: non-root user
# RUN useradd -u 10001 -m appuser
# USER appuser

EXPOSE 8000

# Gunicorn (Uvicorn worker) start command
CMD ["gunicorn", "-k", "uvicorn.workers.UvicornWorker", "backend.src.api:app", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "120", "--graceful-timeout", "30", "--log-level", "info", "--access-logfile", "-", "--error-logfile", "-"]
