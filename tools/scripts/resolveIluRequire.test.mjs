import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getIluModuleSource, resolveIluModulePath } from "./resolveIluRequire.js";

const TEST_TEMP_PREFIX = "urdf-studio-ilu-resolve-";

test("resolveIluModulePath returns sibling dist entry when present", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEST_TEMP_PREFIX));
  const entryPath = path.join(tempRoot, "dist", "index.js");
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.writeFileSync(entryPath, "module.exports = {};\n", "utf8");

  try {
    assert.equal(resolveIluModulePath("i-love-urdf", { iluRoot: tempRoot }), entryPath);
    assert.equal(getIluModuleSource("i-love-urdf", { iluRoot: tempRoot }), "sibling-dist");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("resolveIluModulePath falls back when sibling dist is missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEST_TEMP_PREFIX));

  try {
    assert.equal(resolveIluModulePath("i-love-urdf", { iluRoot: tempRoot }), null);
    assert.equal(getIluModuleSource("i-love-urdf", { iluRoot: tempRoot }), "installed-package");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
