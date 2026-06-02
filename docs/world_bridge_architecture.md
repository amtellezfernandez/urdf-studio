# URDF World Bridge Architecture

## Goal

Run robot/world simulation control natively in URDF Studio without depending on Isaac runtime behavior.

## Dedicated Placement

The bridge runtime is isolated in:

- `backend/world_bridge/params.py`
- `backend/world_bridge/types.py`
- `backend/world_bridge/runtime.py`
- `backend/api/world_bridge.py`

This keeps `third_party/` read-only integration reference material and avoids coupling core runtime behavior to external repos.

## Runtime Split (Python vs Rust)

Use a two-plane architecture:

- Control plane (Python / FastAPI): session lifecycle, scenario orchestration, API contracts, validation.
- Data plane (Rust / `worldd`, currently located under `ikd/` for compatibility): high-frequency command ingestion, interpolation, streaming, and deterministic replay loops.

## Why This Split

- Python is faster to iterate for workflow/business logic and API evolution.
- Rust is better for predictable latency on continuous control and long-horizon playback.
- The split avoids a full backend rewrite while still giving a path to high-performance execution.

## Migration Trigger Criteria to Rust

Move a path from Python to Rust when any criterion is consistently exceeded in production:

- Command loop frequency must sustain beyond 100 Hz with low jitter.
- Event throughput requires sustained low-latency fanout under concurrent sessions.
- Replay determinism or timing variance in Python becomes unacceptable for debugging/validation.

## Next Steps

1. Add a backend relay from `backend/api/world_bridge.py` to the Rust stream for high-rate sessions.
2. Keep API contract stable so the frontend does not care which runtime executes commands.
3. Expand parity checks to include WS event-stream ordering and backpressure behavior.

## Conformance Gate

- Run `npm run world:bridge:conformance` for strict schema/translation conformance.
- Run `npm run world:bridge:conformance:live` for live parity between Python runtime and running `worldd`.

## Performance Gate

- Run `npm run world:bridge:benchmark` for baseline latency and throughput checks.
- Benchmark defaults and targets are centralized in `backend/world_bridge/perf_params.py`.
- Use `python3 -m backend.scripts.world_bridge_benchmark --json-output benchmarks/world_bridge/latest.json` to persist results for trend tracking.
- All tracked budgets are enforced with a 50% tightening factor via `PERF_TARGET_REDUCTION_FACTOR`.
- The benchmark enforces latency, payload-size, startup, memory, and reliability (error/retry) targets.
- Run `npm run perf:frontend:frame-gate` to enforce frontend frame-time budgets for world scenario sampling.
- Run `npm run perf:gate` to execute backend + frontend + build-duration gates in one command.
