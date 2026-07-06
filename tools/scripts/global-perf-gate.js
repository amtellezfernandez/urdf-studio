#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

import {
  PERF_GATE_BUILD_COMMAND,
  PERF_GATE_BUILD_CHUNK_SIZE_COMMAND,
  PERF_GATE_FRONTEND_FRAME_COMMAND,
  PERF_GATE_TARGET_BUILD_DURATION_MS,
  PERF_GATE_WORLD_BENCHMARK_COMMAND,
} from "./perf-gate-params.js";
import { readUnknownErrorMessage } from "./cliHelpers.js";

const EXIT_SUCCESS = 0;
const PERF_GATE_DURATION_DECIMALS = 2;

const runCommand = (command, label) => {
  const [binary, ...args] = command;
  if (!binary) {
    throw new Error(`Missing command binary for ${label}`);
  }
  const startedMs = performance.now();
  const result = spawnSync(binary, args, {
    stdio: "inherit",
    env: process.env,
  });
  const durationMs = performance.now() - startedMs;
  if (result.status !== EXIT_SUCCESS) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
  return durationMs;
};

const main = () => {
  console.log("[perf-gate] running backend benchmark gate");
  runCommand(PERF_GATE_WORLD_BENCHMARK_COMMAND, "backend benchmark");

  console.log("[perf-gate] running frontend frame-time gate");
  runCommand(PERF_GATE_FRONTEND_FRAME_COMMAND, "frontend frame-time gate");

  console.log("[perf-gate] running build-duration gate");
  const buildDurationMs = runCommand(PERF_GATE_BUILD_COMMAND, "build");
  console.log(`[perf-gate] build_duration_ms=${buildDurationMs.toFixed(PERF_GATE_DURATION_DECIMALS)}`);
  if (buildDurationMs > PERF_GATE_TARGET_BUILD_DURATION_MS) {
    throw new Error(
      "build duration exceeded target: "
        + `${buildDurationMs.toFixed(PERF_GATE_DURATION_DECIMALS)}ms > `
        + `${PERF_GATE_TARGET_BUILD_DURATION_MS.toFixed(PERF_GATE_DURATION_DECIMALS)}ms`
    );
  }

  console.log("[perf-gate] running build chunk-size gate");
  runCommand(PERF_GATE_BUILD_CHUNK_SIZE_COMMAND, "build chunk-size gate");

  console.log("[perf-gate] all performance gates passed");
};

try {
  main();
} catch (error) {
  const message = readUnknownErrorMessage(error);
  console.error(`[perf-gate] failure: ${message}`);
  process.exit(1);
}
