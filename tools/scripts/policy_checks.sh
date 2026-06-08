#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

failures=0

if command -v rg >/dev/null 2>&1; then
  SEARCH_BIN="rg"
else
  SEARCH_BIN="grep"
fi

check_paths_exist() {
  local title="$1"
  shift
  local missing=0
  for p in "$@"; do
    if [[ ! -e "${p}" ]]; then
      echo "[policy][FAIL] ${title}: missing ${p}" >&2
      missing=1
    fi
  done
  if [[ ${missing} -eq 1 ]]; then
    failures=$((failures + 1))
  else
    echo "[policy][OK] ${title}"
  fi
}

search_hits() {
  local pattern="$1"
  shift
  local paths=("$@")
  if [[ "${SEARCH_BIN}" == "rg" ]]; then
    rg -n --no-heading -e "${pattern}" "${paths[@]}" 2>/dev/null || true
  else
    grep -RInE "${pattern}" "${paths[@]}" 2>/dev/null || true
  fi
}

check_no_match() {
  local title="$1"
  local pattern="$2"
  shift 2
  local paths=("$@")
  local out
  out="$(search_hits "${pattern}" "${paths[@]}")"
  if [[ -n "${out}" ]]; then
    echo "[policy][FAIL] ${title}" >&2
    echo "${out}" >&2
    failures=$((failures + 1))
  else
    echo "[policy][OK] ${title}"
  fi
}

check_file_contains() {
  local title="$1"
  local file="$2"
  local needle="$3"
  if [[ ! -f "${file}" ]]; then
    echo "[policy][FAIL] ${title}: missing file ${file}" >&2
    failures=$((failures + 1))
    return
  fi

  if grep -q --fixed-strings "${needle}" "${file}"; then
    echo "[policy][OK] ${title}"
  else
    echo "[policy][FAIL] ${title}: '${needle}' not found in ${file}" >&2
    failures=$((failures + 1))
  fi
}

check_paths_exist \
  "Architecture docs present" \
  docs/architecture/ARCH_INDEX.md \
  docs/architecture/ARCH_CODE_TRUTH.md \
  docs/architecture/ARCH_DEFAULTS.md \
  docs/architecture/ARCH_KNOWN_GAPS.md \
  docs/health/HEALTH_VS_READINESS.md

check_paths_exist \
  "Architecture layer roots present" \
  web/src/studio_core \
  web/src/runtime_engine \
  web/src/studio_ui

# 1) No direct compatibility runtime imports outside wrappers/tests.
check_no_match \
  "No compatibility runtime imports in production modules" \
  "@/runtime/viz2/" \
  web/src/studio_core \
  web/src/runtime_engine \
  web/src/studio_ui \
  web/src/features

check_no_match \
  "No compatibility runtime imports anywhere" \
  "@/runtime/viz2/" \
  web/src

check_no_match \
  "No feature runtime-health imports" \
  "@/features/runtime-health/" \
  web/src

# 2) runtime_engine must not import studio_ui.
check_no_match \
  "runtime_engine must not import studio_ui" \
  "@/studio_ui/" \
  web/src/runtime_engine

# 3) studio_core must not import studio_ui.
check_no_match \
  "studio_core must not import studio_ui" \
  "@/studio_ui/" \
  web/src/studio_core

# 4) Compatibility wrapper contract checks.
check_file_contains \
  "Viewer host resolves runtime via runtime_engine" \
  web/src/features/layout/page/ViewerHost.tsx \
  "@/runtime_engine/rosviz/session/runtimeSelector"

check_file_contains \
  "Runtime health panel forwards to studio_ui" \
  web/src/features/layout/panels/RuntimeHealthPanel.tsx \
  "@/studio_ui/panels/RuntimeHealthPanel"

# 5) Guard against new top-level scalar constants. Existing debt is tracked in
# tools/scripts/topLevelScalarConstantBaseline.json and should only shrink.
if node tools/scripts/topLevelScalarConstantAudit.js; then
  echo "[policy][OK] No new top-level scalar constants"
else
  echo "[policy][FAIL] New top-level scalar constants detected" >&2
  failures=$((failures + 1))
fi

# 6) Backend RosViz session state/mode API presence.
check_file_contains \
  "RosViz API exposes session state endpoint" \
  backend/api/ros_viz.py \
  "/sessions/{session_id}/state"

check_file_contains \
  "RosViz API exposes session mode endpoint" \
  backend/api/ros_viz.py \
  "/sessions/{session_id}/mode"

if [[ "${failures}" -ne 0 ]]; then
  echo "[policy] ${failures} policy check(s) failed." >&2
  exit 1
fi

echo "[policy] All policy checks passed."
