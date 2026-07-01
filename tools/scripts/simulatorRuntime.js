#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PYTHON_ENV_DIRNAME,
  SIMULATOR_PYTHON_ENV_DIRNAME,
  SIMULATOR_OPTIONAL_RUNTIME_IDS,
  SIMULATOR_OPTIONAL_RUNTIMES,
} from "./setupParams.js";
import { resolvePythonEnvDir, resolvePythonExecutable } from "./setup.js";

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

function runCapture(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
    ...options,
  });
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    cwd: rootDir,
    stdio: "ignore",
    shell: false,
  });
  return result.status === 0 && !result.error;
}

function absolutePythonPath(pythonExecutable) {
  if (pythonExecutable.startsWith("/") || /^[A-Za-z]:[\\/]/.test(pythonExecutable)) {
    return pythonExecutable;
  }
  return join(rootDir, pythonExecutable);
}

export function normalizeSimulatorSelection(values) {
  const rawValues = values.length === 0 ? SIMULATOR_OPTIONAL_RUNTIME_IDS : values;
  const selected = [];
  for (const rawValue of rawValues) {
    const value = String(rawValue).trim().toLowerCase();
    const expandedValues = value === "all" ? SIMULATOR_OPTIONAL_RUNTIME_IDS : [value];
    for (const expandedValue of expandedValues) {
      if (!SIMULATOR_OPTIONAL_RUNTIME_IDS.includes(expandedValue)) {
        throw new Error(
          `Unknown simulator "${rawValue}". Expected one of: ${SIMULATOR_OPTIONAL_RUNTIME_IDS.join(", ")}, all.`,
        );
      }
      if (!selected.includes(expandedValue)) {
        selected.push(expandedValue);
      }
    }
  }
  return selected;
}

export function pythonPackagesForSimulatorIds(simulatorIds) {
  const packages = [];
  for (const simulatorId of simulatorIds) {
    const runtime = SIMULATOR_OPTIONAL_RUNTIMES[simulatorId];
    if (runtime.kind !== "python") {
      continue;
    }
    for (const packageName of runtime.packages) {
      if (!packages.includes(packageName)) {
        packages.push(packageName);
      }
    }
  }
  return packages;
}

function requiredPythonVersionsForSimulatorIds(simulatorIds) {
  return [
    ...new Set(
      simulatorIds
        .map((simulatorId) => SIMULATOR_OPTIONAL_RUNTIMES[simulatorId].pythonVersion)
        .filter(Boolean),
    ),
  ];
}

function defaultEnvDirForSimulatorIds(simulatorIds, env = process.env) {
  if (typeof env.URDF_STUDIO_PYTHON_ENV === "string" && env.URDF_STUDIO_PYTHON_ENV.trim()) {
    return env.URDF_STUDIO_PYTHON_ENV.trim();
  }
  const requiredVersions = requiredPythonVersionsForSimulatorIds(simulatorIds);
  if (requiredVersions.includes("3.11")) {
    return SIMULATOR_PYTHON_ENV_DIRNAME;
  }
  return PYTHON_ENV_DIRNAME;
}

export function resolveRuntimePython(env = process.env) {
  const explicitPython = typeof env.URDF_STUDIO_PYTHON === "string" ? env.URDF_STUDIO_PYTHON.trim() : "";
  if (explicitPython) {
    return explicitPython;
  }
  const envDir = resolvePythonEnvDir(env);
  const localPython = resolvePythonExecutable({ envDir });
  if (existsSync(absolutePythonPath(localPython))) {
    return localPython;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function pythonVersionForExecutable(pythonExecutable) {
  const result = runCapture(pythonExecutable, [
    "-c",
    "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
  ]);
  if (result.status !== 0 || result.error) {
    return "";
  }
  return result.stdout.trim();
}

function ensureInstallPython(simulatorIds, env = process.env) {
  const explicitPython = typeof env.URDF_STUDIO_PYTHON === "string" ? env.URDF_STUDIO_PYTHON.trim() : "";
  if (explicitPython) {
    return explicitPython;
  }
  const envDir = defaultEnvDirForSimulatorIds(simulatorIds, env);
  const pythonExecutable = resolvePythonExecutable({ envDir });
  if (!existsSync(absolutePythonPath(pythonExecutable))) {
    const requiredVersions = requiredPythonVersionsForSimulatorIds(simulatorIds);
    const pythonVersion = typeof env.URDF_STUDIO_PYTHON_VERSION === "string" && env.URDF_STUDIO_PYTHON_VERSION.trim()
      ? env.URDF_STUDIO_PYTHON_VERSION.trim()
      : requiredVersions[0] || "3.12";
    if (commandExists("uv")) {
      run("uv", ["venv", envDir, "--python", pythonVersion]);
    } else {
      run(process.platform === "win32" ? "python" : "python3", ["-m", "venv", envDir]);
    }
  }
  return pythonExecutable;
}

function probePythonModules(pythonExecutable, importNames) {
  if (importNames.length === 0) {
    return {};
  }
  const probe = [
    "import importlib.util, json",
    `names = ${JSON.stringify(importNames)}`,
    "print(json.dumps({name: importlib.util.find_spec(name) is not None for name in names}))",
  ].join("; ");
  const result = runCapture(pythonExecutable, ["-c", probe]);
  if (result.status !== 0 || result.error) {
    return Object.fromEntries(importNames.map((name) => [name, false]));
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return Object.fromEntries(importNames.map((name) => [name, false]));
  }
}

function probeBlender(pythonExecutable) {
  const probe = [
    "from backend.services.simulator_adapters.blender_runtime import resolve_blender_executable",
    "path = resolve_blender_executable()",
    "print(path or '')",
  ].join("; ");
  const result = runCapture(pythonExecutable, ["-c", probe]);
  if (result.status !== 0 || result.error) {
    return "";
  }
  return result.stdout.trim();
}

function probeCoppeliaSim(pythonExecutable) {
  const probe = [
    "from backend.services.simulator_adapters.coppeliasim_runtime import resolve_coppeliasim_executable, coppeliasim_remote_configured",
    "path = resolve_coppeliasim_executable()",
    "print(str(path) if path else ('remote' if coppeliasim_remote_configured() else ''))",
  ].join("; ");
  const result = runCapture(pythonExecutable, ["-c", probe]);
  if (result.status !== 0 || result.error) {
    return "";
  }
  return result.stdout.trim();
}

export function collectRuntimeStatus(simulatorIds, pythonExecutable = resolveRuntimePython()) {
  return simulatorIds.map((simulatorId) => {
    const runtime = SIMULATOR_OPTIONAL_RUNTIMES[simulatorId];
    if (runtime.kind === "external") {
      const executable = probeBlender(pythonExecutable);
      return {
        simulatorId,
        label: runtime.label,
        available: Boolean(executable),
        detail: executable || `set ${runtime.executableEnv} or install Blender in a standard location`,
      };
    }
    const moduleStatus = probePythonModules(pythonExecutable, runtime.importNames);
    const missingModules = runtime.importNames.filter((name) => !moduleStatus[name]);
    if (simulatorId === "coppeliasim" && missingModules.length === 0) {
      const executable = probeCoppeliaSim(pythonExecutable);
      return {
        simulatorId,
        label: runtime.label,
        available: Boolean(executable),
        detail: executable || "set URDF_STUDIO_COPPELIASIM_PATH, COPPELIASIM_ROOT, or URDF_STUDIO_COPPELIASIM_REMOTE=1",
      };
    }
    return {
      simulatorId,
      label: runtime.label,
      available: missingModules.length === 0,
      detail: missingModules.length === 0
        ? `python=${pythonExecutable}${runtime.eulaEnv ? `; ${runtime.eulaEnv} may be required for first run` : ""}`
        : `missing Python module(s): ${missingModules.join(", ")}`,
    };
  });
}

function pythonMatchesRuntime(pythonExecutable, simulatorId) {
  const requiredVersion = SIMULATOR_OPTIONAL_RUNTIMES[simulatorId].pythonVersion;
  if (!requiredVersion) {
    return true;
  }
  return pythonVersionForExecutable(pythonExecutable) === requiredVersion;
}

function installPythonPackages(pythonExecutable, packages) {
  if (packages.length === 0) {
    return;
  }
  if (commandExists("uv")) {
    run("uv", ["pip", "install", "--python", pythonExecutable, ...packages]);
  } else {
    run(pythonExecutable, ["-m", "pip", "install", ...packages]);
  }
}

function printStatus(statuses, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }
  log("Simulator runtimes", colors.pink);
  for (const status of statuses) {
    const marker = status.available ? "available" : "missing";
    const color = status.available ? colors.green : colors.yellow;
    log(`  ${status.simulatorId}: ${marker} (${status.detail})`, color);
  }
}

function printInstallNotes(simulatorIds) {
  for (const simulatorId of simulatorIds) {
    const runtime = SIMULATOR_OPTIONAL_RUNTIMES[simulatorId];
    if (runtime.installNote) {
      log(`${runtime.label}: ${runtime.installNote}`, colors.yellow);
    }
    if (runtime.executableEnv) {
      log(`${runtime.label} is an external application runtime.`, colors.yellow);
      log(
        `  Install ${runtime.label} from its upstream distribution, then set ${runtime.executableEnv} if it is not on PATH.`,
        colors.gray,
      );
    }
  }
}

function usage() {
  console.log("URDF Studio simulator runtime helper");
  console.log("");
  console.log("Usage:");
  console.log("  npm run simulator:status");
  console.log("  npm run simulator:install -- genesis");
  console.log("  npm run simulator:install -- mujoco pybullet");
  console.log("  npm run simulator:install -- all");
  console.log("");
  console.log(`Targets: ${SIMULATOR_OPTIONAL_RUNTIME_IDS.join(", ")}, all`);
  console.log(`Python env: ${PYTHON_ENV_DIRNAME} by default, ${SIMULATOR_PYTHON_ENV_DIRNAME} for Python 3.11 runtimes, or URDF_STUDIO_PYTHON when set.`);
}

async function main() {
  const [command = "status", ...rawArgs] = process.argv.slice(2);
  if (
    command === "--help"
    || command === "-h"
    || command === "help"
    || rawArgs.includes("--help")
    || rawArgs.includes("-h")
  ) {
    usage();
    return;
  }
  const json = rawArgs.includes("--json");
  const args = rawArgs.filter((arg) => arg !== "--json");
  if (command === "status") {
    const simulatorIds = normalizeSimulatorSelection(args);
    printStatus(collectRuntimeStatus(simulatorIds), { json });
    return;
  }
  if (command === "install") {
    if (args.length === 0) {
      throw new Error("Choose at least one simulator to install, or pass all explicitly.");
    }
    const simulatorIds = normalizeSimulatorSelection(args);
    const pythonExecutable = ensureInstallPython(simulatorIds);
    const before = collectRuntimeStatus(simulatorIds, pythonExecutable);
    const missingPythonRuntimeIds = before
      .filter((status) => !status.available)
      .map((status) => status.simulatorId)
      .filter((simulatorId) => SIMULATOR_OPTIONAL_RUNTIMES[simulatorId].kind === "python");
    const wrongPythonRuntimeIds = missingPythonRuntimeIds.filter(
      (simulatorId) => !pythonMatchesRuntime(pythonExecutable, simulatorId),
    );
    for (const simulatorId of wrongPythonRuntimeIds) {
      const runtime = SIMULATOR_OPTIONAL_RUNTIMES[simulatorId];
      log(
        `${runtime.label} requires Python ${runtime.pythonVersion}; current install Python is ${pythonVersionForExecutable(pythonExecutable) || "unknown"}.`,
        colors.yellow,
      );
    }
    const installableRuntimeIds = missingPythonRuntimeIds.filter(
      (simulatorId) => !wrongPythonRuntimeIds.includes(simulatorId),
    );
    const packages = pythonPackagesForSimulatorIds(installableRuntimeIds);
    if (packages.length > 0) {
      log(`Installing simulator Python packages into ${pythonExecutable}: ${packages.join(", ")}`, colors.pink);
      installPythonPackages(pythonExecutable, packages);
    } else if (missingPythonRuntimeIds.length > 0) {
      log("No pip install is configured for the missing selected runtimes.", colors.yellow);
    } else {
      log("Selected Python simulator runtimes are already installed.", colors.gray);
    }
    printInstallNotes(simulatorIds);
    printStatus(collectRuntimeStatus(simulatorIds, pythonExecutable), { json });
    return;
  }
  throw new Error(`Unknown command "${command}". Run "npm run simulator:status -- --help" for usage.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    log(error instanceof Error ? error.message : String(error), colors.yellow);
    process.exit(1);
  });
}
