#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const source = process.env.OPENUSD_EMSCRIPTEN_SOURCE;
const emsdk = process.env.EMSDK;

if (!source || !existsSync(resolve(source))) {
  console.error(
    "OPENUSD_EMSCRIPTEN_SOURCE must point to the OpenUSD/HdEmscripten source checkout."
  );
  process.exit(1);
}
if (!emsdk || !existsSync(resolve(emsdk))) {
  console.error("EMSDK must point to an initialized Emscripten SDK checkout.");
  process.exit(1);
}

console.error(
  [
    "The source checkout and Emscripten SDK are present.",
    "This repository does not contain the custom HdEmscripten CMake target used by emHdBindings.",
    `Use the matching target from ${source}, enable uniform displayColor in Emscripten_Rprim,`,
    `and write the four generated artifacts to ${resolve(repoRoot, "web/public/usd-viewer/bindings")}.`,
    "The browser verification must show no unsupported uniform displayColor warning.",
  ].join("\n")
);
process.exit(2);
