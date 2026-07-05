#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { delimiter, dirname, join } from 'path';
import { spawn } from 'child_process';
import readline from 'readline';
import { runtimeConfig as baseRuntimeConfig } from '../../config/runtime.js';
import { resolveBackendGitHubToken } from './githubAuth.js';
import {
  applyRuntimeEnvOverrides,
  applyTeamModeRuntimeProfile,
  applyTeamSharingGatewayRuntimeProfile,
  assertRemoteBindingsAllowed,
  buildSecurityPostureLines,
  buildFrontendReadyUrl,
  buildStartupOverviewLines,
  resolveLocalNetworkUrl,
  buildTeamModeGuideLines,
  buildLoopbackApiBaseUrl,
  buildTeamSharingWebBaseUrl,
  buildRunHelpText,
  buildRuntimeUrls,
  formatMissingAcknowledgementsMessage,
  formatUnknownRunArgsMessage,
  getMissingSecurityAcknowledgements,
  mergeRuntimeConfig,
  parseRunArgs,
  recoverLoopbackPorts,
  resolveTeamModeHost,
  isLoopbackHost,
  shouldExposeIkdRuntime,
} from './runConfig.js';
import {
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
  buildManagedSpawnOptions,
  terminateManagedProcess,
  terminateStaleUrdfStudioProcessGroups,
} from './processLifecycle.js';
import { getNpmCommand } from './setupNodeRuntime.js';
import {
  ensureWslWindowsLocalhostAccess,
  stopWslWindowsLocalhostRelay,
} from './wslWindowsLocalhostRelay.js';
import { findCargo } from './setupToolchainRuntime.js';
import { isWslEnvironment } from '../../config/wslOwnerProxy.js';
import {
  buildOutdatedVersionMessage,
  formatOfficialVersionStatusMessage,
  resolveOfficialVersionStatus,
  shouldBypassOutdatedVersionGate,
  VERSION_CHECK_STATES,
} from './updateCheck.js';
import { createTerminalLogger } from './terminalOutput.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..', '..');

const { colors, log, logArrow } = createTerminalLogger();

const verbose = /^(1|true|yes)$/i.test(process.env.URDF_STUDIO_VERBOSE || '');

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

const OPTIONAL_BACKEND_IMPORT_NOISE = [
  'failed to import warp: no module named',
  'failed to import mujoco_warp: no module named',
];

export function shouldPrintBackendLine(line) {
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

  if (OPTIONAL_BACKEND_IMPORT_NOISE.some((pattern) => lower.includes(pattern))) {
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shouldUseWslTeamSharingGateway({
  allowRemote = false,
  isWsl = false,
  runtimeConfig,
  teamMode = false,
} = {}) {
  return (
    !teamMode &&
    !allowRemote &&
    isWsl &&
    isLoopbackHost(runtimeConfig?.web?.host) &&
    isLoopbackHost(runtimeConfig?.web?.bindHost)
  );
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

function printRuntimeHelp() {
  console.log(buildRunHelpText());
}

function isStaleProcessCleanupEnabled(env = process.env) {
  return !/^(1|true|yes)$/i.test(env[RUN_SKIP_STALE_PROCESS_CLEANUP_ENV] || '');
}

async function cleanupStaleProcessGroups() {
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

  const mergedRuntimeConfigBase = mergeRuntimeConfig(baseRuntimeConfig, parsedRunArgs.overrides);
  const useTeamSharingGateway = shouldUseWslTeamSharingGateway({
    allowRemote: parsedRunArgs.allowRemote,
    isWsl: isWslEnvironment(),
    runtimeConfig: mergedRuntimeConfigBase,
    teamMode: parsedRunArgs.teamMode,
  });
  const teamModeHost = parsedRunArgs.teamMode
    ? resolveTeamModeHost({ explicitHost: parsedRunArgs.teamHost })
    : null;
  const exposedFrontendRuntimeConfig = useTeamSharingGateway
    ? applyTeamSharingGatewayRuntimeProfile(mergedRuntimeConfigBase)
    : mergedRuntimeConfigBase;
  const teamRuntimeConfig = parsedRunArgs.teamMode
    ? applyTeamModeRuntimeProfile(mergedRuntimeConfigBase, { publicHost: teamModeHost })
    : exposedFrontendRuntimeConfig;
  const mergedRuntimeConfig = teamRuntimeConfig;
  const allowRemoteBinds = parsedRunArgs.allowRemote || parsedRunArgs.teamMode;
  const staleProcessGroups = await cleanupStaleProcessGroups();
  const recoveredPorts = await recoverLoopbackPorts(mergedRuntimeConfig, {
    webPortPinned: Object.prototype.hasOwnProperty.call(parsedRunArgs.overrides.web || {}, 'port'),
    apiPortPinned: Object.prototype.hasOwnProperty.call(parsedRunArgs.overrides.api || {}, 'port'),
    ikdPortPinned: Object.prototype.hasOwnProperty.call(parsedRunArgs.overrides.ikd || {}, 'port'),
  });
  const runtimeConfig = recoveredPorts.runtimeConfig;
  const remoteExposureIssues = assertRemoteBindingsAllowed(runtimeConfig, {
    allowGatedFrontend: useTeamSharingGateway,
    allowRemote: allowRemoteBinds,
  });
  const runtimeUrls = buildRuntimeUrls(runtimeConfig);
  const frontendReadyUrl = buildFrontendReadyUrl(runtimeConfig);
  const loopbackApiBaseUrl = buildLoopbackApiBaseUrl(runtimeConfig);
  const teamSharingWebBaseUrl = buildTeamSharingWebBaseUrl(runtimeConfig, {
    publicHost: teamModeHost,
  });
  const missingAcknowledgements = getMissingSecurityAcknowledgements(
    {
      ackRemoteExposure: parsedRunArgs.ackRemoteExposure,
      allowRemote: allowRemoteBinds,
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
  const env = applyRuntimeEnvOverrides(process.env, runtimeConfig);
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
  env.URDF_TEAM_SHARING_LOCAL_URL = frontendReadyUrl;
  env.URDF_TEAM_SHARING_TEAM_URL = teamSharingWebBaseUrl;
  if (backendGitHubAuth.token) {
    env.URDF_GITHUB_TOKEN = backendGitHubAuth.token;
  }
  // Check if node_modules exists
  if (!existsSync(join(rootDir, 'node_modules'))) {
    log('⚠ Dependencies not installed. Run "urdf-studio setup" first.', colors.yellow);
    process.exit(1);
  }
  
  // Start Python FastAPI backend
  const venvPython = join(rootDir, PYTHON_ENV_DIRNAME, 'bin', 'python3');
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
      url: frontendReadyUrl,
      label: 'Vite frontend',
      processHandle: viteProcess,
      timeoutMs: RUN_FRONTEND_READY_TIMEOUT_MS,
    });
  } catch (error) {
    terminateManagedProcess(viteProcess, 'SIGTERM');
    terminateManagedProcess(pythonBackendProcess, 'SIGTERM');
    terminateManagedProcess(ikdProcess, 'SIGTERM');
    throw error;
  }

  const wslWindowsLocalhostAccess = ensureWslWindowsLocalhostAccess({ runtimeConfig });
  let wslWindowsLocalhostRelay = null;
  if (wslWindowsLocalhostAccess.status === 'relay-started') {
    wslWindowsLocalhostRelay = wslWindowsLocalhostAccess;
  }

  log('');
  log('  Ready:', colors.reset);
  for (const overviewLine of buildStartupOverviewLines({
    localNetworkUrl: resolveLocalNetworkUrl(runtimeConfig),
    remoteExposureIssues,
    runtimeConfig,
    runtimeUrls,
    teamMode: parsedRunArgs.teamMode,
    teamSharingGateway: useTeamSharingGateway,
  })) {
    log(`  ${overviewLine}`, colors.gray);
  }
  if (
    wslWindowsLocalhostAccess.status === 'relay-started' ||
    wslWindowsLocalhostAccess.status === 'recovered-after-stale-relay-stop'
  ) {
    const killedCount = wslWindowsLocalhostAccess.killedStaleRelayPids?.length || 0;
    const repairPrefix =
      killedCount > 0
        ? `replaced ${killedCount} stale WSL localhost relay${killedCount === 1 ? '' : 's'}`
        : 'started WSL localhost relay';
    log(
      `  Windows localhost: ${wslWindowsLocalhostAccess.localUrl} (${repairPrefix}; target ${wslWindowsLocalhostAccess.targetUrl})`,
      colors.yellow
    );
  } else if (wslWindowsLocalhostAccess.status === 'blocked-by-windows-listener') {
    log(
      `  Windows localhost is blocked by another Windows process on port ${runtimeConfig.web.port}; use ${wslWindowsLocalhostAccess.targetUrl}.`,
      colors.yellow
    );
  } else if (wslWindowsLocalhostAccess.status === 'target-unreachable') {
    log(
      `  Windows localhost forwarding is unavailable and Windows cannot reach ${wslWindowsLocalhostAccess.targetUrl}.`,
      colors.yellow
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
      remoteExposureIssues,
      runtimeConfig,
      teamSharingGateway: useTeamSharingGateway,
    })) {
      log(`  ${postureLine}`, colors.gray);
    }
    log(`  frontend URL: ${runtimeUrls.webBaseUrl}`, colors.gray);
    log(`  backend API: ${runtimeUrls.apiBaseUrl}`, colors.gray);
    if (shouldStartIkd) {
      log(`  native IKD: ${runtimeUrls.ikdBaseUrl}`, colors.gray);
    } else if (runtimeConfig.ikd.enabled && runtimeConfig.ikd.useForDrag && defaultSolverId === "ik-js") {
      log('  native IKD: disabled (default solver is ik-js)', colors.gray);
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
    terminateManagedProcess(ikdProcess, signal);
    stopWslWindowsLocalhostRelay(wslWindowsLocalhostRelay);
    setTimeout(() => {
      process.exit(0);
    }, RUN_SHUTDOWN_GRACE_MS);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
}

const isMainModule = () =>
  Boolean(process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);

if (isMainModule()) {
  main().catch((error) => {
    log(`✗ Failed to start: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    process.exit(1);
  });
}
