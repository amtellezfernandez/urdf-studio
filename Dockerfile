# =============================================================================
# URDF Studio - Multi-stage Dockerfile
# =============================================================================
# Stages:
#   - base: CUDA 12.1 + Python 3.10 + uv
#   - trainer: Full app with GPU support (default)
#   - cpu: Lightweight CPU-only variant
# =============================================================================

# -----------------------------------------------------------------------------
# Stage: base
# CUDA 12.1 + Python 3.10 + uv package manager
# -----------------------------------------------------------------------------
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04 AS base

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 \
    python3.10-venv \
    python3.10-dev \
    python3-pip \
    curl \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.10 as default
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.10 1 && \
    update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1

# Install uv package manager
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy project files
COPY pyproject.toml ./
COPY backend ./backend/
COPY vendor ./vendor/

# -----------------------------------------------------------------------------
# Stage: trainer (default)
# Full application with GPU support
# -----------------------------------------------------------------------------
FROM base AS trainer

# Create virtual environment and install dependencies
RUN uv venv .venv && \
    . .venv/bin/activate && \
    uv pip install --extra-index-url https://download.pytorch.org/whl/cu121 \
        torch torchvision && \
    uv pip install -e . && \
    uv pip install -e ./vendor/pyroki 2>/dev/null || true

# Set environment
ENV PATH="/app/.venv/bin:$PATH"
ENV VIRTUAL_ENV="/app/.venv"

# HuggingFace cache directory
ENV HF_HOME="/app/.cache/huggingface"
ENV TRANSFORMERS_CACHE="/app/.cache/huggingface/transformers"

# Create directories
RUN mkdir -p /app/outputs /app/.cache/huggingface

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Default command
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]

# -----------------------------------------------------------------------------
# Stage: cpu
# Lightweight CPU-only variant
# -----------------------------------------------------------------------------
FROM base AS cpu

# Create virtual environment and install CPU-only dependencies
RUN uv venv .venv && \
    . .venv/bin/activate && \
    uv pip install --extra-index-url https://download.pytorch.org/whl/cpu \
        torch torchvision && \
    uv pip install -e . && \
    uv pip install -e ./vendor/pyroki 2>/dev/null || true

# Set environment
ENV PATH="/app/.venv/bin:$PATH"
ENV VIRTUAL_ENV="/app/.venv"

# HuggingFace cache directory
ENV HF_HOME="/app/.cache/huggingface"
ENV TRANSFORMERS_CACHE="/app/.cache/huggingface/transformers"

# Create directories
RUN mkdir -p /app/outputs /app/.cache/huggingface

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Default command
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
