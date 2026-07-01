#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { runtimeConfig, runtimeUrls } from "../../config/runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..", "..");
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 500;

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

function resolvePythonExecutable() {
  if (process.env.URDF_STUDIO_PYTHON) {
    return process.env.URDF_STUDIO_PYTHON;
  }
  const candidates = [
    join(rootDir, ".venv", "bin", "python3"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found || "python3";
}

function spawnManaged(command, args, { prefix, env = process.env } = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const write = (stream, data) => {
    for (const line of data.toString().split(/\r?\n/)) {
      if (line.trim()) {
        stream.write(`[${prefix}] ${line}\n`);
      }
    }
  };
  child.stdout.on("data", (data) => write(process.stdout, data));
  child.stderr.on("data", (data) => write(process.stderr, data));
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal === null) {
      log(`${prefix} exited with code ${code}`, colors.yellow);
    }
  });
  return child;
}

function runStep(command, args, { prefix, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env,
    shell: false,
    stdio: "pipe",
    encoding: "utf8",
  });
  const write = (stream, output) => {
    for (const line of output.split(/\r?\n/)) {
      if (line.trim()) {
        stream.write(`[${prefix}] ${line}\n`);
      }
    }
  };
  write(process.stdout, result.stdout || "");
  write(process.stderr, result.stderr || "");
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${prefix} exited with code ${result.status}`);
  }
}

async function waitForUrl(url) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the process is ready or the timeout expires.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function stop(child) {
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGTERM");
}

async function main() {
  const { command, argsPrefix } = getNpmCommand();
  runStep(command, [...argsPrefix, "run", "build"], {
    prefix: "build",
  });

  const python = resolvePythonExecutable();
  const apiEnv = {
    ...process.env,
    URDF_API_HOST: runtimeConfig.api.host,
    URDF_API_BIND_HOST: runtimeConfig.api.bindHost,
    URDF_API_PORT: String(runtimeConfig.api.port),
  };
  const backend = spawnManaged(python, ["-m", "backend.server"], {
    prefix: "backend",
    env: apiEnv,
  });

  const frontend = spawnManaged(command, [...argsPrefix, "run", "preview", "--", "--host", runtimeConfig.web.bindHost], {
    prefix: "web",
  });

  const shutdown = () => {
    stop(frontend);
    stop(backend);
  };
  process.once("SIGINT", () => {
    shutdown();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    shutdown();
    process.exit(143);
  });

  await Promise.all([
    waitForUrl(`${runtimeUrls.apiBaseUrl}/health`),
    waitForUrl(runtimeUrls.webBaseUrl),
  ]);

  log("Ready:", colors.green);
  log(`Open URDF Studio: ${runtimeUrls.webBaseUrl}`, colors.pink);
  log(`Fresh browser URL: ${runtimeUrls.webBaseUrl}?urdfStudioClearState=1`, colors.gray);
  if (runtimeConfig.web.bindHost === "0.0.0.0" || runtimeConfig.web.bindHost === "::") {
    log("If localhost does not load from your browser, use the forwarded port 5173 URL or one of the Network URLs above.", colors.gray);
  } else {
    log("Access: only this laptop by default.", colors.gray);
  }
}

main().catch((error) => {
  log(error instanceof Error ? error.message : String(error), colors.yellow);
  process.exit(1);
});
