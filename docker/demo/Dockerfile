# One-command cross-simulator scenario demo.
#
#   docker build -t urdf-studio-demo -f docker/demo/Dockerfile .
#   docker run --rm -v "$PWD/demo-out:/out" urdf-studio-demo
#
# Produces the carton-sorting comparison (report.html + episode.mp4 per sim)
# under the mounted /out. MuJoCo runs out of the box (CPU, headless). Build
# with `--build-arg WITH_GENESIS=1` to add the Genesis backend for the full
# two-simulator comparison (larger image; pulls torch + taichi).
FROM python:3.12-slim

ARG WITH_GENESIS=0
ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    MUJOCO_GL=egl \
    URDF_STUDIO_PYTHON=python \
    URDF_SCENARIO_RUN_WORKSPACE_ROOT=/out/runs

# ffmpeg for episode video; GL/mesa libs so headless rendering paths load.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg libegl1 libgl1 libglib2.0-0 libgomp1 libosmesa6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend /app/backend
COPY scenarios /app/scenarios
COPY docker/demo/entrypoint.sh /app/entrypoint.sh

RUN python -m pip install --upgrade pip \
    && python -m pip install \
        "mujoco>=3.10" pydantic pyyaml numpy scipy trimesh \
        imageio imageio-ffmpeg pillow \
    && if [ "$WITH_GENESIS" = "1" ]; then python -m pip install "genesis-world==1.1.0" "torch>=2.8"; fi \
    && chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
