# Scenario Policy Protocol (vla_ws)

## What this document is

The wire protocol between the scenario episode runner and an external policy/VLA inference
server, used by `policy.kind: vla_ws` scenarios. It is Genie Sim's WebSocket + msgpack
inference protocol (the transport, envelope, retry, and codec are reused — the msgpack-numpy
codec and comm helpers are vendored verbatim under
`backend/vendor/geniesim/geniesim_benchmark/utils/`), with a simulator-agnostic state/action
payload in place of Genie's dual-arm embodiment shape.

- Client: `backend/services/scenario_policies/vla_ws.py` (`VlaWsPolicy`)
- Codec: vendored `geniesim_benchmark.utils.msgpack_numpy` (`packb`/`unpackb`,
  numpy arrays encoded with the `__ndarray__` extension convention)
- Transport: one WebSocket connection per episode worker; binary msgpack messages

## Request (runner → server)

Sent whenever the policy's action buffer is empty (`need_infer()`); the server's response is
an action chunk replayed one action per control step without re-inferring.

```jsonc
{
  "method": "infer",
  "params": {
    "states": {
      "joint_states": {"gantry_x": 0.4, "gantry_y": -0.15}   // name -> position (rad | m)
    },
    "object_poses": {
      "carton_1": {"position_xyz": [x, y, z], "quat_wxyz": [w, x, y, z]}
    },
    "prompt": "Pick up the carton_1 and place it into bin_a",  // resolved instruction
    "robot_type": "carton_gantry",       // policy.params.robot_type (embodiment tag)
    "task_name": "carton_sorting_0001",  // scenario_id
    "step_num": 42,                      // control step index
    "sim_time_s": 0.84
  }
}
```

Camera images are not sent yet; when the `camera_rgb` observation modality lands they will
use Genie's `params.images.<camera>` JPEG-bytes convention.

## Response (server → runner)

One action chunk. `values` rows are consumed one per control step.

```jsonc
{
  "joints": {
    "kind": "JOINT_ABS",                 // only JOINT_ABS is accepted
    "names": ["gantry_x", "gantry_y"],
    "values": [[0.42, -0.1], [0.44, -0.05]]   // [chunk][len(names)]
  },
  "attach": "carton_1",                  // optional; fires on the chunk's first action
  "detach": false                        // optional; fires on the chunk's first action
}
```

`attach`/`detach` require the scenario to set `runtime.grasp_attach: weld` and
`runtime.attach_link`. Genie's dual-arm `left_arm`/`right_arm`/`left_effector` response
shape is embodiment-specific and not accepted; servers targeting arbitrary URDFs must
return the named-joint form.

## Errors and retry

Malformed responses raise `VlaWsPolicyError` and fail the episode. Connection setup uses a
30 s open timeout. The vendored retry/backoff helpers
(`geniesim_benchmark.utils.comm.retry.run_with_inference_retry`,
`InferenceUnavailableError`) are available for callers that wrap `act()` with
retry-on-unavailable semantics.

## Testing a server

`backend/tests/test_scenario_vla_ws_policy.py` shows a minimal in-process echo server; any
server that round-trips that test's request/response shapes will drive scenario episodes.
