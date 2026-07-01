import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPythonInstallArgs,
  resolvePythonEnvDir,
  resolvePythonExecutable,
} from "./setup.js";

test("setup resolves the default clean Python environment", () => {
  assert.equal(resolvePythonEnvDir({}), ".venv");
  assert.equal(
    resolvePythonExecutable({ envDir: ".venv", platform: "linux" }),
    ".venv/bin/python3",
  );
});

test("setup exposes backend dependency install args", () => {
  const args = buildPythonInstallArgs();
  assert.deepEqual(args.slice(0, 2), ["pip", "install"]);
  assert.ok(args.includes("fastapi"));
  assert.ok(args.includes("pytest"));
});
