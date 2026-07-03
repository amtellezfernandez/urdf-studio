#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCliMain } from "./cliHelpers.js";
import { PERF_GATE_BUILD_CHUNK_SIZE_CHECK } from "./perf-gate-params.js";

const rootDir = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

const toPosixPath = (value) => value.replace(/\\/g, "/");

const formatBytes = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

const walkFiles = (directory, files = []) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
      continue;
    }
    files.push(fullPath);
  }
  return files;
};

const collectBuildJsChunks = (distDir) => {
  if (!fs.existsSync(distDir)) {
    throw new Error(`Missing build output directory ${toPosixPath(distDir)}. Run npm run build first.`);
  }
  return walkFiles(distDir)
    .filter((filePath) => filePath.endsWith(".js"))
    .map((filePath) => {
      const stat = fs.statSync(filePath);
      return {
        fileName: path.basename(filePath),
        relativePath: toPosixPath(path.relative(distDir, filePath)),
        bytes: stat.size,
      };
    })
    .sort((left, right) => right.bytes - left.bytes || left.relativePath.localeCompare(right.relativePath));
};

const sumBytes = (chunks) =>
  chunks.reduce((total, chunk) => total + chunk.bytes, 0);

const evaluateBuildChunkSizeGate = ({
  chunks,
  chunkLimits,
  totalJsMaxBytes,
}) => {
  const failures = [];
  const totalJsBytes = sumBytes(chunks);

  if (totalJsBytes > totalJsMaxBytes) {
    failures.push(
      `total JS ${formatBytes(totalJsBytes)} exceeds ${formatBytes(totalJsMaxBytes)}`
    );
  }

  for (const limit of chunkLimits) {
    const matches = chunks.filter((chunk) => chunk.fileName.startsWith(limit.prefix));
    if (matches.length === 0) {
      if (limit.required) {
        failures.push(`required chunk ${limit.name} (${limit.prefix}*.js) is missing`);
      }
      continue;
    }
    for (const chunk of matches) {
      if (chunk.bytes <= limit.maxBytes) continue;
      failures.push(
        `${chunk.relativePath} ${formatBytes(chunk.bytes)} exceeds ${limit.name} cap ${formatBytes(limit.maxBytes)}`
      );
    }
  }

  return {
    failures,
    totalJsBytes,
  };
};

const checkBuildChunkSizes = ({
  distDir = path.resolve(rootDir, PERF_GATE_BUILD_CHUNK_SIZE_CHECK.distDir),
  chunkLimits = PERF_GATE_BUILD_CHUNK_SIZE_CHECK.chunkLimits,
  totalJsMaxBytes = PERF_GATE_BUILD_CHUNK_SIZE_CHECK.totalJsMaxBytes,
} = {}) => {
  const chunks = collectBuildJsChunks(distDir);
  const result = evaluateBuildChunkSizeGate({
    chunks,
    chunkLimits,
    totalJsMaxBytes,
  });

  if (result.failures.length > 0) {
    throw new Error(
      [
        "Build chunk size gate failed:",
        ...result.failures.map((failure) => `  - ${failure}`),
      ].join("\n")
    );
  }

  return {
    ...result,
    chunks,
  };
};

const main = () => {
  const result = checkBuildChunkSizes();
  console.log(
    `[build-chunk-size] OK ${result.chunks.length} JS chunks, ${formatBytes(result.totalJsBytes)} total`
  );
};

runCliMain(import.meta.url, main);

export {
  checkBuildChunkSizes,
  collectBuildJsChunks,
  evaluateBuildChunkSizeGate,
  formatBytes,
};
