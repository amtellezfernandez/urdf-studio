#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  BACKEND_PYTHON_CORE_DEPENDENCIES,
  PYTHON_ENV_DIRNAME,
  SETUP_NPM_INSTALL_FLAGS,
} from "./setupParams.js";
import { buildSetupSummarySections } from "./setupHelpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..", "..");

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  pink: "\x1b[35m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status === 0 && !result.error) {
    return;
  }
  throw result.error || new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    cwd: rootDir,
    stdio: "ignore",
    shell: false,
  });
  return result.status === 0 && !result.error;
}

function getNpmCommand() {
  const npmExecPath = typeof process.env.npm_execpath === "string" ? process.env.npm_execpath.trim() : "";
  if (npmExecPath) {
    return {
      command: process.execPath,
      argsPrefix: [npmExecPath],
    };
  }
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    argsPrefix: [],
  };
}

export function resolvePythonEnvDir(env = process.env) {
  return env.URDF_STUDIO_PYTHON_ENV || PYTHON_ENV_DIRNAME;
}

export function resolvePythonExecutable({
  envDir = resolvePythonEnvDir(),
  platform = process.platform,
} = {}) {
  return platform === "win32" ? join(envDir, "Scripts", "python.exe") : join(envDir, "bin", "python3");
}

export function buildPythonInstallArgs() {
  return ["pip", "install", ...BACKEND_PYTHON_CORE_DEPENDENCIES];
}

function installNodeDependencies() {
  const viteBin = join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
  if (existsSync(viteBin)) {
    log("Node dependencies already installed.", colors.gray);
    return;
  }
  const { command, argsPrefix } = getNpmCommand();
  run(command, [...argsPrefix, "install", ...SETUP_NPM_INSTALL_FLAGS]);
}

function installPythonRuntime() {
  const envDir = resolvePythonEnvDir();
  const pythonExecutable = resolvePythonExecutable({ envDir });
  if (!existsSync(pythonExecutable)) {
    if (commandExists("uv")) {
      run("uv", ["venv", envDir, "--python", "3.12"]);
    } else {
      run("python3", ["-m", "venv", envDir]);
    }
  }
  if (commandExists("uv")) {
    run("uv", ["pip", "install", "--python", pythonExecutable, ...BACKEND_PYTHON_CORE_DEPENDENCIES]);
  } else {
    run(pythonExecutable, ["-m", ...buildPythonInstallArgs()]);
  }
}

function printSummary() {
  for (const section of buildSetupSummarySections({ pythonEnvDir: resolvePythonEnvDir() })) {
    log(section.heading, colors.pink);
    for (const line of section.lines) {
      log(`  ${line}`, colors.gray);
    }
  }
}

export async function main() {
  log("Setting up URDF Studio...", colors.pink);
  installNodeDependencies();
  installPythonRuntime();
  log("Setup complete.", colors.green);
  printSummary();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    log(error instanceof Error ? error.message : String(error), colors.yellow);
    process.exit(1);
  });
}
