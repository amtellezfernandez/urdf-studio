#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ILU_ENTRYPOINTS = Object.freeze({
  "i-love-urdf": "dist/index.js",
  "i-love-urdf/load-source-node": "dist/sources/loadSourceNode.js",
  "i-love-urdf/local": "dist/repository/localRepositoryInspection.js",
  "i-love-urdf/urdf-node": "dist/node/urdfNode.js",
  "i-love-urdf/xacro-node": "dist/xacro/xacroNode.js",
});

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const DEFAULT_ILU_ROOT = path.resolve(STUDIO_ROOT, "../i-love-urdf");
const runtimeRequire = createRequire(import.meta.url);

export const resolveIluModulePath = (
  specifier,
  {
    iluRoot = DEFAULT_ILU_ROOT,
    existsSyncImpl = fs.existsSync,
  } = {}
) => {
  const relativeEntryPath = ILU_ENTRYPOINTS[specifier];
  if (!relativeEntryPath) {
    return null;
  }

  const candidatePath = path.join(iluRoot, relativeEntryPath);
  return existsSyncImpl(candidatePath) ? candidatePath : null;
};

export const getIluModuleSource = (specifier, options = {}) =>
  resolveIluModulePath(specifier, options) ? "sibling-dist" : "installed-package";

export const requireIluModule = (
  specifier,
  {
    requireImpl = runtimeRequire,
    ...options
  } = {}
) => {
  const localPath = resolveIluModulePath(specifier, options);
  return requireImpl(localPath || specifier);
};
