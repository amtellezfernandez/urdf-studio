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
    ffmpeg \
    libavcodec-dev \
    libavformat-dev \
    libavutil-dev \
    libswscale-dev \
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
COPY pyproject.toml uv.lock README.md ./
COPY backend ./backend/
COPY vendor ./vendor/

# -----------------------------------------------------------------------------
# Stage: trainer (default)
# Full application with GPU support
# -----------------------------------------------------------------------------
FROM base AS trainer

# Install dependencies using uv sync (same as local development)
# This ensures the exact same dependencies from pyproject.toml are installed
RUN uv sync --extra-index-url https://download.pytorch.org/whl/cu121

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

# Install dependencies using uv sync with CPU-only PyTorch
RUN uv sync --extra-index-url https://download.pytorch.org/whl/cpu

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
