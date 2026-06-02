# Architecture Docs Index

Single entry point for architecture review and onboarding. Read in this order:

1. `docs/studio-architecture.md`
   - Enforced frontend layering (`studio_core`, `runtime_engine`, `studio_ui`).

2. `docs/architecture/ARCH_CODE_TRUTH.md`
   - What the code does today, path-by-path.

3. `docs/architecture/ARCH_DEFAULTS.md`
   - Defaults that materially change runtime behavior.

4. `docs/health/HEALTH_VS_READINESS.md`
   - Why runtime up/connected is not equivalent to operator-safe readiness.

5. `docs/architecture/ARCH_KNOWN_GAPS.md`
   - Explicit limitations and planned hardening work.

6. `docs/architecture/ARCH_URDF_CORE_BOUNDARY.md`
   - What belongs in `i-love-urdf` versus what stays private in Studio.

7. `docs/architecture/ARCH_ROBOT_FRAME_INTEGRITY.md`
   - How Studio classifies canonical vs asset-native vs unsafe robot frame authoring.

8. `docs/architecture/ARCH_BAKE_VISUAL_TRANSFORMS.md`
   - The transform contract and staged implementation for baking local geometry compensation into mesh assets.

Validation:
- `npm run architecture-check`
- `npm run policy-check`
