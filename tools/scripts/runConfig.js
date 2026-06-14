import { buildRuntimeUrls, formatHostForUrl, resolveLocalNetworkHost } from '../../config/runtime.js';
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import {
  COLLABORATION_JOURNAL_PATH_ENV,
  RUN_ACK_ENV_KEYS,
  RUN_HELP_LINES,
  RUN_LOOPBACK_HOSTS,
  RUN_OPTION_FLAGS,
  RUN_PORT_LIMITS,
  RUN_TEAM_MODE_BIND_HOST,
  RUN_TEAM_MODE_HOST_ENV,
  RUN_TEAM_MODE_HOST_FALLBACK,
} from './runParams.js';

const RUN_VALUE_FLAGS = {
  [RUN_OPTION_FLAGS.webHost]: { section: 'web', key: 'host', type: 'host' },
  [RUN_OPTION_FLAGS.webPort]: { section: 'web', key: 'port', type: 'port' },
  [RUN_OPTION_FLAGS.webBindHost]: { section: 'web', key: 'bindHost', type: 'host' },
  [RUN_OPTION_FLAGS.apiHost]: { section: 'api', key: 'host', type: 'host' },
  [RUN_OPTION_FLAGS.apiPort]: { section: 'api', key: 'port', type: 'port' },
  [RUN_OPTION_FLAGS.apiBindHost]: { section: 'api', key: 'bindHost', type: 'host' },
  [RUN_OPTION_FLAGS.ikdHost]: { section: 'ikd', key: 'host', type: 'host' },
  [RUN_OPTION_FLAGS.ikdPort]: { section: 'ikd', key: 'port', type: 'port' },
  [RUN_OPTION_FLAGS.teleopHost]: { section: 'teleop', key: 'host', type: 'host' },
  [RUN_OPTION_FLAGS.teleopHttpPort]: { section: 'teleop', key: 'httpPort', type: 'port' },
  [RUN_OPTION_FLAGS.teleopWebTransportPort]: { section: 'teleop', key: 'webtransportPort', type: 'port' },
  [RUN_OPTION_FLAGS.teleopNativeQuicPort]: { section: 'teleop', key: 'nativeQuicPort', type: 'port' },
};

function normalizeOptionToken(token) {
  if (typeof token !== 'string') {
    return { flag: '', inlineValue: null };
  }
  const separatorIndex = token.indexOf('=');
  if (separatorIndex < 0) {
    return { flag: token, inlineValue: null };
  }
  return {
    flag: token.slice(0, separatorIndex),
    inlineValue: token.slice(separatorIndex + 1),
  };
}

function requireOptionValue(flag, inlineValue, argv, index) {
  if (inlineValue !== null) {
    return { value: inlineValue, nextIndex: index };
  }
  const nextValue = argv[index + 1];
  if (typeof nextValue !== 'string' || nextValue.length === 0) {
    throw new Error(`${flag} requires a value`);
  }
  return { value: nextValue, nextIndex: index + 1 };
}

function parsePortValue(flag, rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${flag} must be an integer port`);
  }
  if (parsed < RUN_PORT_LIMITS.min || parsed > RUN_PORT_LIMITS.max) {
    throw new Error(
      `${flag} must be between ${RUN_PORT_LIMITS.min} and ${RUN_PORT_LIMITS.max}`
    );
  }
  return parsed;
}

function parseHostValue(flag, rawValue) {
  const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!normalized) {
    throw new Error(`${flag} requires a non-empty host`);
  }
  return normalized;
}

function parseRobotNameValue(flag, rawValue) {
  const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('-') ||
    normalized.includes('/') ||
    normalized.includes('\\')
  ) {
    throw new Error(`${flag} requires a robot name such as openarm-a or so100-left-1`);
  }
  return normalized;
}

function parseRobotEnvFileValue(flag, rawValue) {
  const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('/') ||
    normalized.startsWith('-') ||
    normalized.includes('\\')
  ) {
    throw new Error(`${flag} requires a relative env file path`);
  }
  const parts = normalized.split('/');
  if (parts.includes('..') || parts.includes('')) {
    throw new Error(`${flag} requires a relative env file path`);
  }
  return normalized;
}

function assignOverride(overrides, section, key, value) {
  if (!overrides[section]) {
    overrides[section] = {};
  }
  overrides[section][key] = value;
}

function normalizeHost(host) {
  const trimmed = typeof host === 'string' ? host.trim() : '';
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function parseRunArgs(argv = process.argv.slice(2)) {
  const parsedRunArgs = {
    ackPublicTunnel: false,
    ackRemoteExposure: false,
    allowRemote: false,
    allowOutdated: false,
    dataMode: false,
    help: false,
    overrides: {},
    runtimeDemoMode: false,
    teamHost: null,
    teamMode: false,
    teleopMode: false,
    robotEnvFile: null,
    robotName: null,
    unknownArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const { flag, inlineValue } = normalizeOptionToken(token);

    if (flag === RUN_OPTION_FLAGS.help || flag === RUN_OPTION_FLAGS.helpShort) {
      parsedRunArgs.help = true;
      continue;
    }
    if (flag === RUN_OPTION_FLAGS.dataMode) {
      parsedRunArgs.dataMode = true;
      continue;
    }
    if (flag === RUN_OPTION_FLAGS.teleopMode) {
      parsedRunArgs.teleopMode = true;
      continue;
    }
    if (flag === RUN_OPTION_FLAGS.teamMode) {
      parsedRunArgs.teamMode = true;
      continue;
    }
    if (flag === RUN_OPTION_FLAGS.teamHost) {
      const optionValue = requireOptionValue(flag, inlineValue, argv, index);
      parsedRunArgs.teamHost = parseHostValue(flag, optionValue.value);
      index = optionValue.nextIndex;
      continue;
    }
    if (flag === RUN_OPTION_FLAGS.robot) {
      const optionValue = requireOptionValue(flag, inlineValue, argv, index);
      parsedRunArgs.robotName = parseRobotNameValue(flag, optionValue.value);
      index = optionValue.nextIndex;
      continue;
    }
    if (flag === RUN_OPTION_FLAGS.robotEnvFile) {
      const optionValue = requireOptionValue(flag, inlineValue, argv, index);
      parsedRunArgs.robotEnvFile = parseRobotEnvFileValue(flag, optionValue.value);
      index = optionValue.nextIndex;
      continue;
    }
    if (flag === RUN_OPTION_FLAGS.runtimeDemoMode) {
      parsedRunArgs.runtimeDemoMode = true;
      continue;
    }
    if (flag === RUN_OPTION_FLAGS.allowRemote) {
      parsedRunArgs.allowRemote = true;
      continue;
    }
    if (flag === RUN_OPTION_FLAGS.allowOutdated) {
      parsedRunArgs.allowOutdated = true;
      continue;
    }
    if (flag === RUN_OPTION_FLAGS.ackRemoteExposure) {
      parsedRunArgs.ackRemoteExposure = true;
      continue;
    }
    if (flag === RUN_OPTION_FLAGS.ackPublicTunnel) {
      parsedRunArgs.ackPublicTunnel = true;
      continue;
    }

    const valueFlag = RUN_VALUE_FLAGS[flag];
    if (valueFlag) {
      const optionValue = requireOptionValue(flag, inlineValue, argv, index);
      const parsedValue =
        valueFlag.type === 'port'
          ? parsePortValue(flag, optionValue.value)
          : parseHostValue(flag, optionValue.value);
      assignOverride(parsedRunArgs.overrides, valueFlag.section, valueFlag.key, parsedValue);
      index = optionValue.nextIndex;
      continue;
    }

    parsedRunArgs.unknownArgs.push(token);
  }

  return parsedRunArgs;
}

export function applyRobotGatewayEnvSelection(
  env,
  { robotEnvFile = null, robotName = null } = {}
) {
  const nextEnv = { ...env };
  if (robotEnvFile) {
    nextEnv.URDF_ROBOT_GATEWAY_ENV_FILE = robotEnvFile;
    delete nextEnv.URDF_ROBOT_GATEWAY_ENV;
    return nextEnv;
  }
  if (robotName) {
    nextEnv.URDF_ROBOT_GATEWAY_ENV = robotName;
    delete nextEnv.URDF_ROBOT_GATEWAY_ENV_FILE;
  }
  return nextEnv;
}

export function resolveTeamModeHost({
  explicitHost = null,
  env = process.env,
  networkInterfaces = os.networkInterfaces,
} = {}) {
  const normalizedExplicitHost = parseOptionalTeamHost(explicitHost);
  if (normalizedExplicitHost) {
    return normalizedExplicitHost;
  }
  const normalizedEnvHost = parseOptionalTeamHost(env[RUN_TEAM_MODE_HOST_ENV]);
  if (normalizedEnvHost) {
    return normalizedEnvHost;
  }
  const host = resolveLocalNetworkHost({ networkInterfaces });
  return isLoopbackHost(host) ? RUN_TEAM_MODE_HOST_FALLBACK : host;
}

function parseOptionalTeamHost(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

export function applyTeamModeRuntimeProfile(runtimeConfig, { publicHost }) {
  const host = parseOptionalTeamHost(publicHost) || RUN_TEAM_MODE_HOST_FALLBACK;
  return {
    ...runtimeConfig,
    web: {
      ...runtimeConfig.web,
      host,
      bindHost: RUN_TEAM_MODE_BIND_HOST,
    },
  };
}

export function applyTeamSharingGatewayRuntimeProfile(runtimeConfig) {
  return {
    ...runtimeConfig,
    web: {
      ...runtimeConfig.web,
      bindHost: RUN_TEAM_MODE_BIND_HOST,
    },
  };
}

export function buildTeamSharingWebBaseUrl(
  runtimeConfig,
  { publicHost = null, networkInterfaces = os.networkInterfaces } = {},
) {
  const explicitHost = parseOptionalTeamHost(publicHost);
  if (explicitHost && !isLoopbackHost(explicitHost)) {
    return `http://${formatHostForUrl(explicitHost)}:${runtimeConfig.web.port}`;
  }
  if (!isRemoteBindHost(runtimeConfig.web.bindHost)) {
    return '';
  }
  const configuredHost = parseOptionalTeamHost(runtimeConfig.web.host);
  const host = configuredHost && !isLoopbackHost(configuredHost)
    ? configuredHost
    : resolveLocalNetworkHost({ networkInterfaces });
  if (isLoopbackHost(host)) {
    return '';
  }
  return `http://${formatHostForUrl(host)}:${runtimeConfig.web.port}`;
}

export function shouldExposeIkdRuntime({
  shouldStartIkd = false,
  ikdManifestAvailable = false,
  cargoAvailable = false,
} = {}) {
  return Boolean(shouldStartIkd && ikdManifestAvailable && cargoAvailable);
}

export function resolveLocalNetworkUrl(runtimeConfig, { networkInterfaces = os.networkInterfaces } = {}) {
  if (!isRemoteBindHost(runtimeConfig.web.bindHost)) {
    return null;
  }
  const host = resolveLocalNetworkHost({ networkInterfaces });
  if (isLoopbackHost(host)) {
    return null;
  }
  return `http://${formatHostForUrl(host)}:${runtimeConfig.web.port}`;
}

export function buildStartupOverviewLines({
  dataMode = false,
  localNetworkUrl = null,
  remoteExposureIssues = [],
  runtimeConfig,
  runtimeDemoMode = false,
  runtimeUrls,
  teamMode = false,
  teamSharingGateway = false,
}) {
  const lines = [];

  if (teamMode) {
    lines.push(
      `Team URL: ${runtimeUrls.webBaseUrl}`,
      'Access: same Wi-Fi or Tailnet; editing is controlled by share links.',
      'Owner: open the Team URL, open Share, then send viewer/editor links.',
      'Controls: Share can lock editing or reset the editor link.'
    );
    if (runtimeConfig.teleop.enabled) {
      lines.push('Live teleop relay: starting for this team session.');
    }
  } else {
    const hasRemoteExposure = remoteExposureIssues.length > 0;
    const hasRemoteFrontendExposure = remoteExposureIssues.some(
      ({ service }) => service === 'frontend'
    );
    const ownerAccessUrl = hasRemoteFrontendExposure
      ? buildFrontendReadyUrl(runtimeConfig)
      : runtimeUrls.webBaseUrl;
    const networkAccessUrl = localNetworkUrl || runtimeUrls.webBaseUrl;
    const hasSeparateLocalNetworkUrl = Boolean(
      localNetworkUrl && localNetworkUrl !== runtimeUrls.webBaseUrl
    );
    const hasSeparateNetworkAccessUrl = Boolean(
      hasRemoteFrontendExposure &&
        networkAccessUrl &&
        networkAccessUrl !== ownerAccessUrl
    );
    const accessLine = hasRemoteExposure
      ? hasRemoteFrontendExposure
        ? 'Access: frontend is bound to the network; remote browsers are blocked until Team sharing is on.'
        : 'Access: network access is enabled; use only on a trusted network.'
      : teamSharingGateway
        ? 'Access: local by default; remote browsers are blocked until Team sharing is on.'
        : 'Access: only this laptop.';
    const sharingLine = hasRemoteExposure
      ? hasRemoteFrontendExposure
        ? 'Sharing: turn on Share locally before sending the network link.'
        : hasSeparateLocalNetworkUrl
          ? 'Sharing: use the Direct access link from devices on this trusted network.'
          : 'Sharing: use the Open URDF Studio link from devices on this trusted network.'
      : teamSharingGateway
        ? 'Sharing: open Share to turn Wi-Fi/Tailnet invites on or off in this session.'
        : 'Sharing: localhost links work only on this computer.';
    lines.push(
      `Open URDF Studio: ${ownerAccessUrl}`,
      accessLine,
      sharingLine
    );
    if (teamSharingGateway) {
      // In gated local mode the non-loopback bind is an implementation detail used
      // for WSL/owner access stability, not a user-facing entry point.
    } else if (hasSeparateNetworkAccessUrl) {
      lines.push(`Network link: ${networkAccessUrl}`);
    } else if (hasSeparateLocalNetworkUrl) {
      lines.push(`Direct access: ${localNetworkUrl}`);
    }
  }

  if (dataMode) {
    lines.push('Phone link: tunnel starts after the app is ready and is limited to camera/session upload.');
  }
  if (runtimeDemoMode) {
    lines.push('Demo objects: enabled.');
  }

  return lines;
}

export function buildTeamModeGuideLines({ hasSimulatorApiToken = false, runtimeUrls }) {
  const lines = [
    'Team URL: ' + runtimeUrls.webBaseUrl,
    'Owner: open the Team URL, open Share, then send viewer/editor links.',
    'Controls: Share can lock editing or reset the editor link.',
    'Audit journal: set ' + COLLABORATION_JOURNAL_PATH_ENV + '=/secure/path/collaboration.ndjson to retain append-only room records without bearer tokens.',
    hasSimulatorApiToken
      ? 'Advanced: operator API token auth is configured for non-collaboration backend routes.'
      : 'Advanced: operator API is disabled for teammates; collaboration links only grant room editing/viewing.',
  ];
  return lines;
}

export function mergeRuntimeConfig(baseConfig, overrides = {}) {
  return {
    ...baseConfig,
    web: { ...baseConfig.web, ...(overrides.web || {}) },
    api: { ...baseConfig.api, ...(overrides.api || {}) },
    ikd: { ...baseConfig.ikd, ...(overrides.ikd || {}) },
    teleop: { ...baseConfig.teleop, ...(overrides.teleop || {}) },
    ik: baseConfig.ik,
  };
}

export function isLoopbackHost(host) {
  return RUN_LOOPBACK_HOSTS.has(normalizeHost(host));
}

export function isRemoteBindHost(host) {
  const normalized = normalizeHost(host);
  return normalized.length > 0 && !RUN_LOOPBACK_HOSTS.has(normalized);
}

export function getRemoteBindingIssues(runtimeConfig, { allowGatedFrontend = false } = {}) {
  const issues = [];
  if (isRemoteBindHost(runtimeConfig.web.bindHost) && !allowGatedFrontend) {
    issues.push({ service: 'frontend', host: runtimeConfig.web.bindHost, port: runtimeConfig.web.port });
  }
  if (isRemoteBindHost(runtimeConfig.api.bindHost)) {
    issues.push({ service: 'backend API', host: runtimeConfig.api.bindHost, port: runtimeConfig.api.port });
  }
  if (runtimeConfig.ikd.enabled && isRemoteBindHost(runtimeConfig.ikd.host)) {
    issues.push({ service: 'native IKD', host: runtimeConfig.ikd.host, port: runtimeConfig.ikd.port });
  }
  if (runtimeConfig.teleop.enabled && isRemoteBindHost(runtimeConfig.teleop.host)) {
    issues.push({ service: 'live teleop relay', host: runtimeConfig.teleop.host, port: runtimeConfig.teleop.httpPort });
    issues.push({ service: 'teleop fast browser channel', host: runtimeConfig.teleop.host, port: runtimeConfig.teleop.webtransportPort });
    issues.push({ service: 'teleop native robot channel', host: runtimeConfig.teleop.host, port: runtimeConfig.teleop.nativeQuicPort });
  }
  return issues;
}

export function assertRemoteBindingsAllowed(runtimeConfig, { allowGatedFrontend = false, allowRemote = false } = {}) {
  const issues = getRemoteBindingIssues(runtimeConfig, { allowGatedFrontend });
  if (issues.length > 0 && !allowRemote) {
    const summary = issues
      .map(({ service, host, port }) => `${service}=${formatHostForUrl(host)}:${port}`)
      .join(', ');
    throw new Error(
      `Refusing remote bind without ${RUN_OPTION_FLAGS.allowRemote}: ${summary}`
    );
  }
  return issues;
}

export function isTruthyEnvValue(value) {
  return typeof value === 'string' && ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
}

export function getMissingSecurityAcknowledgements(
  {
    ackPublicTunnel = false,
    ackRemoteExposure = false,
    allowRemote = false,
    dataMode = false,
  } = {},
  {
    env = process.env,
    remoteExposureIssues = [],
  } = {}
) {
  const missingAcknowledgements = [];

  if (
    dataMode &&
    !ackPublicTunnel &&
    !isTruthyEnvValue(env[RUN_ACK_ENV_KEYS.publicTunnel])
  ) {
    missingAcknowledgements.push({
      kind: 'publicTunnel',
      flag: RUN_OPTION_FLAGS.ackPublicTunnel,
      envKey: RUN_ACK_ENV_KEYS.publicTunnel,
    });
  }

  if (
    allowRemote &&
    remoteExposureIssues.length > 0 &&
    !ackRemoteExposure &&
    !isTruthyEnvValue(env[RUN_ACK_ENV_KEYS.remoteExposure])
  ) {
    missingAcknowledgements.push({
      kind: 'remoteExposure',
      flag: RUN_OPTION_FLAGS.ackRemoteExposure,
      envKey: RUN_ACK_ENV_KEYS.remoteExposure,
    });
  }

  return missingAcknowledgements;
}

export function formatMissingAcknowledgementsMessage(missingAcknowledgements) {
  const labels = {
    publicTunnel: 'public tunnel mode',
    remoteExposure: 'remote exposure mode',
  };
  return missingAcknowledgements
    .map(
      ({ kind, flag, envKey }) =>
        `${labels[kind] || kind} requires acknowledgement via ${flag} or ${envKey}=1`
    )
    .join('; ');
}

export function buildSecurityPostureLines({
  dataMode = false,
  remoteExposureIssues = [],
  runtimeConfig,
  teamSharingGateway = false,
}) {
  const lines = [
    `frontend bind: ${formatBindAddress(runtimeConfig.web.bindHost, runtimeConfig.web.port)}`,
    `backend bind: ${formatBindAddress(runtimeConfig.api.bindHost, runtimeConfig.api.port)}`,
    `live teleop relay: ${runtimeConfig.teleop.enabled ? formatBindAddress(runtimeConfig.teleop.host, runtimeConfig.teleop.httpPort) : 'disabled'}`,
    `team sharing gate: ${teamSharingGateway ? 'remote frontend blocked until enabled' : 'disabled'}`,
  ];

  if (runtimeConfig.teleop.enabled) {
    lines.push(
      `teleop fast browser channel: ${formatBindAddress(runtimeConfig.teleop.host, runtimeConfig.teleop.webtransportPort)}`,
      `teleop native robot channel: ${formatBindAddress(runtimeConfig.teleop.host, runtimeConfig.teleop.nativeQuicPort)}`
    );
  }

  lines.push(
    `data mode: ${dataMode ? 'public tunnel enabled' : 'disabled'}`,
    `data tunnel scope: ${dataMode ? 'cam-to-sim session ingress only' : 'disabled'}`,
    `network exposure: ${remoteExposureIssues.length > 0 ? 'remote bind allowed' : 'loopback only'}`
  );
  return lines;
}

export function buildLoopbackApiBaseUrl(runtimeConfig) {
  return `http://${formatHostForUrl(runtimeConfig.api.bindHost)}:${runtimeConfig.api.port}`;
}

export function buildFrontendReadyUrl(runtimeConfig) {
  const readyHost = isRemoteBindHost(runtimeConfig.web.bindHost)
    ? '127.0.0.1'
    : runtimeConfig.web.bindHost;
  return `http://${formatHostForUrl(readyHost)}:${runtimeConfig.web.port}`;
}

export function getStartupSecurityViolations(
  {
    dataMode = false,
    remoteExposureIssues = [],
  } = {},
  {
    env = process.env,
  } = {}
) {
  const violations = [];
  const simulatorApiToken =
    typeof env.URDF_SIMULATOR_API_TOKEN === 'string' ? env.URDF_SIMULATOR_API_TOKEN.trim() : '';

  if (dataMode && remoteExposureIssues.length > 0) {
    violations.push(
      'Data mode cannot be combined with non-loopback binds. Keep binds local and use the tunnel as the only exposure path.'
    );
  }

  if (dataMode && !simulatorApiToken) {
    violations.push(
      'Data mode requires URDF_SIMULATOR_API_TOKEN so remote operator routes are not left unauthenticated.'
    );
  }

  return violations;
}

export function formatStartupSecurityViolationsMessage(violations) {
  return violations.join(' ');
}

export function applyRuntimeEnvOverrides(env, runtimeConfig) {
  const runtimeUrls = buildRuntimeUrls(runtimeConfig);
  const ikdApproachWsUrl = `ws://${formatHostForUrl(runtimeConfig.ikd.host)}:${runtimeConfig.ikd.port}/approach/ws`;
  return {
    ...env,
    URDF_WEB_HOST: runtimeConfig.web.host,
    URDF_WEB_PORT: String(runtimeConfig.web.port),
    URDF_WEB_BIND_HOST: runtimeConfig.web.bindHost,
    URDF_API_HOST: runtimeConfig.api.host,
    URDF_API_PORT: String(runtimeConfig.api.port),
    URDF_API_BIND_HOST: runtimeConfig.api.bindHost,
    URDF_IKD_HOST: runtimeConfig.ikd.host,
    URDF_IKD_PORT: String(runtimeConfig.ikd.port),
    URDF_TELEOP_HOST: runtimeConfig.teleop.host,
    URDF_TELEOP_HTTP_PORT: String(runtimeConfig.teleop.httpPort),
    URDF_TELEOP_WEBTRANSPORT_PORT: String(runtimeConfig.teleop.webtransportPort),
    URDF_TELEOP_NATIVE_QUIC_PORT: String(runtimeConfig.teleop.nativeQuicPort),
    VITE_API_BASE_URL: runtimeUrls.apiBaseUrl,
    VITE_IKD_BASE_URL: runtimeUrls.ikdBaseUrl,
    VITE_IKD_WS_URL: runtimeUrls.ikdWsUrl,
    VITE_IKD_APPROACH_WS_URL: ikdApproachWsUrl,
    VITE_TELEOP_HTTP_BASE_URL: runtimeUrls.teleopHttpBaseUrl,
  };
}

const PORT_RECOVERY_ATTEMPTS = 20;

function isPortRecoveryEligible(host, pinned, { allowRemoteBind = false } = {}) {
  return pinned !== true && (isLoopbackHost(host) || (allowRemoteBind && isRemoteBindHost(host)));
}

function checkPortAvailability(host, port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', (error) => {
      if (error && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(true);
      });
    });
  });
}

function checkUdpPortAvailability(host, port) {
  return new Promise((resolve, reject) => {
    const socketType = normalizeHost(host).includes(':') ? 'udp6' : 'udp4';
    const socket = dgram.createSocket(socketType);
    socket.unref();
    socket.on('error', (error) => {
      socket.close();
      if (error && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) {
        resolve(false);
        return;
      }
      reject(error);
    });
    socket.bind({ address: host, port, exclusive: true }, () => {
      socket.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(true);
      });
    });
  });
}

async function findNextAvailablePort(
  host,
  preferredPort,
  {
    maxAttempts = PORT_RECOVERY_ATTEMPTS,
    portAvailabilityChecker = checkPortAvailability,
  } = {}
) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidatePort = preferredPort + attempt;
    if (candidatePort > RUN_PORT_LIMITS.max) {
      break;
    }
    const available = await portAvailabilityChecker(host, candidatePort);
    if (available) {
      return candidatePort;
    }
  }
  return null;
}

function buildPortReservationKey(host, port) {
  return `${normalizeHost(host)}:${port}`;
}

async function findNextAvailableUnreservedPort(
  host,
  preferredPort,
  reservedPortKeys,
  {
    maxAttempts = PORT_RECOVERY_ATTEMPTS,
    portAvailabilityChecker = checkPortAvailability,
  } = {}
) {
  return findNextAvailablePort(host, preferredPort, {
    maxAttempts,
    portAvailabilityChecker: async (candidateHost, candidatePort) => {
      if (reservedPortKeys.has(buildPortReservationKey(candidateHost, candidatePort))) {
        return false;
      }
      return portAvailabilityChecker(candidateHost, candidatePort);
    },
  });
}

export async function recoverLoopbackPorts(
  runtimeConfig,
  {
    webPortPinned = false,
    apiPortPinned = false,
    ikdPortPinned = false,
    teleopHttpPortPinned = false,
    teleopWebTransportPortPinned = false,
    teleopNativeQuicPortPinned = false,
    portAvailabilityChecker = checkPortAvailability,
    udpPortAvailabilityChecker = checkUdpPortAvailability,
  } = {}
) {
  const nextConfig = {
    ...runtimeConfig,
    web: { ...runtimeConfig.web },
    api: { ...runtimeConfig.api },
    ikd: { ...runtimeConfig.ikd },
    teleop: { ...runtimeConfig.teleop },
  };
  const notices = [];
  const reservedTeleopUdpPortKeys = new Set();
  const reserveTeleopUdpPort = (port) => {
    reservedTeleopUdpPortKeys.add(buildPortReservationKey(nextConfig.teleop.host, port));
  };

  if (isPortRecoveryEligible(nextConfig.web.bindHost, webPortPinned, { allowRemoteBind: true })) {
    const resolvedPort = await findNextAvailablePort(nextConfig.web.bindHost, nextConfig.web.port, {
      portAvailabilityChecker,
    });
    if (resolvedPort !== null && resolvedPort !== nextConfig.web.port) {
      notices.push(
        `Frontend port ${nextConfig.web.port} was busy on ${formatHostForUrl(nextConfig.web.bindHost)}; using ${resolvedPort} instead.`
      );
      nextConfig.web.port = resolvedPort;
    }
  }

  if (isPortRecoveryEligible(nextConfig.api.bindHost, apiPortPinned)) {
    const resolvedPort = await findNextAvailablePort(nextConfig.api.bindHost, nextConfig.api.port, {
      portAvailabilityChecker,
    });
    if (resolvedPort !== null && resolvedPort !== nextConfig.api.port) {
      notices.push(
        `Backend API port ${nextConfig.api.port} was busy on ${formatHostForUrl(nextConfig.api.bindHost)}; using ${resolvedPort} instead.`
      );
      nextConfig.api.port = resolvedPort;
    }
  }

  if (
    nextConfig.ikd.enabled &&
    isPortRecoveryEligible(nextConfig.ikd.host, ikdPortPinned)
  ) {
    const resolvedPort = await findNextAvailablePort(nextConfig.ikd.host, nextConfig.ikd.port, {
      portAvailabilityChecker,
    });
    if (resolvedPort !== null && resolvedPort !== nextConfig.ikd.port) {
      notices.push(
        `IKD port ${nextConfig.ikd.port} was busy on ${formatHostForUrl(nextConfig.ikd.host)}; using ${resolvedPort} instead.`
      );
      nextConfig.ikd.port = resolvedPort;
    }
  }

  if (nextConfig.teleop.enabled && isPortRecoveryEligible(nextConfig.teleop.host, teleopHttpPortPinned)) {
    const httpPort = await findNextAvailablePort(nextConfig.teleop.host, nextConfig.teleop.httpPort, {
      portAvailabilityChecker,
    });
    if (httpPort !== null && httpPort !== nextConfig.teleop.httpPort) {
      notices.push(
        `Teleop HTTP port ${nextConfig.teleop.httpPort} was busy on ${formatHostForUrl(nextConfig.teleop.host)}; using ${httpPort} instead.`
      );
      nextConfig.teleop.httpPort = httpPort;
    }

  }

  if (
    nextConfig.teleop.enabled &&
    isPortRecoveryEligible(nextConfig.teleop.host, teleopWebTransportPortPinned)
  ) {
    const webTransportPort = await findNextAvailableUnreservedPort(
      nextConfig.teleop.host,
      nextConfig.teleop.webtransportPort,
      reservedTeleopUdpPortKeys,
      { portAvailabilityChecker: udpPortAvailabilityChecker }
    );
    if (webTransportPort !== null && webTransportPort !== nextConfig.teleop.webtransportPort) {
      notices.push(
        `Teleop WebTransport port ${nextConfig.teleop.webtransportPort} was unavailable on ${formatHostForUrl(nextConfig.teleop.host)}; using ${webTransportPort} instead.`
      );
      nextConfig.teleop.webtransportPort = webTransportPort;
    }
  }
  if (nextConfig.teleop.enabled) {
    reserveTeleopUdpPort(nextConfig.teleop.webtransportPort);
  }

  if (
    nextConfig.teleop.enabled &&
    isPortRecoveryEligible(nextConfig.teleop.host, teleopNativeQuicPortPinned)
  ) {
    const nativeQuicPort = await findNextAvailableUnreservedPort(
      nextConfig.teleop.host,
      nextConfig.teleop.nativeQuicPort,
      reservedTeleopUdpPortKeys,
      { portAvailabilityChecker: udpPortAvailabilityChecker }
    );
    if (nativeQuicPort !== null && nativeQuicPort !== nextConfig.teleop.nativeQuicPort) {
      notices.push(
        `Teleop native QUIC port ${nextConfig.teleop.nativeQuicPort} was unavailable on ${formatHostForUrl(nextConfig.teleop.host)}; using ${nativeQuicPort} instead.`
      );
      nextConfig.teleop.nativeQuicPort = nativeQuicPort;
    }
  }

  return {
    notices,
    runtimeConfig: nextConfig,
  };
}

export function formatBindAddress(host, port) {
  return `${formatHostForUrl(host)}:${port}`;
}

export function formatUnknownRunArgsMessage(unknownArgs) {
  return `Unknown start option(s): ${unknownArgs.join(', ')}. Use ${RUN_OPTION_FLAGS.help} for supported options.`;
}

export function buildRunHelpText() {
  return RUN_HELP_LINES.join('\n');
}

export { buildRuntimeUrls };
