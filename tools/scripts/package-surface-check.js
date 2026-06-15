#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PACKAGE_SURFACE_CHECK } from "./packageSurfaceParams.js";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const npmignoreFile = resolve(rootDir, PACKAGE_SURFACE_CHECK.npmignorePath);

const runPackageDryRun = () => {
  const result = spawnSync(
    PACKAGE_SURFACE_CHECK.npmCommand,
    PACKAGE_SURFACE_CHECK.npmPackDryRunArgs,
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (result.status !== 0) {
    throw new Error(
      [
        "npm pack --dry-run failed.",
        result.stdout.trim(),
        result.stderr.trim(),
      ].filter(Boolean).join("\n")
    );
  }

  return {
    packages: JSON.parse(result.stdout),
  };
};

const collectViolations = (pack) => {
  const packageFiles = pack.files.map((file) => file.path);
  return packageFiles.filter((filePath) => {
    if (PACKAGE_SURFACE_CHECK.blockedPathPrefixes.some((prefix) => filePath.startsWith(prefix))) {
      return true;
    }
    return PACKAGE_SURFACE_CHECK.blockedPathPatterns.some((pattern) => pattern.test(filePath));
  });
};

const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

const main = () => {
  const { packages } = runPackageDryRun();
  const pack = packages[0];
  if (!pack) {
    throw new Error("npm pack --dry-run did not return package metadata.");
  }

  const failures = [];
  if (!existsSync(npmignoreFile)) {
    failures.push("missing .npmignore; package contents must not depend on .gitignore fallback.");
  }
  if (pack.entryCount > PACKAGE_SURFACE_CHECK.maxEntryCount) {
    failures.push(
      `package entry count ${pack.entryCount} exceeds ${PACKAGE_SURFACE_CHECK.maxEntryCount}.`
    );
  }
  if (pack.size > PACKAGE_SURFACE_CHECK.maxPackedBytes) {
    failures.push(
      `package size ${formatBytes(pack.size)} exceeds ${formatBytes(PACKAGE_SURFACE_CHECK.maxPackedBytes)}.`
    );
  }
  if (pack.unpackedSize > PACKAGE_SURFACE_CHECK.maxUnpackedBytes) {
    failures.push(
      `package unpacked size ${formatBytes(pack.unpackedSize)} exceeds ${formatBytes(PACKAGE_SURFACE_CHECK.maxUnpackedBytes)}.`
    );
  }

  const blockedFiles = collectViolations(pack);
  if (blockedFiles.length > 0) {
    failures.push(`blocked package paths:\n${blockedFiles.map((file) => `  - ${file}`).join("\n")}`);
  }

  if (failures.length > 0) {
    console.error("[package-surface] failed");
    failures.forEach((failure) => console.error(failure));
    process.exit(1);
  }

  console.log(
    `[package-surface] OK ${pack.entryCount} files, ${formatBytes(pack.size)} packed, ${formatBytes(pack.unpackedSize)} unpacked`
  );
};

main();
