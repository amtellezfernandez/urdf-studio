# MJX System Identification

URDF Studio setup installs the MJX system-identification runtime needed for a synthetic-first SO100 calibration loop:

- `mujoco-mjx==3.9.0` for JAX-native MuJoCo rollouts.
- `optax==0.2.8` for gradient-based optimizers.
- `mujoco-sysid==0.2.1` for reusable dynamic parameter extraction, MJX model setters, and physically constrained inertial parameter conversions.

## Third-Party References

The source references are tracked as submodules so their code stays isolated from Studio runtime code:

- `third_party/mujoco-sysid` -> `https://github.com/based-robotics/mujoco-sysid.git`

Use `mujoco-sysid` through the published Python package instead of copying source into this repo. The pieces worth reusing first are:

- `mujoco_sysid.mjx.parameters`: dynamic parameter getters/setters for MJX models.
- `mujoco_sysid.mjx.convert`: Log-Cholesky and pseudo-inertia conversions that keep optimized inertias physically valid.
- `third_party/mujoco-sysid/tests/mjx`: reference coverage for MJX parameter conversion behavior.
- `third_party/mujoco-sysid/examples`: cart-pole and robot load-identification patterns for synthetic recovery tests.

Treat `third_party/mjx_sysid` as architecture reference material until its license is clarified. It is useful for:

- trajectory-matching rollout/loss structure around `mjx.step`;
- lagged joint dataset format for commanded/observed trajectory pairs;
- Optax training loop shape, metric logging, checkpoint outputs, and replay scripts;
- component factories for controllers, friction terms, and model changers.

Do not copy source from either submodule into Studio until the target file's license is explicit and compatible. If implementation needs behavior from unlicensed files, rewrite from the public algorithm description and keep the test vectors synthetic or Studio-owned.

## MVP Build Order

1. Synthetic MJX recovery benchmark: load the real SO100 URDF, strip render/collision meshes through `i-love-urdf`, roll out perfect trajectories in MJX, and verify Optax can recover known gain/damping parameters.
2. SO100 command/state logger: record issued command, observed joint position, observed joint velocity, and monotonic timestamps in the same row.
3. MJX trajectory loss: start with joint-position and joint-velocity residuals plus regularization to the URDF/MJCF priors.
4. Parameter tiers: optimize actuator gain, damping, and armature first; add mass/CoM later; keep contact/friction frozen until the synthetic benchmark is stable.
5. Residual attribution export: emit per-parameter gradients and phase-local residuals as JSON for an agentic diagnostic loop.

## Current SO100 Benchmark

Run the production smoke benchmark with:

```bash
npm run sysid:so100
```

The benchmark intentionally does not maintain a parallel URDF-to-MJCF converter. It uses:

- `i-love-urdf/urdf-node` to remove visual and collision mesh payloads;
- MuJoCo's official URDF importer to preserve precise inertial values;
- MJX free-space rollout with joint limits disabled so reverse-mode gradients do not hit the constraint solver's dynamic `while_loop` path;
- Optax Adam over log-space PD gain and damping.

This is a Tier 1 free-space actuator benchmark. Contact, joint-limit behavior, friction, and inertial identification should be added as separate benchmarks once this one remains stable.

## Geometry Repair Track

A broken-but-topologically-correct URDF should be treated as a parameter prior, not as a generation problem. The graph of links and joints remains fixed while optimization adjusts local parameters around the authored values:

- joint `<origin xyz/rpy>` offsets;
- joint axes, represented as normalized perturbations rather than unconstrained vectors;
- optional joint limits after the axis/origin fit is stable;
- mesh-local alignment losses when a dataset exposes task-space, marker, or point-cloud observations.

Keep this separate from the MJX dynamics benchmark. Geometry repair can use differentiable forward kinematics or a bounded numeric optimizer first; MJX SysID should consume the repaired kinematic prior later. This separation makes failures readable: bad mesh alignment belongs to the geometry-repair track, while trajectory residuals after correct geometry belong to actuator/inertia/friction SysID.

Run the current differentiable SO100 geometry-repair smoke benchmark with:

```bash
npm run sysid:so100:geometry
```

The benchmark uses the real stripped SO100 kinematic tree, corrupts selected joint-origin translations within a bounded local search radius, observes synthetic tracked-link positions, and recovers the offsets through JAX/Optax. It intentionally starts with `origin xyz`; axis repair should be added as a second benchmark once real task-space observations are wired in.

## UrdfOps Keypoint Contract

Keypoint extraction belongs in UrdfOps. Studio should not own camera/model-specific extraction code; it consumes the stable UrdfOps output contract and converts it into SO100 geometry-repair tensors.

Current contract:

- schema version: `urdf-ops.keypoint-observations.v1`
- UrdfOps endpoint: `POST /keypoint-observations/validate`
- required frame fields: `episode_index`, `frame_index`, optional `camera_name`
- required keypoint fields: `label`, `confidence`, and either `pixel_xy` or `position_xyz_m`
- Studio geometry repair consumes only keypoints with `position_xyz_m` and a valid SO100 `link_name`

This keeps the split clean: UrdfOps handles dataset/perception/keypoint QA, while Studio handles differentiable FK/MJX optimization against link-space observations.

Primary references:

- Trajectory-Based Actuator Identification via Differentiable Simulation: https://arxiv.org/abs/2604.10351
- MuJoCo SysID package: https://pypi.org/project/mujoco-sysid/
