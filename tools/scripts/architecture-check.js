#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARCHITECTURE_EXIT_CODES,
  ARCHITECTURE_LOC_POLICY,
  ARCHITECTURE_REQUIRED_FILES,
  ARCHITECTURE_RUNTIME_MESH_LOADER_EXPORT_CONTRACT,
  ARCHITECTURE_TEXT_CONTRACTS,
} from "./architectureCheckParams.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

const readFile = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const ensure = (condition, message, errors) => {
  if (!condition) errors.push(message);
};

const ensureFileExists = (relativePath, errors) => {
  const absolutePath = path.join(root, relativePath);
  ensure(fs.existsSync(absolutePath), `${relativePath} is missing.`, errors);
};

const locAllowlist = new Map(ARCHITECTURE_LOC_POLICY.allowlist);

const walk = (dir, files = []) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
};

const toRel = (absolutePath) => path.relative(root, absolutePath).replace(/\\/g, "/");

const isStrictLocPath = (relativePath) =>
  ARCHITECTURE_LOC_POLICY.strictPrefixes.some((prefix) =>
    relativePath.startsWith(prefix)
  );

const getLocThreshold = (relativePath) => {
  const strictCap = isStrictLocPath(relativePath)
    ? ARCHITECTURE_LOC_POLICY.strictCap
    : ARCHITECTURE_LOC_POLICY.globalCap;
  const allowlisted = locAllowlist.get(relativePath);
  if (typeof allowlisted === "number") {
    return allowlisted;
  }
  return strictCap;
};

const runFileSizeChecks = (errors) => {
  const srcRoot = path.join(root, "web", "src");
  const files = walk(srcRoot)
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .filter((file) => !file.endsWith(".d.ts"));

  const offenders = [];
  for (const file of files) {
    const relativePath = toRel(file);
    const lineCount = fs.readFileSync(file, "utf8").split("\n").length;
    const threshold = getLocThreshold(relativePath);
    if (lineCount > threshold) {
      offenders.push({ relativePath, lineCount, threshold });
    }
  }

  offenders.sort((a, b) => b.lineCount - a.lineCount);
  offenders.forEach((offender) => {
    errors.push(
      `${offender.relativePath} is too large (${offender.lineCount} LOC > ${offender.threshold} LOC cap).`
    );
  });
};

const runTextContractChecks = (errors) => {
  ARCHITECTURE_TEXT_CONTRACTS.forEach((contract) => {
    const code = readFile(contract.relativePath);
    contract.requiredSubstrings?.forEach((required) => {
      ensure(
        code.includes(required.value),
        `${contract.relativePath} ${required.message}`,
        errors
      );
    });
    contract.forbiddenPatterns?.forEach((forbidden) => {
      ensure(
        !forbidden.pattern.test(code),
        `${contract.relativePath} ${forbidden.message}`,
        errors
      );
    });
  });
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasNamedRuntimeMeshLoaderExport = (code, name) => {
  const { reexportSource } = ARCHITECTURE_RUNTIME_MESH_LOADER_EXPORT_CONTRACT;
  const escapedReexportSource = escapeRegExp(reexportSource);
  return (
    new RegExp(`export\\s+const\\s+${name}\\s*=`).test(code) ||
    new RegExp(
      `export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']${escapedReexportSource}["']`
    ).test(code)
  );
};

const runRuntimeMeshLoaderExportChecks = (errors) => {
  const { relativePath, exportNames } =
    ARCHITECTURE_RUNTIME_MESH_LOADER_EXPORT_CONTRACT;
  const code = readFile(relativePath);
  exportNames.forEach((name) => {
    ensure(
      hasNamedRuntimeMeshLoaderExport(code, name),
      `${relativePath} must export ${name}.`,
      errors
    );
  });
};

const run = () => {
  const errors = [];

  ARCHITECTURE_REQUIRED_FILES.forEach((relativePath) =>
    ensureFileExists(relativePath, errors)
  );
  runTextContractChecks(errors);
  runRuntimeMeshLoaderExportChecks(errors);
  runFileSizeChecks(errors);

  if (errors.length > 0) {
    console.error("Architecture check failed:");
    errors.forEach((error) => console.error(`  - ${error}`));
    process.exit(ARCHITECTURE_EXIT_CODES.failure);
  }

  console.log("Architecture check passed.");
};

run();
