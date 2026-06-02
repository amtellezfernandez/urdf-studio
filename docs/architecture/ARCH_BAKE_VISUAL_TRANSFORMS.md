# Bake Visual Transforms

## Executive Summary

`Bake Visual Transforms` is the repair path for assets that are structurally coherent but unsafe to rewrite with a global basis transform.

The operation preserves the kinematic tree and moves compensating geometry offsets out of URDF `visual` or `collision` origins and into the mesh asset layer. This converts local transform debt into a cleaner asset representation without changing the assembled robot pose.

## Problem

Many URDFs use `visual > origin` and `collision > origin` as compensation for bad mesh export orientation.

That creates a trap:

- the robot looks correct in the viewer,
- but the assembly depends on local `rpy` debt,
- so a global basis rewrite double-corrects the asset and breaks it.

`LeKiwi` is the current reference case.

## Transform Contract

For a given mesh attached to a link:

- `T_link`: dynamic link pose from the kinematic tree
- `T_origin`: static URDF `origin xyz/rpy`
- `V_mesh`: mesh vertex data in local mesh coordinates

Rendered geometry follows:

- `P_visual = T_link * T_origin * V_mesh`

To bake part or all of `T_origin` into the mesh, choose a mesh bake transform `T_bake` and solve:

- `T_new_origin * T_bake = T_origin`

So:

- `T_new_origin = T_origin * inverse(T_bake)`

Special case, full bake:

- `T_bake = T_origin`
- `T_new_origin = I`

This is the core invariant preview and export must share.

## Implementation Boundary

Phase 1: pure transform math

- `web/src/features/urdf/bake/transformMath.ts`
- converts between URDF `xyz/rpy` and rigid `THREE.Matrix4`
- computes residual URDF origins after a chosen bake transform

Phase 2: virtual bake preview

- update viewer/editor state to apply `T_bake` non-destructively
- show zeroed or reduced origins in staged editor output
- no mesh mutation yet

Phase 3: mesh pipeline

- apply `T_bake` into mesh vertices during export or explicit repair
- support mesh formats that Studio already resolves and previews

## Scope

Included in v1:

- `visual` transform baking
- `collision` mesh baking when collision uses mesh geometry
- rigid transforms only

Explicitly out of scope in v1:

- joint topology edits
- inertial frame rewrites
- primitive collision reshaping
- non-rigid scaling

## Safety Rules

- never change kinematic parent/child relationships during bake
- reject non-unit-scale bake matrices
- rerun the robot frame linter after bake preview and after export
- only promote to `canonical` after lint confirms both basis and low compensation debt

## Current Policy Mapping

- `canonical`
  - no bake action needed

- `asset-native`
  - preserve source frame
  - bake may still be useful, but is not mandatory

- `unsafe-to-rewrite`
  - preferred action is `Bake Visual Transforms`
  - block destructive global align until bake reduces local compensation debt
