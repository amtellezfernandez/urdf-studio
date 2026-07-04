# The World Format

## What this document is

This documents what a **World** accepts today: the manifest shape, the object types and mesh
formats it can carry, how it's delivered (single file vs. folder), and which simulator targets
actually consume it versus which are registered but unimplemented.

It intentionally avoids the name `WSP`. That acronym was previously used in this repo for the same
manifest documented here (as "World Scene Package," formerly `docs/specs/WSP_v0.1.md`, now merged
into this document) and, on branch `hkhack`, is separately used for an unrelated eval pipeline
called World State Pipeline. This document is the single prose reference for the manifest going
forward, under the name **the World format**, to stop adding meanings to an already overloaded
acronym. The JSON Schema itself keeps its existing filename and location —
`docs/specs/WSP_manifest.schema.json` — since code (`backend/tests/test_wsp_manifest_schema.py`)
validates against that exact path; only the prose spec was renamed and consolidated.

## What a World is

A World is one manifest describing a scene independent of any one robot or simulator: the robot's
URDF, its joint positions, a list of cameras, and a list of scene objects in world coordinates.
Two shapes exist, both validated by the same object rules described below:

- `world-layout.json` — the lightweight shape (`{ world_layout: { name, objects, scenario_time_ms,
  scenario_duration_ms }, environment }`), used for URL-based import and public example scenes
  under `web/public/world-layouts/`.
- `world-package.json` (`WorldScenePackageManifest`) — the fuller shape, adding
  `schema_version`, `package_id`/`version`, `runtime_targets`, signed `artifacts`, and
  `provenance`/`security`. Canonical schema: `docs/specs/WSP_manifest.schema.json`.

A World can travel as a single file (paste a link, or drop one JSON) or as a **folder** — the
manifest plus every asset it references sitting alongside it. Folder import resolves each
reference by relative path against the folder's own contents; URL import resolves relative
references against the manifest's own URL. Neither path requires a backend asset-upload step.

A `world-package.json`'s required top-level fields are `schema_version`, `package_id`, `version`,
`title`, `created_at`, `runtime_targets`, `interface`, `artifacts`, `world_snapshot`, `provenance`,
and `security`.

Within `world_snapshot`:

- `urdf_xml` stores the full URDF source.
- `joint_positions` stores current joint positions in radians.
- `cameras` stores camera attachment + intrinsic/extrinsic config.
- `objects` stores scene objects in world coordinates (schema below).
- `scenario_time_ms` and `scenario_duration_ms` store scenario clock state. Static scene packages
  use `scenario_duration_ms = 0` and must set `scenario_time_ms = 0`.

## What's accepted inside `objects[]`

Every object in the scene — a prop, a target, a mesh, a collider — is one entry:

```
id, name, type, position_xyz, size_xyz, color        # required
rotation_rpy_rad                                     # when orientation matters
type: "cube" | "sphere" | "cylinder" | "point" | "mesh"

# present when type is "mesh", or the object is otherwise asset-backed
asset_ref, asset_scale_xyz
mesh: { asset_ref | path | uri | filename, scale, scale_xyz }

# present when the object carries physics intent
simulation: { fixed, collision, mass_kg, friction, restitution, semantic_role }
```

Field notes:

| Field | Type | Purpose |
|---|---|---|
| `type` | enum | The five shapes above. `mesh` is the escape hatch for anything that isn't a flat primitive. |
| `position_xyz` / `rotation_rpy_rad` | vec3 | World-frame pose. Rotation is optional — omitted means identity. |
| `size_xyz` | vec3 | Bounding extent. For a mesh object this sizes selection/edit handles, not the loaded geometry. |
| `mesh.uri` | string | Relative path to the real asset file, resolved at import time. |
| `asset_scale_xyz` / `mesh.scale` | vec3 \| number | Uniform or per-axis scale on top of the loaded geometry's native units. |
| `simulation.semantic_role` | string | Free-form tag a simulator adapter can key off, e.g. `manipulation_target`. |

**Portable-reference rule**: every asset reference — top-level `asset_ref`, and each of
`mesh.asset_ref` / `mesh.path` / `mesh.uri` / `mesh.filename` — must be a portable relative path:
no leading slash, no `http://`/`file://` scheme, no `.`/`..` traversal, no empty segments. This is
enforced identically on the frontend (`worldSceneManifest.ts`) and backend
(`backend/services/world_asset_refs.py::normalize_portable_world_asset_ref`). It's what makes
folder-based delivery work: every reference resolves against whatever directory the manifest came
from, nothing is hard-coded to one machine or server.

Implementation: `web/src/features/world-share/worldScenePackageTypes.ts` (frontend shape),
`backend/models/world_scene_package.py` (backend schema + validation).

## Accepted asset formats

A `mesh` object's file extension decides how it loads — no separate format flag, the same
convention Blender import already uses.

| Extension | Viewer rendering | Simulator transfer |
|---|---|---|
| `.glb` / `.gltf` | drei `useGLTF` | MuJoCo, Genesis, PyBullet |
| `.stl` | three-stdlib `STLLoader` | MuJoCo, Genesis, PyBullet, Blender |
| `.dae` / `.obj` | — | Blender import only |
| `.ply` | three-stdlib `PLYLoader` | Blender import only |
| `.spz` (Gaussian splat) | **deferred** | — |

Splat rendering (`@sparkjsdev/spark`) requires bumping `three` to `^0.180.0`. That version change
is a separate, deliberate decision — not bundled into the World format itself. Everything else in
the table ships today.

Implementation: `web/src/features/viewer/components/MeshAssetBody.tsx` (viewer),
`backend/services/simulator_adapters/{mujoco,genesis,pybullet}_scene.py` and
`backend/services/simulator_adapters/blender_workspace.py` (simulator transfer).

## Delivery: single file, multi-file, or folder

`CoreFolderUploadScreen.tsx`'s World panel accepts, in order of how much a scene actually needs:

1. **A link** — `https://.../world-layout.json`, fetched directly.
2. **Local Files** — one or more files picked or dropped together (the JSON plus whichever assets
   it needs).
3. **Local Folder** — a real folder picker (`webkitdirectory`), for scenes with enough assets that
   selecting them individually would be tedious.

All three converge on the same code path: `splitWorldLayoutFolderFiles` (in
`web/src/app/pages/index/worldLayoutFolderImport.ts`) finds the layout JSON among whatever was
selected, `buildWorldLayoutFolderAssetMap` indexes the rest into a relative-path → blob-URL map
(reusing the same multi-key-variant indexing already used for robot mesh folders), and mesh
references resolve against that map first, falling back to URL-relative resolution for the
link-import path.

A World also loads independent of a robot — `CoreFolderUploadScreen`'s "Load Setup" enables as
soon as either a robot or a world layout is staged, not only a robot.

## The proposal: one input, every simulator

A World is already simulator-agnostic by construction — the manifest never names a physics engine.
What's inconsistent is the other end. Of the 11 registered simulator targets
(`backend/models/simulator_runtime.py::SIMULATOR_ID_VALUES`), 6 actually consume a World for real;
5 are registered for runtime-status discovery and implement nothing:

| Simulator | Status | Transfer |
|---|---|---|
| MuJoCo | implemented | `convert` (urdf → mjcf), real mesh geoms |
| Genesis | implemented | `direct` (urdf), real mesh entities |
| PyBullet | implemented | `direct` (urdf), real mesh collision |
| MJX | implemented | `convert` (urdf → mjcf), GPU-vectorized rollouts |
| MJLab | implemented | `convert` (urdf → mjcf) |
| Blender | implemented | `direct` (urdf), `.stl`/`.ply`/`.dae`/`.obj` import |
| **Isaac Sim (NVIDIA)** | **planned** | usd — no adapter |
| Newton (NVIDIA) | planned | mjcf — no adapter |
| SAPIEN 2 | planned | urdf — no adapter |
| SAPIEN 3 | planned | urdf — no adapter |
| RoboSplatter | planned | renderer — no adapter |

Every "planned" target's `transfer_strategy = "planned"` in
`backend/services/simulator_adapters/planned_simulators.py`; calling its workspace endpoint
returns `SimulatorCapabilityError` unconditionally. Isaac Sim is the one that matters most here —
it's the only NVIDIA target with real install-base gravity for this project.

## What reaching parity takes

Both real-adapter shapes already in the codebase generalize — a planned simulator isn't starting
from nothing:

1. **Pick the transfer strategy.** `direct` if the target reads URDF natively (Genesis/PyBullet's
   shape); `convert` if it needs URDF turned into its own scene format first (MuJoCo/MJX's shape —
   USD, for Isaac Sim). See `DirectUrdfSimulatorPlugin` / `MjcfSimulatorPlugin` in
   `backend/services/simulator_adapters/plugin.py`.
2. **Resolve every mesh reference against real asset roots.** The portable-relative-path contract
   above is already engine-agnostic — reuse it, don't reinvent it.
3. **Place every object type, fall back safely on the rest.** Primitives need only basic geometry;
   mesh objects upgrade to real geometry when the asset resolves and degrade to a bounding shape
   when it doesn't — never a hard failure.

## Status

6 of 11 simulator targets implemented. Splat asset support deferred pending a three.js version
decision. No planned simulator (Isaac Sim included) has adapter work scoped yet — that's the next
step if this is worth pursuing project-wide.
