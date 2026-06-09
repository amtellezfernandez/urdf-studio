import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  requireIluModule,
  resolveIluModulePath,
} from "./resolveIluRequire.js";

const TEST_TEMP_PREFIX = "urdf-studio-ilu-resolve-";

test("resolveIluModulePath returns sibling dist entry when present", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEST_TEMP_PREFIX));
  const entryPath = path.join(tempRoot, "dist", "index.js");
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.writeFileSync(entryPath, "module.exports = {};\n", "utf8");

  try {
    assert.equal(resolveIluModulePath("i-love-urdf", { iluRoot: tempRoot }), entryPath);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("resolveIluModulePath falls back when sibling dist is missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEST_TEMP_PREFIX));

  try {
    assert.equal(resolveIluModulePath("i-love-urdf", { iluRoot: tempRoot }), null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("requireIluModule loads public installed exports before compatibility fallbacks", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEST_TEMP_PREFIX));
  const emptySiblingRoot = path.join(tempRoot, "missing-sibling");

  const fakeRequire = (target) => ({ target });
  fakeRequire.resolve = () => {
    throw new Error("compatibility fallback should not be reached");
  };

  try {
    const loaded = requireIluModule("i-love-urdf/node-dom-runtime", {
      iluRoot: emptySiblingRoot,
      requireImpl: fakeRequire,
    });
    assert.equal(loaded.target, "i-love-urdf/node-dom-runtime");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("requireIluModule uses the compatibility fallback for older installed packages", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEST_TEMP_PREFIX));
  const emptySiblingRoot = path.join(tempRoot, "missing-sibling");
  const packageRoot = path.join(tempRoot, "node_modules", "i-love-urdf");
  const packageJsonPath = path.join(packageRoot, "package.json");
  const nodeDomRuntimePath = path.join(packageRoot, "dist", "node", "nodeDomRuntime.js");
  fs.mkdirSync(path.dirname(nodeDomRuntimePath), { recursive: true });
  fs.writeFileSync(packageJsonPath, "{\"name\":\"i-love-urdf\"}\n", "utf8");
  fs.writeFileSync(
    nodeDomRuntimePath,
    "module.exports = { installNodeDomGlobals() {} };\n",
    "utf8"
  );

  const fakeRequire = (target) => {
    if (target === "i-love-urdf/node-dom-runtime") {
      throw Object.assign(new Error("Package subpath is not exported"), {
        code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
      });
    }
    return { target };
  };
  fakeRequire.resolve = (specifier) => {
    if (specifier === "i-love-urdf/package.json") {
      return packageJsonPath;
    }
    throw new Error(`Unexpected resolve: ${specifier}`);
  };

  try {
    const loaded = requireIluModule("i-love-urdf/node-dom-runtime", {
      iluRoot: emptySiblingRoot,
      requireImpl: fakeRequire,
    });
    assert.equal(loaded.target, nodeDomRuntimePath);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("requireIluModule does not mask public export runtime failures", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEST_TEMP_PREFIX));
  const emptySiblingRoot = path.join(tempRoot, "missing-sibling");
  const packageRoot = path.join(tempRoot, "node_modules", "i-love-urdf");
  const packageJsonPath = path.join(packageRoot, "package.json");
  const nodeDomRuntimePath = path.join(packageRoot, "dist", "node", "nodeDomRuntime.js");
  fs.mkdirSync(path.dirname(nodeDomRuntimePath), { recursive: true });
  fs.writeFileSync(packageJsonPath, "{\"name\":\"i-love-urdf\"}\n", "utf8");
  fs.writeFileSync(nodeDomRuntimePath, "module.exports = {};\n", "utf8");

  const publicExportError = Object.assign(new Error("broken public export"), {
    code: "MODULE_NOT_FOUND",
  });
  const fakeRequire = (target) => {
    if (target === "i-love-urdf/node-dom-runtime") {
      throw publicExportError;
    }
    return { target };
  };
  fakeRequire.resolve = (specifier) => {
    if (specifier === "i-love-urdf/package.json") {
      return packageJsonPath;
    }
    throw new Error(`Unexpected resolve: ${specifier}`);
  };

  try {
    assert.throws(
      () =>
        requireIluModule("i-love-urdf/node-dom-runtime", {
          iluRoot: emptySiblingRoot,
          requireImpl: fakeRequire,
        }),
      publicExportError
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
