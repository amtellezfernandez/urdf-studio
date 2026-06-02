import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  clearLoadedRobotEnvOverlayValues,
  loadPrivateEnvFiles,
  parsePrivateEnv,
} from "./privateEnv.js";

test("parsePrivateEnv handles comments, exports, and quoted values", () => {
  assert.deepEqual(
    parsePrivateEnv(`
      # private robot host config
      export URDF_ROBOT_GATEWAY_RUNTIME_MODE=control
      URDF_ROBOT_GATEWAY_OPENARM_LEFT_PORT=left-xoq # operator note
      URDF_ROBOT_GATEWAY_OPENARM_RIGHT_PORT="right xoq"
      URDF_SIMULATOR_API_TOKEN='token#literal'
    `),
    {
      URDF_ROBOT_GATEWAY_RUNTIME_MODE: "control",
      URDF_ROBOT_GATEWAY_OPENARM_LEFT_PORT: "left-xoq",
      URDF_ROBOT_GATEWAY_OPENARM_RIGHT_PORT: "right xoq",
      URDF_SIMULATOR_API_TOKEN: "token#literal",
    },
  );
});

test("loadPrivateEnvFiles loads local files without overriding shell env", () => {
  const rootDir = "/workspace/urdf-studio";
  const firstPath = path.resolve(rootDir, ".env.local");
  const secondPath = path.resolve(rootDir, ".env.robot.local");
  const files = new Map([
    [
      firstPath,
      [
        "URDF_ROBOT_GATEWAY_RUNTIME_MODE=observe",
        "URDF_ROBOT_GATEWAY_ADAPTER=fake_openarm",
        "URDF_ROBOT_GATEWAY_OPENARM_LEFT_PORT=left-from-local",
      ].join("\n"),
    ],
    [
      secondPath,
      [
        "URDF_ROBOT_GATEWAY_RUNTIME_MODE=control",
        "URDF_ROBOT_GATEWAY_ADAPTER=openarm_native",
        "URDF_ROBOT_GATEWAY_OPENARM_LEFT_PORT=left-from-robot",
      ].join("\n"),
    ],
  ]);
  const env = { URDF_ROBOT_GATEWAY_OPENARM_LEFT_PORT: "left-from-shell" };

  const loaded = loadPrivateEnvFiles({
    rootDir,
    env,
    fileExists: (filename) => files.has(filename),
    readFile: (filename) => files.get(filename),
  });

  assert.deepEqual(loaded, [firstPath, secondPath]);
  assert.equal(env.URDF_ROBOT_GATEWAY_RUNTIME_MODE, "control");
  assert.equal(env.URDF_ROBOT_GATEWAY_ADAPTER, "openarm_native");
  assert.equal(env.URDF_ROBOT_GATEWAY_OPENARM_LEFT_PORT, "left-from-shell");
});

test("loadPrivateEnvFiles overlays the selected per-robot env after shared robot env", () => {
  const rootDir = "/workspace/urdf-studio";
  const sharedPath = path.resolve(rootDir, ".env.robot.local");
  const robotPath = path.resolve(rootDir, ".env.robots", "so100-left-1.env");
  const files = new Map([
    [
      sharedPath,
      [
        "URDF_ROBOT_GATEWAY_RUNTIME_MODE=control",
        "URDF_ROBOT_GATEWAY_ADAPTER=openarm_native",
        "URDF_ROBOT_GATEWAY_ENV=so100-left-1",
        "URDF_ROBOT_GATEWAY_LEROBOT_PORT=/dev/ttyACM0",
      ].join("\n"),
    ],
    [
      robotPath,
      [
        "URDF_ROBOT_GATEWAY_ADAPTER=lerobot",
        "URDF_ROBOT_GATEWAY_ROBOT_ID=so100-left-1",
        "URDF_ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE=so100_follower",
        "URDF_ROBOT_GATEWAY_LEROBOT_PORT=/dev/ttyACM7",
      ].join("\n"),
    ],
  ]);
  const env = { URDF_ROBOT_GATEWAY_LEROBOT_PORT: "/dev/from-shell" };

  const loaded = loadPrivateEnvFiles({
    rootDir,
    env,
    filenames: [".env.robot.local"],
    fileExists: (filename) => files.has(filename),
    readFile: (filename) => files.get(filename),
  });

  assert.deepEqual(loaded, [sharedPath, robotPath]);
  assert.equal(env.URDF_ROBOT_GATEWAY_RUNTIME_MODE, "control");
  assert.equal(env.URDF_ROBOT_GATEWAY_ADAPTER, "lerobot");
  assert.equal(env.URDF_ROBOT_GATEWAY_ROBOT_ID, "so100-left-1");
  assert.equal(env.URDF_ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE, "so100_follower");
  assert.equal(env.URDF_ROBOT_GATEWAY_LEROBOT_PORT, "/dev/from-shell");
});

test("loadPrivateEnvFiles gives explicit robot env files priority over selected defaults", () => {
  const rootDir = "/workspace/urdf-studio";
  const sharedPath = path.resolve(rootDir, ".env.robot.local");
  const explicitPath = path.resolve(rootDir, ".env.robots", "so100-left-2.env");
  const selectedPath = path.resolve(rootDir, ".env.robots", "openarm-a.env");
  const files = new Map([
    [
      sharedPath,
      [
        "URDF_ROBOT_GATEWAY_ENV=openarm-a",
        "URDF_ROBOT_GATEWAY_ENV_FILE=.env.robots/so100-left-2.env",
      ].join("\n"),
    ],
    [
      explicitPath,
      [
        "URDF_ROBOT_GATEWAY_ADAPTER=lerobot",
        "URDF_ROBOT_GATEWAY_ROBOT_ID=so100-left-2",
      ].join("\n"),
    ],
    [
      selectedPath,
      [
        "URDF_ROBOT_GATEWAY_ADAPTER=openarm_native",
        "URDF_ROBOT_GATEWAY_ROBOT_ID=openarm-a",
      ].join("\n"),
    ],
  ]);
  const env = {};

  const loaded = loadPrivateEnvFiles({
    rootDir,
    env,
    filenames: [".env.robot.local"],
    fileExists: (filename) => files.has(filename),
    readFile: (filename) => files.get(filename),
  });

  assert.deepEqual(loaded, [sharedPath, explicitPath]);
  assert.equal(env.URDF_ROBOT_GATEWAY_ADAPTER, "lerobot");
  assert.equal(env.URDF_ROBOT_GATEWAY_ROBOT_ID, "so100-left-2");
});

test("clearLoadedRobotEnvOverlayValues removes stale overlay values only", () => {
  const rootDir = "/workspace/urdf-studio";
  const sharedPath = path.resolve(rootDir, ".env.robot.local");
  const robotPath = path.resolve(rootDir, ".env.robots", "openarm-a.env");
  const files = new Map([
    [
      sharedPath,
      [
        "URDF_ROBOT_GATEWAY_RUNTIME_MODE=control",
        "URDF_ROBOT_GATEWAY_ENV=openarm-a",
        "URDF_SIMULATOR_API_TOKEN=shared-token",
      ].join("\n"),
    ],
    [
      robotPath,
      [
        "URDF_ROBOT_GATEWAY_ADAPTER=openarm_native",
        "URDF_ROBOT_GATEWAY_ROBOT_ID=openarm-a",
        "URDF_ROBOT_GATEWAY_LEROBOT_PORT=/dev/from-overlay",
      ].join("\n"),
    ],
  ]);
  const env = { URDF_ROBOT_GATEWAY_LEROBOT_PORT: "/dev/from-shell" };

  loadPrivateEnvFiles({
    rootDir,
    env,
    filenames: [".env.robot.local"],
    fileExists: (filename) => files.has(filename),
    readFile: (filename) => files.get(filename),
  });

  const launcherEnv = clearLoadedRobotEnvOverlayValues({ ...env }, { sourceEnv: env });

  assert.equal(launcherEnv.URDF_ROBOT_GATEWAY_RUNTIME_MODE, "control");
  assert.equal(launcherEnv.URDF_ROBOT_GATEWAY_ENV, "openarm-a");
  assert.equal(launcherEnv.URDF_SIMULATOR_API_TOKEN, "shared-token");
  assert.equal(launcherEnv.URDF_ROBOT_GATEWAY_LEROBOT_PORT, "/dev/from-shell");
  assert.equal(launcherEnv.URDF_ROBOT_GATEWAY_ADAPTER, undefined);
  assert.equal(launcherEnv.URDF_ROBOT_GATEWAY_ROBOT_ID, undefined);
});
