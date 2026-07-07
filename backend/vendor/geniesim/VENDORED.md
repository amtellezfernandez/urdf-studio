# Vendored Genie Sim subset

- Upstream: https://github.com/AgibotTech/genie_sim
- Pinned commit: `3d7b6161252d0071c2aa8384bec1ac718f38837f` (local clone at `third_party/genie_sim`)
- License: Mozilla Public License 2.0 (per-file AgiBot copyright headers preserved verbatim)
- Source root: `source/geniesim_benchmark/src/geniesim_benchmark/`
- Vendored in collaboration with AgiBot; engine-neutral modules are reused as-is, adapted only
  at the `APICore` seam so they run against URDF Studio's simulator backends
  (`backend/services/sim_backends/`).

Import mechanism: `backend/services/scenario_runtime/vendor_loader.ensure_geniesim_on_path()`
prepends this directory to `sys.path`; the vendored files keep their original
`geniesim_benchmark.*` absolute imports. **Do not pip-install the real `geniesim_benchmark`
package into the same environment** — this subset intentionally shadows it.

## File status

### Verbatim (byte-identical to upstream)
- `geniesim_benchmark/plugins/logger/{__init__,logger}.py`
- `geniesim_benchmark/plugins/ader/__init__.py`
- `geniesim_benchmark/plugins/ader/ader_base.py`
- `geniesim_benchmark/plugins/ader/action/__init__.py`
- `geniesim_benchmark/plugins/ader/action/action_manager.py`
- `geniesim_benchmark/plugins/ader/action/common_actions.py`
- `geniesim_benchmark/plugins/ader/action/custom/{inside,inbbox,ontop,onfloor,liftup,stack}.py`
- `geniesim_benchmark/plugins/output_system/{__init__,eval_utils}.py`
- `geniesim_benchmark/plugins/__init__.py`
- `geniesim_benchmark/benchmark/__init__.py`
- `geniesim_benchmark/benchmark/policy/base.py`
- `geniesim_benchmark/utils/data_courier.py`
- `geniesim_benchmark/utils/msgpack_numpy.py`
- `geniesim_benchmark/utils/comm/retry.py`
- `geniesim_benchmark/utils/comm/websocket_client.py`

### Patched (headers preserved; every change listed)
- `geniesim_benchmark/plugins/ader/action/custom/upright.py`
  — removed line 12 `from isaacsim.core.utils.stage import get_current_stage`
    (the import is unused in the file body; no other change).
- `geniesim_benchmark/plugins/ader/action/custom/__init__.py`
  — import list trimmed to the vendored checker subset
    (upstream also imports onshelf, pickup_on_gripper, fluid_inside, cover,
    check_particle_in_bbox, push_pull, follow, trigger_action, check_stain_clean,
    gripper_passing, approach, vlm, stable_grasp, chassis_at_target,
    relative_position_checker, mixed_rules, place_on_rivet — not vendored yet).
- `geniesim_benchmark/plugins/ader/action/action_parsing.py`
  — `from .custom import (...)` list trimmed to the vendored checker subset; no other change.
    `parse_action` branches for non-vendored checkers remain (Python resolves those names
    lazily); using such a key in a scenario raises NameError. URDF Studio's scenario
    compiler only emits vendored keys.

### Shims (URDF-Studio-authored; NOT upstream code)
- `geniesim_benchmark/__init__.py` (upstream imports `_version`, not vendored)
- `geniesim_benchmark/app/__init__.py`, `geniesim_benchmark/app/controllers/__init__.py`
- `geniesim_benchmark/app/controllers/api_core.py` — abstract engine-neutral `APICore`
  replacing the Isaac implementation; this IS the SimBackend contract.
- `geniesim_benchmark/utils/__init__.py` (upstream also re-exports generalization_utils)
- `geniesim_benchmark/utils/system_utils.py` — path resolution against URDF Studio's
  `scenarios/` dir (env override `URDF_SCENARIO_CONF_PATH`) instead of geniesim_assets.
- `geniesim_benchmark/benchmark/policy/__init__.py` (absent upstream)
- `geniesim_benchmark/utils/comm/__init__.py` (absent upstream)

## Deliberately not vendored
- `benchmark/policy/corobotpolicy.py` — its dependency chain (name_utils ROBOT_CONFIGS,
  ikfk_utils, generalization_utils camera augmentation, infer_post_process) is specific to
  Genie's G1/G2 dual-arm embodiments and cannot drive arbitrary URDFs. URDF Studio's
  `backend/services/scenario_policies/vla_ws.py` speaks the same WebSocket/msgpack infer
  protocol (docs/specs/SCENARIO_POLICY_PROTOCOL.md) with a simulator-agnostic named-joint
  action shape, reusing the vendored codec/comm modules.

## Planned additions
`data_collection/common/data_filter/` (post-hoc trajectory-quality rules), vendored when
demo-curation lands.
