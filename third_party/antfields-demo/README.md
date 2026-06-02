# antfields-demo

Reference only. This directory does not vendor or redistribute upstream source code.

## Upstream

- Repository: https://github.com/Rtlyc/antfields-demo
- Observed on: March 31, 2026
- Purpose upstream: minimal active-learning navigation demo built on iGibson

## Why It Is Here

`antfields-demo` looks relevant to world-layout navigation, obstacle-aware movement, and occupancy-style scene reasoning. It is useful as a design reference for ideas, not as a runtime dependency for this repository.

## Why It Is Not Vendored Here

- The upstream README states the project is licensed under the Purdue University Non-Commercial Open Source Software License.
- This repository is proprietary, so upstream code should not be copied in without a separate licensing review and explicit approval.
- The implementation is tightly coupled to a research/demo stack: iGibson, Docker, GPU-oriented setup, custom BVH distance queries, and Python/C++/CUDA build assumptions.
- This repository already has its own world-object and rover-approach path in the web/runtime stack, so a direct drop-in would create architectural duplication rather than a clean integration.

## Useful Ideas To Reuse Internally

These are the concepts worth adapting into native URDF Studio code:

### 1. Occupancy-style world projection

Convert world objects into a 2D traversability layer aligned to the active ground plane:

- project object footprints onto the navigation plane
- inflate footprints by rover base radius and safety margin
- mark blocked, free, and unknown cells
- maintain a stable mapping from 3D world objects to 2D navigation obstacles

This would provide a more general navigation substrate than the current direct-segment plus single-detour approach.

### 2. Clearance-aware path search

Use a proper search over the projected world layout instead of only evaluating a direct path and one detour waypoint:

- grid or sparse lattice search over free space
- path cost that balances distance, turning cost, and clearance
- explicit handling for narrow passages and dead ends
- deterministic fallback when no valid route exists

### 3. Reachability-driven stopping policy

Separate:

- base travel goal
- final manipulation standoff
- object contact/support radius

This repo already does part of this in rover approach planning. A reusable planner should expose these as explicit inputs so navigation and manipulation stay consistent.

### 4. Exploration / unknown-space semantics

For future world-building workflows, preserve the distinction between:

- observed free space
- confirmed obstacles
- unknown space

That matters if URDF Studio evolves toward partial scans, scene reconstruction, or camera-to-world mapping where the full layout is not known upfront.

### 5. Cached navigation representation

Build and cache a feature-local navigation model derived from current world objects:

- planar obstacle set
- inflated collision footprints
- traversability grid or graph
- invalidation keyed off world-object edits, transforms, visibility, and support-surface changes

This avoids recomputing path inputs ad hoc inside interaction handlers.

## Recommended Integration Direction For This Repo

If we implement this here, prefer a native module that consumes existing world-object data and feeds current rover locomotion controls:

- planner input: world objects already used by viewer/world interactions
- planner output: waypoint list or path corridor in world coordinates
- execution: existing rover approach / wheel-drive control loop
- validation: unit tests for occupancy projection, obstacle inflation, and path selection regressions

## Existing Repo Touchpoints

- Viewer locomotion and detour logic: `web/src/features/viewer/Viewer3D.tsx`
- Collision and world geometry handling: `web/src/features/viewer/CollisionGeometries.tsx`
- Fast drag/runtime collision checks: `web/src/features/viewer/drag-runtime/`

## Follow-up Candidate

Implement a native `world-navigation` feature module with:

- a parameterized occupancy builder
- obstacle inflation constants in a dedicated params module
- A* or lattice planner tests
- integration into rover approach before wheel-command execution
