# WSP Physical-State Compiler

This branch adds the first backend-only slice of the WSP compiler loop:

```text
scene or world package
  -> physical state frame
  -> state/action token sequence
  -> deterministic rollout baseline
  -> executability audit
```

It is not a learned world model yet. The purpose is to make the physical state layer explicit enough to plug into learned rollouts later.

## Commands

Compile a static layout or world package:

```bash
npm run wsp:compile -- web/public/world-layouts/static-transfer-smoke.world-layout.json --out /tmp/wsp-compiled.json
```

Run a deterministic rollout:

```bash
npm run wsp:rollout -- /tmp/wsp-compiled.json \
  --action-json '{"action_id":"push-target","action_type":"push","actor_id":"transfer-table","object_id":"transfer-target","params":{"delta_xyz":[0.05,0,0]}}' \
  --steps 2 \
  --step-ms 50 \
  --out /tmp/wsp-rollout.json
```

Audit the rollout:

```bash
npm run wsp:audit -- /tmp/wsp-rollout.json --out /tmp/wsp-audit.json
```

The audit currently checks:

- entity quaternion validity
- positive metric geometry sizes
- action references to existing entities
- primitive AABB collision overlap unless an explicit contact/support/attached relation permits it

## Current Boundary

Ready:

- typed physical entities, relations, constraints, actions, frames, rollout traces, and executability reports
- static layout and world package compilation into physical state tokens
- deterministic action rollout for `push`, `translate`, `move_object`, and `set_pose`
- executable pass/fail reports plus basic correction branches

Not ready:

- learned next-state prediction
- contact stability or friction-aware checks
- robot reachability and full joint-limit rollout auditing
- simulator-state export from predicted dynamic traces
- UI integration
