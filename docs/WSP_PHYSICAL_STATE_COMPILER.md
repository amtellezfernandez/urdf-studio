# WSP Physical-State Compiler

This branch adds the first backend-only slice of the WSP compiler loop:

```text
scene or world package
  -> physical state frame
  -> state/action token sequence
  -> deterministic rollout baseline
  -> executability audit
  -> corrective branch generation
  -> simulator-state export
```

It is not a learned world model yet. The purpose is to make the physical state layer explicit enough to plug into learned rollouts later.

## Commands

Compile a static layout or world package:

```bash
npm run wsp:compile -- web/public/world-layouts/hkhack-pallet-dock.world-package.json --out /tmp/wsp-compiled.json
```

Run a deterministic rollout:

```bash
npm run wsp:rollout -- /tmp/wsp-compiled.json \
  --action-json '{"action_id":"push-pallet-to-dock","action_type":"push","actor_id":"robot_1","object_id":"pallet_7","destination_id":"dock_d2","duration_ms":1000,"params":{"delta_xyz":[0.5,0,0],"max_force_n":120,"battery_cost":0.1}}' \
  --steps 2 \
  --step-ms 500 \
  --out /tmp/wsp-rollout.json
```

Audit the rollout:

```bash
npm run wsp:audit -- /tmp/wsp-rollout.json --out /tmp/wsp-audit.json
```

Repair a failed rollout:

```bash
npm run wsp:repair -- /tmp/wsp-rollout.json --out /tmp/wsp-repair.json
```

Export an executable trace or repair branch to MuJoCo:

```bash
npm run wsp:export -- /tmp/wsp-rollout.json \
  --repair-plan /tmp/wsp-repair.json \
  --branch stop_and_replan \
  --target mujoco \
  --out /tmp/wsp-corrected.xml
```

The audit currently checks:

- entity quaternion validity
- positive metric geometry sizes
- action references to existing entities
- primitive AABB collision overlap unless an explicit contact/support/attached relation permits it
- push contact force stability when mass/friction/max force are known
- battery reserve when actor battery and action cost are known
- dock availability when an action targets a dock

## Current Boundary

Ready:

- typed physical entities, relations, constraints, actions, frames, rollout traces, and executability reports
- static layout and world package compilation into physical state tokens
- deterministic action rollout for `navigate`, `push`, `translate`, `move_object`, `reserve_dock`, `wait`, `handoff_to_human`, `inspect`, `replan`, and `set_pose`
- executable pass/fail reports plus correction branches
- MuJoCo MJCF export for executable traces and selected repair branches

Not ready:

- learned next-state prediction
- robot reachability and full joint-limit rollout auditing
- high-fidelity contact dynamics or frictional simulation
- Genesis/Isaac/Gazebo export of corrected dynamic traces
- UI integration
