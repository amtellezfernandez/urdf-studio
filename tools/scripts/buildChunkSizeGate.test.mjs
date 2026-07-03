import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkBuildChunkSizes,
  collectBuildJsChunks,
  evaluateBuildChunkSizeGate,
  formatBytes,
} from "./buildChunkSizeGate.js";

test("formatBytes reports KiB with one decimal", () => {
  assert.equal(formatBytes(1536), "1.5 KiB");
});

test("evaluateBuildChunkSizeGate accepts chunks under configured limits", () => {
  const result = evaluateBuildChunkSizeGate({
    chunks: [
      { fileName: "App-abc.js", relativePath: "assets/App-abc.js", bytes: 100 },
      { fileName: "Viewer3D-def.js", relativePath: "assets/Viewer3D-def.js", bytes: 80 },
    ],
    chunkLimits: [
      { name: "App", prefix: "App-", maxBytes: 120, required: true },
      { name: "Viewer3D", prefix: "Viewer3D-", maxBytes: 90, required: true },
    ],
    totalJsMaxBytes: 250,
  });

  assert.deepEqual(result, {
    failures: [],
    totalJsBytes: 180,
  });
});

test("evaluateBuildChunkSizeGate reports required missing chunks", () => {
  const result = evaluateBuildChunkSizeGate({
    chunks: [
      { fileName: "App-abc.js", relativePath: "assets/App-abc.js", bytes: 100 },
    ],
    chunkLimits: [
      { name: "App", prefix: "App-", maxBytes: 120, required: true },
      { name: "Viewer3D", prefix: "Viewer3D-", maxBytes: 90, required: true },
    ],
    totalJsMaxBytes: 250,
  });

  assert.deepEqual(result.failures, [
    "required chunk Viewer3D (Viewer3D-*.js) is missing",
  ]);
});

test("evaluateBuildChunkSizeGate reports oversized chunks and total output", () => {
  const result = evaluateBuildChunkSizeGate({
    chunks: [
      { fileName: "App-abc.js", relativePath: "assets/App-abc.js", bytes: 150 },
      { fileName: "Viewer3D-def.js", relativePath: "assets/Viewer3D-def.js", bytes: 120 },
    ],
    chunkLimits: [
      { name: "App", prefix: "App-", maxBytes: 120, required: true },
      { name: "Viewer3D", prefix: "Viewer3D-", maxBytes: 90, required: true },
    ],
    totalJsMaxBytes: 200,
  });

  assert.deepEqual(result.failures, [
    "total JS 0.3 KiB exceeds 0.2 KiB",
    "assets/App-abc.js 0.1 KiB exceeds App cap 0.1 KiB",
    "assets/Viewer3D-def.js 0.1 KiB exceeds Viewer3D cap 0.1 KiB",
  ]);
});

test("collectBuildJsChunks reads nested build assets and ignores non-JS files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "urdf-build-chunks-"));
  try {
    const assetsDir = path.join(tempDir, "assets");
    fs.mkdirSync(assetsDir);
    fs.writeFileSync(path.join(assetsDir, "App-abc.js"), "a".repeat(12));
    fs.writeFileSync(path.join(assetsDir, "style.css"), "body{}");
    fs.writeFileSync(path.join(tempDir, "index.js"), "b".repeat(4));

    assert.deepEqual(collectBuildJsChunks(tempDir), [
      { fileName: "App-abc.js", relativePath: "assets/App-abc.js", bytes: 12 },
      { fileName: "index.js", relativePath: "index.js", bytes: 4 },
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("checkBuildChunkSizes throws a release-oriented failure message", () => {
  assert.throws(
    () =>
      checkBuildChunkSizes({
        distDir: "/path/that/does/not/exist",
        chunkLimits: [],
        totalJsMaxBytes: 1,
      }),
    /Run npm run build first/
  );
});
