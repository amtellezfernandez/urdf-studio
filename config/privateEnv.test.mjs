import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { loadPrivateEnvFiles, parsePrivateEnv } from "./privateEnv.js";

test("parsePrivateEnv handles comments, exports, and quoted values", () => {
  assert.deepEqual(
    parsePrivateEnv(`
      # private workstation config
      export URDF_STUDIO_HOST=127.0.0.1
      URDF_STUDIO_LABEL=release # operator note
      URDF_SIMULATOR_API_TOKEN='token#literal'
      URDF_STUDIO_MULTILINE="line\\nnext"
    `),
    {
      URDF_STUDIO_HOST: "127.0.0.1",
      URDF_STUDIO_LABEL: "release",
      URDF_SIMULATOR_API_TOKEN: "token#literal",
      URDF_STUDIO_MULTILINE: "line\nnext",
    },
  );
});

test("loadPrivateEnvFiles loads configured local files without overriding shell env", () => {
  const rootDir = "/workspace/urdf-studio";
  const firstPath = path.resolve(rootDir, ".env");
  const secondPath = path.resolve(rootDir, ".env.local");
  const files = new Map([
    [
      firstPath,
      [
        "URDF_STUDIO_HOST=0.0.0.0",
        "URDF_STUDIO_PORT=5173",
        "URDF_SIMULATOR_API_TOKEN=from-env",
      ].join("\n"),
    ],
    [
      secondPath,
      [
        "URDF_STUDIO_PORT=3000",
        "URDF_STUDIO_CACHE=.cache/local",
      ].join("\n"),
    ],
  ]);
  const env = { URDF_SIMULATOR_API_TOKEN: "from-shell" };

  const loaded = loadPrivateEnvFiles({
    rootDir,
    env,
    fileExists: (filename) => files.has(filename),
    readFile: (filename) => files.get(filename),
  });

  assert.deepEqual(loaded, [firstPath, secondPath]);
  assert.equal(env.URDF_STUDIO_HOST, "0.0.0.0");
  assert.equal(env.URDF_STUDIO_PORT, "3000");
  assert.equal(env.URDF_STUDIO_CACHE, ".cache/local");
  assert.equal(env.URDF_SIMULATOR_API_TOKEN, "from-shell");
});

test("loadPrivateEnvFiles supports explicit file lists and skips missing files", () => {
  const rootDir = "/workspace/urdf-studio";
  const existingPath = path.resolve(rootDir, ".env.release");
  const files = new Map([
    [existingPath, "URDF_STUDIO_MODE=release\n"],
  ]);
  const env = {};

  const loaded = loadPrivateEnvFiles({
    rootDir,
    env,
    filenames: [".env.missing", ".env.release"],
    fileExists: (filename) => files.has(filename),
    readFile: (filename) => files.get(filename),
  });

  assert.deepEqual(loaded, [existingPath]);
  assert.equal(env.URDF_STUDIO_MODE, "release");
});
