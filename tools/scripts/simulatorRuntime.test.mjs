import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSimulatorSelection,
  pythonPackagesForSimulatorIds,
  resolveRuntimePython,
} from "./simulatorRuntime.js";

test("simulator selection supports explicit targets and all", () => {
  assert.deepEqual(normalizeSimulatorSelection(["mujoco", "pybullet"]), [
    "mujoco",
    "pybullet",
  ]);
  assert.deepEqual(normalizeSimulatorSelection(["all"]), [
    "genesis",
    "mujoco",
    "mjx",
    "pybullet",
    "isaac-sim",
    "isaac-lab",
    "isaac-gym",
    "sapien",
    "coppeliasim",
    "blender",
  ]);
});

test("simulator selection rejects unknown targets", () => {
  assert.throws(() => normalizeSimulatorSelection(["unknown"]), /Unknown simulator/);
});

test("simulator install packages stay target-specific", () => {
  assert.deepEqual(pythonPackagesForSimulatorIds(["mujoco", "pybullet"]), [
    "mujoco",
    "pybullet",
  ]);
  assert.deepEqual(pythonPackagesForSimulatorIds(["isaac-sim", "isaac-lab"]), []);
  assert.deepEqual(pythonPackagesForSimulatorIds(["sapien", "mjx"]), [
    "sapien",
    "mujoco",
    "jax",
  ]);
  assert.deepEqual(pythonPackagesForSimulatorIds(["blender"]), []);
});

test("runtime Python honors existing simulator environments", () => {
  assert.equal(
    resolveRuntimePython({ URDF_STUDIO_PYTHON: "/tmp/sim/bin/python" }),
    "/tmp/sim/bin/python",
  );
});
