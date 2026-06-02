# Health vs Readiness (Code-True)

## Runtime health

Runtime health indicates transport/session behavior such as:
- stream connected state,
- sequence gaps,
- frame counts,
- deterministic hash telemetry.

Primary UI:
- `web/src/studio_ui/panels/RuntimeHealthPanel.tsx`

## Readiness

Readiness means the system is actually safe and valid for the intended operation mode
(live debug, live record, replay, hybrid compare), with correct data/time semantics.

Readiness is stricter than "connected".

## Non-negotiable rule

"Runtime up" is not "ready for operation".

We do not treat stream connectivity, panel status, or frame flow alone as readiness.
