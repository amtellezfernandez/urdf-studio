# Robot Frame Integrity

`URDF Studio` must distinguish between:

- robots authored in the canonical research frame (`+z` up / `+x` forward),
- robots that render acceptably but carry asset-native frame debt,
- robots that are unsafe to rewrite with a global orientation transform.

## Why this exists

The orientation review surface answers one question well:

- what basis does the asset likely use?

It does not answer a second question that matters just as much:

- is a destructive basis rewrite safe?

The bundled `LeKiwi` demo exposed that gap. It renders upright, but the URDF carries heavy local `origin rpy` compensation in visuals, collisions, and joints. A naïve global `Z-up` rewrite over-corrects the assembly and breaks the robot.

## Linter model

Primary path:

- `web/src/features/urdf/lint/robotFrameLinter.ts`

The first-pass linter combines:

1. Existing orientation inference from `i-love-urdf`
   - likely up / forward basis
   - wheel-axis vote distribution

2. Local transform compensation debt
   - share of `visual` and `collision` entries with non-trivial `origin rpy`
   - share of joints with non-trivial `origin rpy`

3. Rewrite safety heuristics
   - wheel-axis dominant direction should not collapse onto the inferred up axis
   - high local compensation ratios make global rewrite unsafe even when orientation inference is confident

Thresholds live in:

- `web/src/features/urdf/lint/robotFrameLinterParams.ts`

## Verdicts

- `canonical`
  - inferred `+z` up / `+x` forward
  - low local transform compensation debt
  - no wheel/up-axis conflict

- `asset-native`
  - robot is coherent enough to render and edit
  - but basis and/or local compensation debt mean Studio should preserve the source asset rather than auto-rewriting it

- `unsafe-to-rewrite`
  - high local compensation debt and/or wheel-axis conflict
  - destructive orientation rewrite should be blocked

- `underconstrained`
  - basis inference is too weak to trust
  - require explicit operator confirmation or richer geometry evidence

## LeKiwi classification

`LeKiwi` should currently classify as:

- non-canonical asset basis
- heavy local compensation debt
- unsafe to rewrite

That is the correct posture for Studio today:

- preserve the asset-native URDF
- allow non-destructive display/runtime handling
- avoid a blind XML-wide basis rewrite

## Intended follow-up

- surface the linter verdict in the top-bar orientation UI
- split display-frame policy from source-asset policy
- gate orientation rewrite actions on the linter verdict instead of only on basis mismatch
