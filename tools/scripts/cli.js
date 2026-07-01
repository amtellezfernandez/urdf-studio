#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..", "..");

const command = process.argv[2] || "start";
const commandArgs = process.argv.slice(3);

function spawnNodeScript(scriptName, args = []) {
  return spawn(process.execPath, [join(__dirname, scriptName), ...args], {
    stdio: "inherit",
    shell: false,
    cwd: rootDir,
  });
}

function run(scriptName, args = []) {
  const child = spawnNodeScript(scriptName, args);
  child.on("exit", (code) => {
    process.exit(code || 0);
  });
}

if (command === "setup") {
  run("setup.js", commandArgs);
} else if (command === "start") {
  run("start.js", commandArgs);
} else if (command === "simulator:status") {
  run("simulatorRuntime.js", ["status", ...commandArgs]);
} else if (command === "simulator:install") {
  run("simulatorRuntime.js", ["install", ...commandArgs]);
} else if (command === "--help" || command === "-h") {
  console.log("URDF Studio");
  console.log("");
  console.log("Usage: urdf-studio [setup|start|simulator:status|simulator:install]");
  process.exit(0);
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Run "urdf-studio --help" for usage information.');
  process.exit(1);
}
