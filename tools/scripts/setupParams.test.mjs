import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKEND_PYTHON_CORE_DEPENDENCIES,
  PYTHON_ENV_DIRNAME,
  SIMULATOR_PYTHON_ENV_DIRNAME,
  SETUP_NPM_INSTALL_FLAGS,
  SIMULATOR_OPTIONAL_RUNTIME_IDS,
  SIMULATOR_OPTIONAL_RUNTIMES,
} from "./setupParams.js";

test("setup params describe the clean local runtime", () => {
  assert.equal(PYTHON_ENV_DIRNAME, ".venv");
  assert.equal(SIMULATOR_PYTHON_ENV_DIRNAME, ".venv-sim311");
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
    "mjx",
    "newton",
    "pybullet",
    "isaac-sim",
    "isaac-lab",
    "isaac-gym",
    "sapien",
    "coppeliasim",
    "blender",
  ]);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.genesis.packages.includes("genesis-world"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.genesis.packages.includes("torch"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.mujoco.packages.includes("mujoco"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.mjx.packages.includes("mujoco-mjx"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.mjx.packages.includes("jax"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.newton.packages.includes("newton[importers]"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.newton.importNames.includes("trimesh"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.pybullet.packages.includes("pybullet"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES["isaac-sim"].packages.includes("isaacsim"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES["isaac-sim"].pythonVersion, "3.11");
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES["isaac-lab"].packages.includes("isaaclab"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES["isaac-lab"].pythonVersion, "3.11");
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES["isaac-gym"].packages.length, 0);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.sapien.packages.includes("sapien"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.coppeliasim.packages.includes("coppeliasim-zmqremoteapi-client"), true);
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.coppeliasim.executableEnv, "URDF_STUDIO_COPPELIASIM_PATH");
  assert.equal(SIMULATOR_OPTIONAL_RUNTIMES.blender.kind, "external");
});
