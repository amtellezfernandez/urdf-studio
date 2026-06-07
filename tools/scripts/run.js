#!/usr/bin/env node

import { readFileSync, existsSync, accessSync, constants as fsConstants } from 'fs';
import { fileURLToPath } from 'url';
import { delimiter, dirname, join } from 'path';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import readline from 'readline';
import { runtimeConfig as baseRuntimeConfig } from '../../config/runtime.js';
import { clearLoadedRobotEnvOverlayValues } from '../../config/privateEnv.js';
import { resolveBackendGitHubToken } from './githubAuth.js';
import {
  applyRuntimeEnvOverrides,
  applyRobotGatewayEnvSelection,
  applyTeamModeRuntimeProfile,
  assertRemoteBindingsAllowed,
  buildSecurityPostureLines,
  buildStartupOverviewLines,
  resolveLocalNetworkUrl,
  buildTeamModeGuideLines,
  buildLoopbackApiBaseUrl,
  buildTeamSharingWebBaseUrl,
  buildRunHelpText,
  buildRuntimeUrls,
  formatMissingAcknowledgementsMessage,
  formatStartupSecurityViolationsMessage,
  formatUnknownRunArgsMessage,
  getMissingSecurityAcknowledgements,
  getRemoteBindingIssues,
  getStartupSecurityViolations,
  mergeRuntimeConfig,
  parseRunArgs,
  recoverLoopbackPorts,
  resolveTeamModeHost,
  shouldExposeIkdRuntime,
} from './runConfig.js';
import {
  CLOUD_FLARED_BINARY_ENV,
  RUN_ACKNOWLEDGEMENT_TOKENS,
  RUN_BACKEND_READY_TIMEOUT_MS,
  RUN_FRONTEND_READY_TIMEOUT_MS,
  RUN_READY_POLL_INTERVAL_MS,
  RUN_READY_REQUEST_TIMEOUT_MS,
  RUN_SKIP_STALE_PROCESS_CLEANUP_ENV,
  RUN_SHUTDOWN_GRACE_MS,
  RUN_STALE_PROCESS_CLEANUP_GRACE_MS,
} from './runParams.js';
import { PYTHON_ENV_DIRNAME } from './setupParams.js';
import {
  applyUrdfOpsEnv,
  buildUrdfOpsRuntime,
  isUrdfOpsCheckoutAvailable,
} from './urdfOpsIntegration.js';
import { URDF_OPS_SKIP_START_ENV } from './urdfOpsParams.js';
import {
  buildManagedSpawnOptions,
  terminateManagedProcess,
  terminateStaleUrdfStudioProcessGroups,
} from './processLifecycle.js';
import { startCamToSimIngressProxy } from './camToSimIngressProxy.js';
import {
  buildOutdatedVersionMessage,
  formatOfficialVersionStatusMessage,
  resolveOfficialVersionStatus,
  shouldBypassOutdatedVersionGate,
  VERSION_CHECK_STATES,
} from './updateCheck.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..', '..');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  pink: '\x1b[35m',      // Magenta/pink
  pinkBright: '\x1b[95m', // Bright magenta
  pinkLight: '\x1b[38;5;213m', // Light pink
  pinkDark: '\x1b[38;5;162m',  // Dark pink
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  underline: '\x1b[4m',
};

const verbose = /^(1|true|yes)$/i.test(process.env.URDF_STUDIO_VERBOSE || '');
const CLOUD_FLARED_DISCOVERY_TIMEOUT_MS = 20_000;
const CLOUD_FLARED_TUNNEL_REGEX = /https:\/\/[-a-z0-9]+\.trycloudflare\.com/i;
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logArrow(message) {
  log(`→ ${message}`, colors.pink);
}

function getNpmCommand() {
  const npmExecPath = typeof process.env.npm_execpath === 'string' ? process.env.npm_execpath.trim() : '';
  if (npmExecPath) {
    return {
      command: process.execPath,
      argsPrefix: [npmExecPath],
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    argsPrefix: [],
  };
}

function spawnNpm(args, options = {}) {
  const { command, argsPrefix } = getNpmCommand();
  return spawn(command, [...argsPrefix, ...args], {
    ...buildManagedSpawnOptions({
      shell: false,
      ...options,
    }),
  });
}

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function question(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function getConfigPath() {
  return join(rootDir, '.urdf-studio-config.json');
}

function loadConfig() {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      return {};
    }
  }
  return {};
}

const banner = `
${colors.pinkBright}    __  ______  ____  ______   _____ __            ___    ${colors.reset}
${colors.pinkBright}   / / / / __ \\/ __ \\/ ____/  / ___// /___  ______/ (_)___ ${colors.reset}
${colors.pink}  / / / / /_/ / / / / /_      \\__ \\/ __/ / / / __  / / __ \\${colors.reset}
${colors.pink} / /_/ / _, _/ /_/ / __/     ___/ / /_/ /_/ / /_/ / / /_/ /${colors.reset}
${colors.pinkLight} \\____/_/ |_/_____/_/       /____/\\__/\\__,_/\\__,_/_/\\____/ ${colors.reset}
${colors.reset}                                                            

${colors.gray}─────────────────────────────────────────────────────────────${colors.reset}
`;

function filterViteOutput(data) {
  if (verbose) {
    return true;
  }
  const output = data.toString();
  
  // Filter out vite's default output
  if (output.includes('VITE') || 
      output.includes('ready in') || 
      output.includes('Local:') ||
      output.includes('Network:') ||
      output.includes('➜')) {
    return false; // Don't show vite's output
  }
  
  // Show errors and warnings
  if (output.includes('Error') || output.includes('Warning') || output.includes('error')) {
    return true;
  }
  
  return false; // Hide most vite output
}

function shouldPrintBackendLine(line) {
  if (verbose) {
    return true;
  }
  const normalized = line.trim();
  if (!normalized) {
    return false;
  }
  const lower = normalized.toLowerCase();

  // Common startup noise that does not help end users.
  if (
    lower.includes('started server process') ||
    lower.includes('waiting for application startup') ||
    lower.includes('application startup complete') ||
    lower.includes('uvicorn running on')
  ) {
    return false;
  }

  // Environment/runtime hints that are usually expected and non-actionable.
  if (
    lower.includes('jax._src.xla_bridge') ||
    lower.includes('joints were not in topological order')
  ) {
    return false;
  }

  return (
    lower.includes('error') ||
    lower.includes('warning') ||
    lower.includes('traceback') ||
    lower.includes('exception') ||
    lower.includes('critical') ||
    lower.includes('failed')
  );
}

function writeBackendOutput(stream, data) {
  const output = data.toString();
  const lines = output.split(/\r?\n/);
  lines.forEach((line) => {
    if (!shouldPrintBackendLine(line)) {
      return;
    }
    stream.write(`[Backend] ${line}\n`);
  });
}

function writePrefixedDiagnosticOutput(prefix, stream, data) {
  if (!verbose) {
    return;
  }
  const output = data.toString();
  const lines = output.split(/\r?\n/);
  lines.forEach((line) => {
    if (line.trim()) {
      stream.write(`[${prefix}] ${line}\n`);
    }
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpReady({
  url,
  label,
  processHandle = null,
  timeoutMs,
}) {
  const startedAt = Date.now();
  let processExit = null;
  const onExit = (code, signal) => {
    processExit = { code, signal };
  };
  processHandle?.once('exit', onExit);

  try {
    while (Date.now() - startedAt < timeoutMs) {
      if (processExit) {
        throw new Error(
          `${label} exited before it was ready (code ${processExit.code ?? 'null'}, signal ${processExit.signal ?? 'null'}).`
        );
      }
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(RUN_READY_REQUEST_TIMEOUT_MS),
        });
        if (response.ok) {
          return;
        }
      } catch (e) {
        // Keep polling until the service binds or the timeout expires.
      }
      await wait(RUN_READY_POLL_INTERVAL_MS);
    }
  } finally {
    processHandle?.off('exit', onExit);
  }

  throw new Error(`${label} did not become ready at ${url} within ${timeoutMs} ms.`);
}

async function isHttpReady(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(RUN_READY_REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function findCargo() {
  const cargoLocations = [
    join(process.env.HOME || '', '.cargo', 'bin', 'cargo'),
    '/usr/local/bin/cargo',
    '/usr/bin/cargo',
  ];

  for (const cargoPath of cargoLocations) {
    if (existsSync(cargoPath)) {
      return cargoPath;
    }
  }

  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'cargo');
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isExecutable(path) {
  if (!existsSync(path)) {
    return false;
  }
  if (process.platform === 'win32') {
    return true;
  }
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findBinary(name) {
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function resolveCloudflaredBinary() {
  const configuredBinary = typeof process.env[CLOUD_FLARED_BINARY_ENV] === 'string'
    ? process.env[CLOUD_FLARED_BINARY_ENV].trim()
    : '';
  if (configuredBinary) {
    if (isExecutable(configuredBinary)) {
      return { binaryPath: configuredBinary, reason: null };
    }
    return {
      binaryPath: null,
      reason: `${CLOUD_FLARED_BINARY_ENV} does not point to an executable cloudflared binary`,
    };
  }

  const globalBinary = findBinary('cloudflared');
  if (globalBinary) {
    return { binaryPath: globalBinary, reason: null };
  }

  return {
    binaryPath: null,
    reason: 'cloudflared not found. Install it manually; automatic download is disabled for security.',
  };
}

function maybeExtractCloudflareUrl(chunk) {
  const match = chunk.match(CLOUD_FLARED_TUNNEL_REGEX);
  return match ? match[0] : null;
}

async function startCloudflareTunnel(env, apiBaseUrl) {
  const cloudflared = await resolveCloudflaredBinary();
  if (!cloudflared.binaryPath) {
    return Promise.resolve({ process: null, publicBaseUrl: null, reason: cloudflared.reason });
  }
  const cloudflaredBinary = cloudflared.binaryPath;

  return new Promise((resolve) => {
    const tunnelProcess = spawn(
      cloudflaredBinary,
      ['tunnel', '--url', apiBaseUrl, '--no-autoupdate'],
      buildManagedSpawnOptions({
        cwd: rootDir,
        env,
        shell: false,
        stdio: 'pipe',
      })
    );

    let settled = false;
    const cleanupAndResolve = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    const timeoutHandle = setTimeout(() => {
      cleanupAndResolve({
        process: tunnelProcess,
        publicBaseUrl: null,
        reason: 'timed out while waiting for a cloudflared URL',
      });
    }, CLOUD_FLARED_DISCOVERY_TIMEOUT_MS);

    const onChunk = (chunk) => {
      const text = chunk.toString();
      if (verbose) {
        process.stdout.write(`[Tunnel] ${text}`);
      }
      const discoveredUrl = maybeExtractCloudflareUrl(text);
      if (!discoveredUrl) return;
      clearTimeout(timeoutHandle);
      cleanupAndResolve({
        process: tunnelProcess,
        publicBaseUrl: discoveredUrl,
        reason: null,
      });
    };

    tunnelProcess.stdout.on('data', onChunk);
    tunnelProcess.stderr.on('data', onChunk);
    tunnelProcess.on('error', (error) => {
      clearTimeout(timeoutHandle);
      cleanupAndResolve({
        process: null,
        publicBaseUrl: null,
        reason: `cloudflared failed to start: ${error.message}`,
      });
    });
    tunnelProcess.on('exit', (code) => {
      if (settled) return;
      clearTimeout(timeoutHandle);
      cleanupAndResolve({
        process: null,
        publicBaseUrl: null,
        reason: `cloudflared exited before URL discovery (code ${code ?? 'unknown'})`,
      });
    });
  });
}

function printRuntimeHelp() {
  console.log(buildRunHelpText());
}

function isStaleProcessCleanupEnabled(env = process.env) {
  return !/^(1|true|yes)$/i.test(env[RUN_SKIP_STALE_PROCESS_CLEANUP_ENV] || '');
}

function shouldStartUrdfOps(env = process.env) {
  return !/^(1|true|yes)$/i.test(env[URDF_OPS_SKIP_START_ENV] || '');
}

async function cleanupStaleProcessGroups({ concurrentRobotGateway = false } = {}) {
  if (concurrentRobotGateway) {
    return [];
  }
  if (!isStaleProcessCleanupEnabled()) {
    return [];
  }
  const staleGroups = terminateStaleUrdfStudioProcessGroups({ rootDir });
  if (staleGroups.length === 0) {
    return staleGroups;
  }
  await new Promise((resolve) => setTimeout(resolve, RUN_STALE_PROCESS_CLEANUP_GRACE_MS));
  return staleGroups;
}

async function requestMissingAcknowledgements(missingAcknowledgements) {
  for (const acknowledgement of missingAcknowledgements) {
    if (acknowledgement.kind === 'publicTunnel') {
      log('');
      log('  Data mode can create a public internet URL to your local API.', colors.yellow);
      log('  Anyone with that active tunnel URL can hit the phone-link ingress while it is up.', colors.yellow);
      const answer = (await question(`  Type ${RUN_ACKNOWLEDGEMENT_TOKENS.publicTunnel} to continue: `)).trim().toUpperCase();
      if (answer !== RUN_ACKNOWLEDGEMENT_TOKENS.publicTunnel) {
        throw new Error('Public tunnel acknowledgement declined');
      }
      continue;
    }

    if (acknowledgement.kind === 'remoteExposure') {
      log('');
      log('  Remote bind mode exposes URDF Studio services on non-loopback interfaces.', colors.yellow);
      log('  Other hosts on your network may be able to reach them.', colors.yellow);
      const answer = (await question(`  Type ${RUN_ACKNOWLEDGEMENT_TOKENS.remoteExposure} to continue: `)).trim().toUpperCase();
      if (answer !== RUN_ACKNOWLEDGEMENT_TOKENS.remoteExposure) {
        throw new Error('Remote exposure acknowledgement declined');
      }
    }
  }
}

async function main() {
  console.log(banner);

  const parsedRunArgs = parseRunArgs(process.argv.slice(2));
  if (parsedRunArgs.help) {
    printRuntimeHelp();
    return;
  }
  if (parsedRunArgs.unknownArgs.length > 0) {
    throw new Error(formatUnknownRunArgsMessage(parsedRunArgs.unknownArgs));
  }

  const config = loadConfig();
  const backendGitHubAuth = resolveBackendGitHubToken({ configToken: config.githubToken });
  const officialVersionStatus = await resolveOfficialVersionStatus({
    cwd: rootDir,
    githubToken: backendGitHubAuth.token,
  });
  if (
    (officialVersionStatus.state === VERSION_CHECK_STATES.behind ||
      officialVersionStatus.state === VERSION_CHECK_STATES.diverged) &&
    !shouldBypassOutdatedVersionGate({
      allowOutdated: parsedRunArgs.allowOutdated,
      env: process.env,
    })
  ) {
    throw new Error(buildOutdatedVersionMessage(officialVersionStatus));
  }

  const isDataMode =
    parsedRunArgs.dataMode || /^(1|true|yes)$/i.test(process.env.URDF_STUDIO_DATA_MODE || '');
  const isRuntimeDemoMode =
    parsedRunArgs.runtimeDemoMode ||
    /^(1|true|yes)$/i.test(process.env.URDF_STUDIO_RUNTIME_DEMO || '');
  const mergedRuntimeConfigBase = mergeRuntimeConfig(baseRuntimeConfig, parsedRunArgs.overrides);
  const teamModeHost = parsedRunArgs.teamMode
    ? resolveTeamModeHost({ explicitHost: parsedRunArgs.teamHost })
    : null;
  const useTeamSharingGateway = false;
  const exposedFrontendRuntimeConfig = mergedRuntimeConfigBase;
  const teamRuntimeConfig = parsedRunArgs.teamMode
    ? applyTeamModeRuntimeProfile(mergedRuntimeConfigBase, { publicHost: teamModeHost })
    : exposedFrontendRuntimeConfig;
  const mergedRuntimeConfig = parsedRunArgs.teleopMode
    ? {
        ...teamRuntimeConfig,
        teleop: {
          ...teamRuntimeConfig.teleop,
          enabled: true,
        },
      }
    : teamRuntimeConfig;
  const allowRemoteBinds = parsedRunArgs.allowRemote || parsedRunArgs.teamMode;
  const staleProcessGroups = await cleanupStaleProcessGroups({
    concurrentRobotGateway: Boolean(parsedRunArgs.robotName || parsedRunArgs.robotEnvFile),
  });
  const recoveredPorts = await recoverLoopbackPorts(mergedRuntimeConfig, {
    webPortPinned: Object.prototype.hasOwnProperty.call(parsedRunArgs.overrides.web || {}, 'port'),
    apiPortPinned: Object.prototype.hasOwnProperty.call(parsedRunArgs.overrides.api || {}, 'port'),
    ikdPortPinned: Object.prototype.hasOwnProperty.call(parsedRunArgs.overrides.ikd || {}, 'port'),
    teleopHttpPortPinned: Object.prototype.hasOwnProperty.call(parsedRunArgs.overrides.teleop || {}, 'httpPort'),
    teleopWebTransportPortPinned: Object.prototype.hasOwnProperty.call(parsedRunArgs.overrides.teleop || {}, 'webtransportPort'),
    teleopNativeQuicPortPinned: Object.prototype.hasOwnProperty.call(parsedRunArgs.overrides.teleop || {}, 'nativeQuicPort'),
  });
  const runtimeConfig = recoveredPorts.runtimeConfig;
  // The demo frontend is intentionally reachable on the LAN; backend/teleop binds still require explicit opt-in.
  assertRemoteBindingsAllowed(runtimeConfig, {
    allowGatedFrontend: true,
    allowRemote: allowRemoteBinds,
  });
  const remoteExposureIssues = getRemoteBindingIssues(runtimeConfig, {
    allowGatedFrontend: useTeamSharingGateway,
  });
  const runtimeUrls = buildRuntimeUrls(runtimeConfig);
  const loopbackApiBaseUrl = buildLoopbackApiBaseUrl(runtimeConfig);
  const teamSharingWebBaseUrl = buildTeamSharingWebBaseUrl(runtimeConfig, {
    publicHost: teamModeHost,
  });
  const missingAcknowledgements = getMissingSecurityAcknowledgements(
    {
      ackPublicTunnel: parsedRunArgs.ackPublicTunnel,
      ackRemoteExposure: parsedRunArgs.ackRemoteExposure,
      allowRemote: allowRemoteBinds,
      dataMode: isDataMode,
    },
    {
      env: process.env,
      remoteExposureIssues,
    }
  );

  if (missingAcknowledgements.length > 0) {
    if (!isInteractive()) {
      throw new Error(formatMissingAcknowledgementsMessage(missingAcknowledgements));
    }
    await requestMissingAcknowledgements(missingAcknowledgements);
  }
  const startupSecurityViolations = getStartupSecurityViolations(
    {
      dataMode: isDataMode,
      remoteExposureIssues,
    },
    {
      env: process.env,
    }
  );
  if (startupSecurityViolations.length > 0) {
    throw new Error(formatStartupSecurityViolationsMessage(startupSecurityViolations));
  }

  logArrow('Starting URDF Studio...');
  if (staleProcessGroups.length > 0) {
    log(
      `  Stopped ${staleProcessGroups.length} stale URDF Studio process group(s) from this checkout before port selection.`,
      colors.yellow
    );
  }
  for (const notice of recoveredPorts.notices) {
    log(`  ${notice}`, colors.yellow);
  }
  if (
    officialVersionStatus.state === VERSION_CHECK_STATES.behind ||
    officialVersionStatus.state === VERSION_CHECK_STATES.diverged
  ) {
    log(`  ${formatOfficialVersionStatusMessage(officialVersionStatus)}`, colors.yellow);
    log(`  Outdated-version gate bypassed. You are not on the latest official code.`, colors.yellow);
  } else if (officialVersionStatus.state === VERSION_CHECK_STATES.ahead) {
    log(`  ${formatOfficialVersionStatusMessage(officialVersionStatus)}`, colors.yellow);
  } else if (
    officialVersionStatus.state === VERSION_CHECK_STATES.custom ||
    officialVersionStatus.state === VERSION_CHECK_STATES.unavailable ||
    officialVersionStatus.state === VERSION_CHECK_STATES.skipped
  ) {
    log(`  ${formatOfficialVersionStatusMessage(officialVersionStatus)}`, colors.gray);
  } else if (verbose) {
    log(`  ${formatOfficialVersionStatusMessage(officialVersionStatus)}`, colors.gray);
  }
  
  const defaultSolverChain = Array.isArray(runtimeConfig.ik?.defaultSolverChain)
    ? runtimeConfig.ik.defaultSolverChain
    : [];
  const defaultSolverId =
    typeof defaultSolverChain[0] === "string" ? defaultSolverChain[0] : "ik-js";
  const forceIkdStart = /^(1|true|yes)$/i.test(process.env.URDF_IKD_FORCE_START || "");
  const shouldStartIkd =
    runtimeConfig.ikd.enabled &&
    (forceIkdStart || (runtimeConfig.ikd.useForDrag && defaultSolverId !== "ik-js"));
  const cargoPath = findCargo();
  const ikdManifest = join(rootDir, 'ikd', 'Cargo.toml');
  const canStartIkd = shouldExposeIkdRuntime({
    shouldStartIkd,
    ikdManifestAvailable: existsSync(ikdManifest),
    cargoAvailable: Boolean(cargoPath),
  });
  
  // Set environment variables if tokens exist
  const launcherEnv =
    parsedRunArgs.robotName || parsedRunArgs.robotEnvFile
      ? clearLoadedRobotEnvOverlayValues({ ...process.env }, { sourceEnv: process.env })
      : process.env;
  const opsRuntime = buildUrdfOpsRuntime({ studioRootDir: rootDir });
  const shouldLaunchUrdfOps = shouldStartUrdfOps();
  let env = applyRobotGatewayEnvSelection(
    applyRuntimeEnvOverrides(launcherEnv, runtimeConfig),
    {
      robotEnvFile: parsedRunArgs.robotEnvFile,
      robotName: parsedRunArgs.robotName,
    },
  );
  env = applyUrdfOpsEnv(env, opsRuntime);
  const rosUrdfdomCandidates = [
    '/opt/ros/jazzy/lib/x86_64-linux-gnu',
    '/opt/ros/rolling/lib/x86_64-linux-gnu',
    '/opt/ros/humble/lib/x86_64-linux-gnu',
    '/opt/ros/kilted/lib/x86_64-linux-gnu',
  ];
  for (const dir of rosUrdfdomCandidates) {
    if (existsSync(join(dir, 'liburdfdom_sensor.so.4.0'))) {
      env.LD_LIBRARY_PATH = [dir, env.LD_LIBRARY_PATH].filter(Boolean).join(delimiter);
      break;
    }
  }
  env.URDF_IKD_ENABLED = canStartIkd ? 'true' : 'false';
  env.URDF_TEAM_SHARING_INITIAL_ENABLED = parsedRunArgs.teamMode ? 'true' : 'false';
  env.URDF_TEAM_SHARING_LOCAL_URL = runtimeUrls.webBaseUrl;
  env.URDF_TEAM_SHARING_TEAM_URL = teamSharingWebBaseUrl;
  let camToSimIngressProxyToken = null;
  if (backendGitHubAuth.token) {
    env.URDF_GITHUB_TOKEN = backendGitHubAuth.token;
  }
  if (isDataMode) {
    camToSimIngressProxyToken = randomBytes(32).toString('hex');
    env.URDF_CAM_TO_SIM_PROXY_TOKEN = camToSimIngressProxyToken;
  }
  if (isRuntimeDemoMode) {
    env.VITE_RUNTIME_DEMO = '1';
    env.URDF_STUDIO_RUNTIME_DEMO = '1';
  }
  
  // Check if node_modules exists
  if (!existsSync(join(rootDir, 'node_modules'))) {
    log('⚠ Dependencies not installed. Run "urdf-studio setup" first.', colors.yellow);
    process.exit(1);
  }
  
  let camToSimIngressProxy = null;
  let tunnelProcess = null;
  if (isDataMode) {
    camToSimIngressProxy = await startCamToSimIngressProxy({
      backendBaseUrl: loopbackApiBaseUrl,
      proxyToken: camToSimIngressProxyToken,
    });
    log('  Data mode: enabled (public phone-link tunnel path)', colors.yellow);
    const tunnelStart = await startCloudflareTunnel(env, camToSimIngressProxy.baseUrl);
    if (!tunnelStart.publicBaseUrl) {
      if (tunnelStart.process) {
        tunnelStart.process.kill('SIGTERM');
      }
      await new Promise((resolve) => camToSimIngressProxy.server.close(resolve));
      camToSimIngressProxy = null;
      const reason = tunnelStart.reason || 'unknown tunnel setup error';
      throw new Error(
        `Data mode failed closed because the public tunnel could not be established: ${reason}`
      );
    }
    tunnelProcess = tunnelStart.process;
    env.URDF_CAM_TO_SIM_PUBLIC_BASE_URL = tunnelStart.publicBaseUrl;
    log('  Phone Link:', colors.reset);
    log(`  ${colors.pinkBright}${colors.underline}${tunnelStart.publicBaseUrl}${colors.reset}`, colors.reset);
  }

  // Start Python FastAPI backend
  const venvPython = join(rootDir, PYTHON_ENV_DIRNAME, 'bin', 'python3');
  env.URDF_STUDIO_TRAINING_LEROBOT_PYTHON = venvPython;
  let pythonBackendProcess = null;

  if (existsSync(venvPython)) {
    const backendArgs = [
      '-m',
      'uvicorn',
      'backend.server:app',
      '--host',
      runtimeConfig.api.bindHost,
      '--port',
      String(runtimeConfig.api.port),
    ];

    pythonBackendProcess = spawn(venvPython, backendArgs, {
      ...buildManagedSpawnOptions({
        cwd: rootDir,
        env,
        shell: false,
        stdio: 'pipe',
      }),
    });

    pythonBackendProcess.stdout.on('data', (data) => {
      writeBackendOutput(process.stdout, data);
    });

    pythonBackendProcess.stderr.on('data', (data) => {
      writeBackendOutput(process.stderr, data);
    });

    try {
      await waitForHttpReady({
        url: `${loopbackApiBaseUrl}/health`,
        label: 'Python backend',
        processHandle: pythonBackendProcess,
        timeoutMs: RUN_BACKEND_READY_TIMEOUT_MS,
      });
    } catch (error) {
      terminateManagedProcess(pythonBackendProcess, 'SIGTERM');
      throw error;
    }
  } else {
    throw new Error(`Python backend not started because ${PYTHON_ENV_DIRNAME} is missing. Run npm run setup first.`);
  }

  // Start Rust teleop sidecar when explicitly enabled.
  let teleopProcess = null;
  if (runtimeConfig.teleop.enabled) {
    if (!existsSync(ikdManifest)) {
      log('  Live teleop relay could not start because this checkout is incomplete. Run `npm run setup` on this laptop.', colors.yellow);
    } else if (!cargoPath) {
      log('  Live teleop relay could not start because the local Rust runtime is missing. Run `npm run setup` on this laptop.', colors.yellow);
    } else {
      const teleopEnv = {
        ...env,
        TELEOP_SIDECAR_HTTP_BIND: `${runtimeConfig.teleop.host}:${runtimeConfig.teleop.httpPort}`,
        TELEOP_SIDECAR_WEBTRANSPORT_BIND: `${runtimeConfig.teleop.host}:${runtimeConfig.teleop.webtransportPort}`,
        TELEOP_SIDECAR_NATIVE_QUIC_BIND: `${runtimeConfig.teleop.host}:${runtimeConfig.teleop.nativeQuicPort}`,
        TELEOP_SIDECAR_ENABLE_WEBTRANSPORT: 'true',
      };
      teleopProcess = spawn(
        cargoPath,
        ['run', '--manifest-path', ikdManifest, '--bin', 'teleop_sidecar'],
        buildManagedSpawnOptions({
          cwd: rootDir,
          env: teleopEnv,
          stdio: 'pipe',
        })
      );

      teleopProcess.stdout.on('data', (data) => {
        if (verbose) {
          process.stdout.write(`[TELEOP] ${data}`);
        }
      });

      teleopProcess.stderr.on('data', (data) => {
        process.stderr.write(`[TELEOP] ${data}`);
      });

      teleopProcess.on('error', (error) => {
        log(`  Live teleop relay failed to start: ${error.message}`, colors.yellow);
      });
    }
  }

  // Start Rust IKD daemon if enabled.
  let ikdProcess = null;
  if (shouldStartIkd) {
    if (!existsSync(ikdManifest)) {
      log('  ⚠ ikd enabled but ikd/Cargo.toml was not found.', colors.yellow);
    } else if (!cargoPath) {
      log('  ⚠ ikd enabled but cargo was not found on this machine.', colors.yellow);
    } else {
      const ikdEnv = {
        ...env,
        IKD_HOST: runtimeConfig.ikd.host,
        IKD_PORT: String(runtimeConfig.ikd.port),
        IKD_CONTROL_HZ: String(runtimeConfig.ikd.controlHz),
        IKD_TELEMETRY_HZ: String(runtimeConfig.ikd.telemetryHz),
        IKD_STALE_TARGET_MS: String(runtimeConfig.ikd.staleTargetMs),
        IKD_CORS_ORIGIN: runtimeUrls.webBaseUrl,
      };
      ikdProcess = spawn(
        cargoPath,
        ['run', '--manifest-path', ikdManifest],
        buildManagedSpawnOptions({
          cwd: rootDir,
          env: ikdEnv,
          stdio: 'pipe',
        })
      );

      ikdProcess.stdout.on('data', (data) => {
        if (verbose) {
          process.stdout.write(`[IKD] ${data}`);
        }
      });

      ikdProcess.stderr.on('data', (data) => {
        process.stderr.write(`[IKD] ${data}`);
      });

      ikdProcess.on('error', (error) => {
        log(`  ⚠ Failed to start ikd: ${error.message}`, colors.yellow);
      });
    }
  }

  let urdfOpsBackendProcess = null;
  let urdfOpsFrontendProcess = null;
  let reusedExistingUrdfOps = false;
  if (shouldLaunchUrdfOps) {
    if (!isUrdfOpsCheckoutAvailable(opsRuntime)) {
      throw new Error(`URDF Ops checkout not found at ${opsRuntime.root}. Run npm run setup first.`);
    }
    if (!existsSync(opsRuntime.nodeModulesPath)) {
      throw new Error(`URDF Ops dependencies are missing at ${opsRuntime.root}. Run npm run setup first.`);
    }

    const existingOpsBackendReady = await isHttpReady(opsRuntime.healthUrl);
    const existingOpsFrontendReady = await isHttpReady(opsRuntime.webBaseUrl);
    if (existingOpsBackendReady && existingOpsFrontendReady) {
      reusedExistingUrdfOps = true;
    } else if (existingOpsBackendReady || existingOpsFrontendReady) {
      throw new Error(
        `URDF Ops is partially running. Stop the existing Ops process or set ${URDF_OPS_SKIP_START_ENV}=1.`
      );
    } else {
      urdfOpsBackendProcess = spawn(
        venvPython,
        [
          '-m',
          'uvicorn',
          'backend.app:app',
          '--host',
          '127.0.0.1',
          '--port',
          String(opsRuntime.apiPort),
        ],
        buildManagedSpawnOptions({
          cwd: opsRuntime.root,
          env,
          shell: false,
          stdio: 'pipe',
        })
      );
      urdfOpsBackendProcess.stdout.on('data', (data) => {
        writePrefixedDiagnosticOutput('Ops API', process.stdout, data);
      });
      urdfOpsBackendProcess.stderr.on('data', (data) => {
        writePrefixedDiagnosticOutput('Ops API', process.stderr, data);
      });

      try {
        await waitForHttpReady({
          url: opsRuntime.healthUrl,
          label: 'URDF Ops backend',
          processHandle: urdfOpsBackendProcess,
          timeoutMs: RUN_BACKEND_READY_TIMEOUT_MS,
        });
      } catch (error) {
        terminateManagedProcess(urdfOpsBackendProcess, 'SIGTERM');
        throw error;
      }

      urdfOpsFrontendProcess = spawnNpm(['run', 'dev'], {
        cwd: opsRuntime.root,
        env,
        stdio: 'pipe',
      });
      urdfOpsFrontendProcess.stdout.on('data', (data) => {
        if (filterViteOutput(data)) {
          writePrefixedDiagnosticOutput('Ops Web', process.stdout, data);
        }
      });
      urdfOpsFrontendProcess.stderr.on('data', (data) => {
        if (filterViteOutput(data)) {
          writePrefixedDiagnosticOutput('Ops Web', process.stderr, data);
        }
      });

      try {
        await waitForHttpReady({
          url: opsRuntime.webBaseUrl,
          label: 'URDF Ops frontend',
          processHandle: urdfOpsFrontendProcess,
          timeoutMs: RUN_FRONTEND_READY_TIMEOUT_MS,
        });
      } catch (error) {
        terminateManagedProcess(urdfOpsFrontendProcess, 'SIGTERM');
        terminateManagedProcess(urdfOpsBackendProcess, 'SIGTERM');
        throw error;
      }
    }
  } else {
    log(`  URDF Ops auto-start skipped because ${URDF_OPS_SKIP_START_ENV} is set.`, colors.yellow);
  }

  // Start the dev server with filtered output
  const viteProcess = spawnNpm(['run', 'dev'], {
    cwd: rootDir,
    env,
    stdio: 'pipe',
  });
  
  // Capture and filter stdout
  viteProcess.stdout.on('data', (data) => {
    if (filterViteOutput(data)) {
      process.stdout.write(data);
    }
  });
  
  // Capture and filter stderr
  viteProcess.stderr.on('data', (data) => {
    if (filterViteOutput(data)) {
      process.stderr.write(data);
    }
  });
  
  viteProcess.on('error', (error) => {
    log(`✗ Failed to start: ${error.message}`, colors.red);
    process.exit(1);
  });

  try {
    await waitForHttpReady({
      url: runtimeUrls.webBaseUrl,
      label: 'Vite frontend',
      processHandle: viteProcess,
      timeoutMs: RUN_FRONTEND_READY_TIMEOUT_MS,
    });
  } catch (error) {
    terminateManagedProcess(viteProcess, 'SIGTERM');
    terminateManagedProcess(pythonBackendProcess, 'SIGTERM');
    terminateManagedProcess(teleopProcess, 'SIGTERM');
    terminateManagedProcess(ikdProcess, 'SIGTERM');
    terminateManagedProcess(urdfOpsFrontendProcess, 'SIGTERM');
    terminateManagedProcess(urdfOpsBackendProcess, 'SIGTERM');
    terminateManagedProcess(tunnelProcess, 'SIGTERM');
    if (camToSimIngressProxy) {
      camToSimIngressProxy.server.close();
    }
    throw error;
  }

  log('');
  log('  Ready:', colors.reset);
  for (const overviewLine of buildStartupOverviewLines({
    dataMode: isDataMode,
    localNetworkUrl: resolveLocalNetworkUrl(runtimeConfig),
    remoteExposureIssues,
    runtimeConfig,
    runtimeDemoMode: isRuntimeDemoMode,
    runtimeUrls,
    teamMode: parsedRunArgs.teamMode,
    teamSharingGateway: useTeamSharingGateway,
  })) {
    log(`  ${overviewLine}`, colors.gray);
  }
  if (shouldLaunchUrdfOps) {
    log(`  Open URDF Ops: ${opsRuntime.webBaseUrl}`, colors.gray);
    log(
      reusedExistingUrdfOps
        ? '  Training: Studio links reuse the already-running Ops session.'
        : '  Training: Studio links open this synchronized Ops session.',
      colors.gray
    );
  }

  if (remoteExposureIssues.length > 0) {
    log(
      parsedRunArgs.teamMode
        ? '  Team sharing is enabled on this network.'
        : '  Network access is enabled. Use this only on a trusted network.',
      colors.yellow
    );
  }

  if (verbose) {
    log('');
    log('  Technical details:', colors.reset);
    for (const postureLine of buildSecurityPostureLines({
      dataMode: isDataMode,
      remoteExposureIssues,
      runtimeConfig,
      teamSharingGateway: useTeamSharingGateway,
    })) {
      log(`  ${postureLine}`, colors.gray);
    }
    log(`  frontend URL: ${runtimeUrls.webBaseUrl}`, colors.gray);
    log(`  backend API: ${runtimeUrls.apiBaseUrl}`, colors.gray);
    log(`  URDF Ops URL: ${opsRuntime.webBaseUrl}`, colors.gray);
    log(`  URDF Ops API: ${opsRuntime.apiBaseUrl}`, colors.gray);
    if (shouldStartIkd) {
      log(`  native IKD: ${runtimeUrls.ikdBaseUrl}`, colors.gray);
    } else if (runtimeConfig.ikd.enabled && runtimeConfig.ikd.useForDrag && defaultSolverId === "ik-js") {
      log('  native IKD: disabled (default solver is ik-js)', colors.gray);
    }
    if (runtimeConfig.teleop.enabled) {
      log(`  live teleop relay: ${runtimeUrls.teleopHttpBaseUrl}`, colors.gray);
      log(`  fast browser channel: ${runtimeUrls.teleopWebTransportUrl}`, colors.gray);
      log(`  native robot channel: ${runtimeUrls.teleopNativeQuicAddress}`, colors.gray);
      log('  native robot channel requires TELEOP_SIDECAR_CERT_PEM, TELEOP_SIDECAR_KEY_PEM, and TELEOP_SIDECAR_NATIVE_CLIENT_CA_PEM.', colors.gray);
    }
    if (parsedRunArgs.teamMode) {
      for (const guideLine of buildTeamModeGuideLines({
        hasSimulatorApiToken: Boolean((env.URDF_SIMULATOR_API_TOKEN || '').trim()),
        runtimeUrls,
      })) {
        log(`  ${guideLine}`, colors.gray);
      }
    }
  }
  log('');
  log('  Press Ctrl+C to stop', colors.gray);
  log('');
  
  // Handle process termination
  let shutdownStarted = false;
  const shutdown = (signal) => {
    if (shutdownStarted) return;
    shutdownStarted = true;

    if (signal === 'SIGINT') {
      log('');
      log('  Stopping URDF Studio...', colors.gray);
    }

    terminateManagedProcess(viteProcess, signal);
    terminateManagedProcess(pythonBackendProcess, signal);
    terminateManagedProcess(teleopProcess, signal);
    terminateManagedProcess(ikdProcess, signal);
    terminateManagedProcess(urdfOpsFrontendProcess, signal);
    terminateManagedProcess(urdfOpsBackendProcess, signal);
    terminateManagedProcess(tunnelProcess, signal);
    if (camToSimIngressProxy) {
      camToSimIngressProxy.server.close();
    }
    setTimeout(() => {
      process.exit(0);
    }, RUN_SHUTDOWN_GRACE_MS);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
}

main().catch((error) => {
  log(`✗ Failed to start: ${error instanceof Error ? error.message : String(error)}`, colors.red);
  process.exit(1);
});
