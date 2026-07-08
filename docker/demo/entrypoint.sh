#!/usr/bin/env bash
# Run the carton-sorting scenario on every simulator available in this image
# and write the comparison (report.html + episode.mp4 per sim) to /out.
set -euo pipefail

OUT_DIR="${1:-/out/carton-demo}"
mkdir -p "$OUT_DIR"

SIMS=(--sim mujoco)
if python -c "import genesis" >/dev/null 2>&1; then
  SIMS+=(--sim genesis)
fi

echo "urdf-studio demo -> ${OUT_DIR}"
python -m backend.scripts.scenario_run \
  /app/scenarios/carton_sorting_0001 \
  "${SIMS[@]}" \
  --out "$OUT_DIR"

echo
echo "artifacts:"
echo "  comparison : ${OUT_DIR}/comparison.json"
echo "  report     : ${OUT_DIR}/report.html"
echo "  videos     : ${OUT_DIR}/<sim>/episode-0/episode.mp4"
