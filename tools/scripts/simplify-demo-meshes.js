#!/usr/bin/env node

import { readdirSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Mesh } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { SimplifyModifier } from "three/examples/jsm/modifiers/SimplifyModifier.js";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const rootDir = resolve(__dirname, "..", "..");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith("--")) {
    const key = arg.replace(/^--/, "");
    const value = process.argv[i + 1];
    if (!value || value.startsWith("--")) {
      args.set(key, true);
    } else {
      args.set(key, value);
      i += 1;
    }
  }
}

const ratio = Math.min(Math.max(Number(args.get("ratio") ?? 0.3), 0.05), 0.95);
const minVertices = Math.max(Number(args.get("min") ?? 200), 50);
const assetsDir = resolve(rootDir, args.get("dir") ?? "web/public/demo/assets");

const loader = new STLLoader();
const exporter = new STLExporter();
const modifier = new SimplifyModifier();

const filterArg = args.get("files");
const requested = typeof filterArg === "string" ? filterArg.split(",").map((v) => v.trim()).filter(Boolean) : [];
const files = readdirSync(assetsDir)
  .filter((file) => extname(file).toLowerCase() === ".stl")
  .filter((file) => (requested.length ? requested.includes(file) : true));

if (files.length === 0) {
  console.error(`[simplify-demo-meshes] No STL files found in ${assetsDir}`);
  process.exit(1);
}

console.log(`[simplify-demo-meshes] Using ratio=${ratio}, minVertices=${minVertices}`);

for (const file of files) {
  const fullPath = resolve(assetsDir, file);
  const beforeSize = statSync(fullPath).size;
  const buffer = readFileSync(fullPath);

  const geometry = loader.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const position = geometry.getAttribute("position");

  if (!position || position.count < 3) {
    console.log(`[skip] ${file} has no vertices`);
    continue;
  }

  const merged = BufferGeometryUtils.mergeVertices(geometry.clone());
  const mergedCount = merged.getAttribute("position")?.count ?? position.count;
  const targetCount = Math.max(Math.floor(mergedCount * ratio), minVertices);
  const removeCount = Math.max(mergedCount - targetCount, 0);

  let simplified = geometry;
  if (removeCount > 0) {
    simplified = modifier.modify(geometry, removeCount);
  }

  simplified.computeVertexNormals();

  const mesh = new Mesh(simplified);
  mesh.updateMatrixWorld(true);
  const dataView = exporter.parse(mesh, { binary: true });
  const outBuffer = Buffer.from(dataView.buffer);

  const tmpPath = `${fullPath}.tmp`;
  writeFileSync(tmpPath, outBuffer);
  renameSync(tmpPath, fullPath);

  const afterSize = statSync(fullPath).size;
  const pct = ((1 - afterSize / beforeSize) * 100).toFixed(1);
  console.log(`${file}: ${Math.round(beforeSize / 1024)}KB -> ${Math.round(afterSize / 1024)}KB (${pct}% smaller)`);
}
