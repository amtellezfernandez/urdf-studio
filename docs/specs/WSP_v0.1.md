# World Scene Package (WSP) v0.1

## Purpose

`WSP` is the portable world-sharing package format for URDF Studio.
For current prose, use `docs/specs/WORLD_FORMAT.md`; this file remains as the historical v0.1
summary while the JSON schema continues to live at `docs/specs/WSP_manifest.schema.json`.

It standardizes:

- world metadata and versioning
- runtime compatibility declarations
- deterministic world snapshot payloads
- artifact digest references
- provenance and security references

## Canonical File

- Manifest schema: `docs/specs/WSP_manifest.schema.json`

## Scope Guard

- `WSP` is for scene sharing (URDF + world snapshot).
- Planning world-model artifacts are handled separately via `PWMP/PWMI` in `pwmp-runtime`.

## Required Fields

- `schema_version`
- `package_id`
- `version`
- `title`
- `created_at`
- `runtime_targets`
- `interface`
- `artifacts`
- `world_snapshot`
- `provenance`
- `security`

## Snapshot Semantics

- `world_snapshot.urdf_xml` stores the full URDF source.
- `world_snapshot.joint_positions` stores current joint positions in radians.
- `world_snapshot.cameras` stores camera attachment + intrinsic/extrinsic config.
- `world_snapshot.objects` stores scene objects in world coordinates.
- `world_snapshot.scenario_time_ms` and `scenario_duration_ms` store scenario clock state.
- Static scene packages use `scenario_duration_ms = 0` and must set `scenario_time_ms = 0`.

## World Objects

Each `world_snapshot.objects[]` entry is a simulator-transfer object with:

- `id`, `name`, `type`, `position_xyz`, `size_xyz`, and `color`.
- `type`: `cube`, `point`, `sphere`, `cylinder`, or `mesh`.
- `rotation_rpy_rad` when orientation matters.
- `simulation` for physics metadata: `fixed`, `collision`, `mass_kg`, `friction`, `restitution`, and `semantic_role`.
- `asset_ref`, `asset_scale_xyz`, or `mesh` metadata when the object is backed by a mesh asset. Mesh objects must include a portable relative asset reference inside the package; absolute paths, URI schemes, traversal, empty segments, and `.`/`..` segments are invalid.

Schema v1.1 adds the source-of-truth split used by the current World format:

- `appearance.representations[]` for render/perception assets such as meshes and Gaussian splats.
- `physics.collision_geometry` plus mass/friction/inertia fields for what simulator adapters consume.
- `consistency` to link an appearance representation to its physics proxy and record fit status.

Gaussian splats are appearance-only; they must be paired with `physics.collision_geometry` before
the object is simulator-portable.

Blender-added mesh objects enter Studio as `type = "mesh"` when the Blender object carries a portable relative `asset_ref`; otherwise they enter as cube world objects with `simulation.semantic_role = "blender_import"`. Existing object transforms, dimensions, display colors, camera poses, camera FOV, new objects, and deleted source objects/cameras can be applied automatically. Robot kinematics, inertials, collisions, transmissions, material-domain edits, and mesh-domain edits remain outside automatic package apply.

## Model Separation

- `WSP` does not define world-model rollout semantics.
- Planning/model interfaces belong to `PWMP/PWMI` and are versioned independently.
- If model hints are present in scene manifests, they are treated as non-normative metadata.

## Runtime Contract

- `runtime_targets` declares where the package can execute (`native`, `python`, `container`).
- The first-party native runtime target is currently `worldd`.

## Integrity and Trust

- Every artifact reference uses `digest_sha256` computed with cryptographic SHA-256 (no weak fallback digests).
- A `world_snapshot` artifact digest is the lowercase SHA-256 hex digest of the UTF-8 bytes of the canonical JSON serialization of the `world_snapshot` object.
- Canonical JSON uses valid JSON values only. Object keys are sorted with ECMAScript default string ordering (UTF-16 code units), arrays preserve order, and strings use standard JSON string escaping.
- Numbers must be finite and serialize exactly as ECMAScript `JSON.stringify(number)` would serialize them. `-0` canonicalizes to `0`; `NaN`, `Infinity`, and `-Infinity` are invalid.
- `security.signature_ref`, `security.attestation_refs`, and `security.sbom_ref` provide trust metadata.
- Verification policy is handled by registry services and CI, not by manifest shape alone.

## Validation

- Backend API:
  - `POST /worlds/packages/validate`
- CLI:
  - `node tools/scripts/world-package-cli.js validate <manifest.json>`
