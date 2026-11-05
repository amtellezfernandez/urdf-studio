#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const output = resolve(repoRoot, "web/public/usd-viewer/bindings");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (process.argv.includes("--bootstrap")) {
  const cache = resolve(repoRoot, ".cache/usd-wasm");
  const sourceDir = resolve(cache, "OpenUSD");
  const emsdkDir = resolve(cache, "emsdk");
  mkdirSync(cache, { recursive: true });
  if (!existsSync(resolve(sourceDir, "build_scripts/build_usd.py"))) {
    run("git", ["clone", "--branch", "needle/feature/wasm-improvements", "--depth", "1", "https://github.com/needle-tools/OpenUSD.git", sourceDir]);
  }
  if (!existsSync(resolve(emsdkDir, "emsdk"))) {
    run("git", ["clone", "--depth", "1", "https://github.com/emscripten-core/emsdk.git", emsdkDir]);
  }
  run("./emsdk", ["install", "3.1.55"], { cwd: emsdkDir });
  run("./emsdk", ["activate", "3.1.55"], { cwd: emsdkDir });
  const buildDir = resolve(cache, "build");
  run("bash", ["-lc", `source ./emsdk_env.sh >/dev/null && python3 ./build_scripts/build_usd.py --build-target wasm --build-variant release ${JSON.stringify(buildDir)}`], { cwd: sourceDir, env: { ...process.env, EMSDK: emsdkDir } });
  mkdirSync(output, { recursive: true });
  for (const file of ["emHdBindings.js", "emHdBindings.wasm", "emHdBindings.data", "emHdBindings.worker.js"]) {
    copyFileSync(resolve(buildDir, "bin", file), resolve(output, file));
  }
  console.log(`OpenUSD-WASM binding installed in ${output}`);
  process.exit(0);
}

const source = process.env.OPENUSD_EMSCRIPTEN_SOURCE;
const emsdk = process.env.EMSDK;

if (!source || !existsSync(resolve(source))) {
  console.error(
    "OPENUSD_EMSCRIPTEN_SOURCE must point to needle-tools/OpenUSD on needle/feature/wasm-improvements, or use --bootstrap."
  );
  process.exit(1);
}
if (!emsdk || !existsSync(resolve(emsdk))) {
  console.error("EMSDK must point to an initialized Emscripten SDK checkout, or use --bootstrap.");
  process.exit(1);
}

console.error(
  [
    "The source checkout and Emscripten SDK are present.",
    `Build the pinned wasm target from ${source} and write the four generated artifacts to ${output}.`,
    "The browser verification must show no unsupported uniform displayColor warning.",
  ].join("\n")
);
process.exit(2);
