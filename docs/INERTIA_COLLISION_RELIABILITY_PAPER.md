# Inertia-Collision Reliability Paper

## Goal
Provide one inertia visualization behavior that is fast, reliable, and hard to misread.

## Problem
In URDF files, inertia and collision data often come from different modeling steps:
- Inertia may be manually entered, diagonalized, stale, or frame-shifted.
- Collision may be simplified (proxy primitives) or mesh-based.
- Users compare both visually and expect consistency.

A single static formula is fast but can be wrong-looking. A pure collision-fit is consistent-looking but may hide bad inertia tensors.

## Principle
Use the IK orchestrator philosophy:
- Try the most physically meaningful strategy first.
- Relax only if consistency checks fail.
- Fall back to a robust geometric representation if physics data is not trustworthy.

This is exposed as one mode to the user, with internal staged selection.

## Single Strategy (Internal Stages)
For each link with inertial data:
1. `principal` candidate:
   - Compute equivalent box from full inertia tensor eigen decomposition.
2. `inertial-frame` candidate:
   - Compute equivalent box aligned to inertial frame axes (no principal rotation).
3. `collision-fitted` reference:
   - Build an axis-aligned fit in inertial frame from collision primitives (box/sphere/cylinder).

Selection:
- If no collision reference exists:
  - Prefer `principal`; fallback to `inertial-frame`.
- If collision reference exists:
  - Score candidates by volume and aspect mismatch against collision reference.
  - Choose `principal` when match is strong.
  - Choose best inertia candidate when match is acceptable.
  - Fall back to `collision-fitted` when inertia is implausible.

## Why Frontend, Not Backend
Decision: keep this in frontend.

Reasons:
- This is per-frame visualization logic tied to viewer state and toggles.
- Frontend avoids request latency and keeps interaction smooth.
- Existing data (`linkDataByName`, collision primitives, inertial origin/rpy) is already present in viewer memory.
- Backend preprocessing can be added later for mesh collision fitting, but primitives cover common fast paths now.

## Performance
- O(number of collision primitives) per link for fit computation.
- No network calls.
- No mesh decode added for this reliability path.
- Compatible with existing instanced rendering pipeline.

## Reliability Properties
- Never silently trusts an implausible inertia visualization when collision evidence contradicts it.
- Preserves physically correct principal-axis rendering when data is coherent.
- Produces stable fallback even with poor/incomplete inertia tensors.

## Future Extensions
- Optional backend cache for mesh-based collision AABB when primitive collisions are missing.
- Per-link quality badges (high/medium/low confidence) in viewer diagnostics panel.
- Threshold auto-tuning using dataset telemetry.
