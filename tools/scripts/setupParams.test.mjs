import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKEND_PYTHON_CORE_DEPENDENCIES,
  PYTHON_ENV_DIRNAME,
  SETUP_NPM_INSTALL_FLAGS,
  SIMULATOR_OPTIONAL_RUNTIME_IDS,
  SIMULATOR_OPTIONAL_RUNTIMES,
} from "./setupParams.js";

test("setup params describe the clean local runtime", () => {
  assert.equal(PYTHON_ENV_DIRNAME, ".venv");
  assert.ok(SETUP_NPM_INSTALL_FLAGS.includes("--audit=false"));
  assert.ok(BACKEND_PYTHON_CORE_DEPENDENCIES.includes("fastapi"));
  assert.ok(BACKEND_PYTHON_CORE_DEPENDENCIES.includes("yourdfpy"));
  assert.equal(
    BACKEND_PYTHON_CORE_DEPENDENCIES.some((dependency) => /lerobot|openarm|mjlab/i.test(dependency)),
    false,
  );
});

test("simulator optional runtimes are explicit and separate from core setup", () => {
  assert.deepEqual(SIMULATOR_OPTIONAL_RUNTIME_IDS, [
    "genesis",
    "mujoco",
    "pybullet",
    "blender",
  ]);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.genesis.packages.includes("genesis-world"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.mujoco.packages.includes("mujoco"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.pybullet.packages.includes("pybullet"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.blender.kind, "external");
});
