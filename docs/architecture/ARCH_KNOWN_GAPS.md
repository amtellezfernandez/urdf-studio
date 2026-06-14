# Architecture Known Gaps

This list reflects current code reality and should be treated as active backlog.

1. RosViz viewer is still a 2D canvas fallback path; full 3D/WebGPU runtime is not implemented.
2. Runtime health telemetry is not yet split into explicit "readiness" and "operator-safe" contracts.
3. Session mode contracts are present, but persistence/recovery and branch-based replay provenance are not complete.
4. Release checks enforce global performance gates, but there is no dedicated RosViz throughput SLA gate yet (markers/TF/frame-rate under load).
