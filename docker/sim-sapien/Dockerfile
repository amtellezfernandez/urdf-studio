FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libegl1 \
        libgl1 \
        libglib2.0-0 \
        libglvnd0 \
        libgomp1 \
        libvulkan1 \
        mesa-vulkan-drivers \
        vulkan-tools \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --upgrade pip \
    && python -m pip install --upgrade sapien

WORKDIR /workspace

CMD ["python", "-c", "import sapien; print('URDF Studio SAPIEN runtime ready:', getattr(sapien, '__version__', 'unknown'))"]
