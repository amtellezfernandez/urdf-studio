# IKD Architecture

## Goals

- Keep control loop independent from networking.
- Support low-latency target updates with idempotent HTTP semantics.
- Stream downsampled telemetry over WebSocket.

## Runtime structure

- API thread(s): validates `POST /target`, stores latest target sample.
- API `POST /model`: parses URDF and loads chain into native AMIK runtime.
- Control loop task: fixed-rate tick, consumes latest sample, produces telemetry snapshot.
- Telemetry fanout: broadcast channel from control loop to WS clients.

## Data flow

```text
Browser UI
  ├─ POST /target ───────────────────────▶ ikd (latest target buffer)
  └─ WS /telemetry ◀──────────── broadcast snapshots from control loop
```

## Current implementation status

- Deterministic fixed-rate loop skeleton implemented.
- Latest-target handoff implemented.
- Stale target signaling implemented.
- Telemetry broadcast implemented.
- Native AMIK (CCD position solver) implemented in Rust and used for pose/position targets when a model is loaded.
- Orientation payload is accepted but current AMIK control path is position-authoritative.
