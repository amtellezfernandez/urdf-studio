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
export const PERF_GATE_BUILD_CHUNK_SIZE_COMMAND = ["node", "tools/scripts/buildChunkSizeGate.js"];

export const PERF_GATE_BUILD_CHUNK_SIZE_CHECK = {
  distDir: "web/dist",
  totalJsMaxBytes: 4_800_000,
  chunkLimits: [
    { name: "App", prefix: "App-", maxBytes: 980_000, required: true },
    { name: "three", prefix: "three-", maxBytes: 850_000, required: true },
    { name: "meshDecode worker", prefix: "meshDecode.worker-", maxBytes: 600_000, required: true },
    { name: "Viewer3D", prefix: "Viewer3D-", maxBytes: 430_000, required: true },
    { name: "Radix UI", prefix: "radix-ui-", maxBytes: 360_000, required: true },
    { name: "React Three", prefix: "react-three-", maxBytes: 330_000, required: true },
  ],
};
