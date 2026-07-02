FROM python:3.12-slim

ARG JAX_CUDA_EXTRA=cuda12

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    CUDA_VISIBLE_DEVICES=0 \
    MUJOCO_GL=egl \
    PYOPENGL_PLATFORM=egl \
    XLA_PYTHON_CLIENT_PREALLOCATE=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libegl1 \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        libosmesa6 \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --upgrade pip \
    && python -m pip install --upgrade \
        "jax[${JAX_CUDA_EXTRA}]" \
        "mujoco>=3.3"

WORKDIR /workspace

CMD ["python", "-c", "import jax, mujoco; print('URDF Studio MJX runtime ready:', jax.default_backend(), mujoco.__version__)"]
