#!/usr/bin/env bash
# World-rollout runner wrapper for URDF_WORLD_ROLLOUT_CLI.
# WorldRolloutService invokes this as: world_rollout_cli.sh --campaign <path> --out <dir>
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${URDF_WORLD_ROLLOUT_PYTHON:-$REPO_ROOT/.venv/bin/python}"
cd "$REPO_ROOT"
exec "$PYTHON" -m backend.scripts.world_rollout_cli "$@"
