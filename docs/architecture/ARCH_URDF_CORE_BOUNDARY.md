# URDF Core Boundary

`i-love-urdf` is the public headless URDF transformer library.
`urdf-studio` is the private product shell around it.

## Move To `i-love-urdf`

- Deterministic URDF parsing, validation, analysis, transforms, and conversions.
- Generic repository and mesh-reference reasoning that works without Studio state.
- Thin package entrypoints needed for safe browser consumption of core URDF logic.

## Keep In `urdf-studio`

- Browser orchestration, backend clients, GitHub fetch/auth flows, worker scheduling, and caching policy.
- Viewer behavior, material overrides, camera behavior, selection UX, and Three.js scene policy.
- Studio-only metadata, comments, directives, or workflows that reveal product behavior.

## Extraction Test

Move code to `i-love-urdf` only if all of this is true:

1. It runs headlessly with no Studio UI or backend contract.
2. It is useful as a CLI, library, or server primitive outside Studio.
3. It does not encode Studio-specific workflow policy or private metadata.

If any of those fail, keep it in `urdf-studio`.
