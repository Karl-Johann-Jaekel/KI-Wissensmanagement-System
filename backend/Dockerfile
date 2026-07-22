FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps: curl (healthcheck) + runtime libs Docling/opencv need
# (libGL, libxcb, ... — otherwise "libxcb.so.1: cannot open shared object file").
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        libgl1 \
        libglib2.0-0 \
        libxcb1 \
        libsm6 \
        libxext6 \
        libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first, keyed only on pyproject.toml so heavy wheels (torch,
# docling) stay cached across source edits. A placeholder app/ lets the editable
# install resolve; real source is copied (and bind-mounted in compose) afterwards.
COPY pyproject.toml ./
RUN mkdir -p app && touch app/__init__.py \
    && pip install --upgrade pip \
    && pip install -e ".[dev]"

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
