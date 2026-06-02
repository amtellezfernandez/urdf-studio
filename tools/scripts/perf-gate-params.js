export const PERF_GATE_TARGET_REDUCTION_FACTOR = 0.5;

export const PERF_GATE_BASELINE_BUILD_DURATION_MS = 120000;
export const PERF_GATE_TARGET_BUILD_DURATION_MS =
  PERF_GATE_BASELINE_BUILD_DURATION_MS * PERF_GATE_TARGET_REDUCTION_FACTOR;

export const PERF_GATE_WORLD_BENCHMARK_COMMAND = ["npm", "run", "world:bridge:benchmark"];
export const PERF_GATE_FRONTEND_FRAME_COMMAND = [
  "npm",
  "test",
  "--",
  "web/src/features/world/worldPerfGate.test.ts",
];
export const PERF_GATE_BUILD_COMMAND = ["npm", "run", "build"];
