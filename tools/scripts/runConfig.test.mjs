import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyRuntimeEnvOverrides,
  applyTeamModeRuntimeProfile,
  applyTeamSharingGatewayRuntimeProfile,
  assertRemoteBindingsAllowed,
  buildSecurityPostureLines,
  buildFrontendReadyUrl,
  buildStartupOverviewLines,
  buildTeamModeGuideLines,
  buildLoopbackApiBaseUrl,
  buildTeamSharingWebBaseUrl,
  buildRuntimeUrls,
  formatMissingAcknowledgementsMessage,
  formatBindAddress,
  formatUnknownRunArgsMessage,
  getMissingSecurityAcknowledgements,
  isLoopbackHost,
  isRemoteBindHost,
  mergeRuntimeConfig,
  parseRunArgs,
  recoverLoopbackPorts,
  resolveLocalNetworkUrl,
  resolveTeamModeHost,
  shouldExposeIkdRuntime,
} from './runConfig.js';

const BASE_RUNTIME_CONFIG = {
  web: { host: '127.0.0.1', port: 5173, bindHost: '127.0.0.1' },
  api: { host: '127.0.0.1', port: 8000, bindHost: '127.0.0.1' },
  ikd: { enabled: true, host: '127.0.0.1', port: 8088, controlHz: 500, telemetryHz: 60, staleTargetMs: 250, useForDrag: true },
  ik: {},
};

test('parseRunArgs reads boolean and value flags', () => {
  const parsed = parseRunArgs([
    '--allow-remote',
    '--web-port',
    '3001',
    '--api-bind-host=0.0.0.0',
    '--ikd-host',
    '192.168.1.7',
  ]);

  assert.deepEqual(parsed, {
    ackRemoteExposure: false,
    allowRemote: true,
    allowOutdated: false,
    help: false,
    overrides: {
      web: { port: 3001 },
      api: { bindHost: '0.0.0.0' },
      ikd: { host: '192.168.1.7' },
    },
    teamHost: null,
    teamMode: false,
    unknownArgs: [],
  });
});

test('parseRunArgs reads team mode and host override', () => {
  const parsed = parseRunArgs(['--team', '--team-host=robot-lab.local']);

  assert.equal(parsed.teamMode, true);
  assert.equal(parsed.teamHost, 'robot-lab.local');
});

test('resolveTeamModeHost prefers explicit, env, then LAN interface', () => {
  assert.equal(
    resolveTeamModeHost({
      explicitHost: '  explicit.local  ',
      env: { URDF_STUDIO_TEAM_HOST: 'env.local' },
      networkInterfaces: () => ({ wlan0: [{ family: 'IPv4', internal: false, address: '192.168.1.40' }] }),
    }),
    'explicit.local'
  );
  assert.equal(
    resolveTeamModeHost({
      env: { URDF_STUDIO_TEAM_HOST: 'env.local' },
      networkInterfaces: () => ({ wlan0: [{ family: 'IPv4', internal: false, address: '192.168.1.40' }] }),
    }),
    'env.local'
  );
  assert.equal(
    resolveTeamModeHost({
      env: {},
      networkInterfaces: () => ({ wlan0: [{ family: 'IPv4', internal: false, address: '192.168.1.40' }] }),
    }),
    '192.168.1.40'
  );
  assert.equal(
    resolveTeamModeHost({
      env: {},
      networkInterfaces: () => ({
        docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
        eth0: [{ family: 'IPv4', internal: false, address: '172.22.210.70' }],
      }),
    }),
    '172.22.210.70'
  );
  assert.equal(
    resolveTeamModeHost({
      env: {},
      networkInterfaces: () => ({
        docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
      }),
    }),
    'localhost'
  );
});

test('resolveLocalNetworkUrl uses filtered LAN address only when frontend is exposed', () => {
  assert.equal(
    resolveLocalNetworkUrl(
      { ...BASE_RUNTIME_CONFIG, web: { host: 'localhost', port: 5173, bindHost: '0.0.0.0' } },
      {
        networkInterfaces: () => ({
          docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
          eth0: [{ family: 'IPv4', internal: false, address: '172.22.210.70' }],
        }),
      }
    ),
    'http://172.22.210.70:5173'
  );
  assert.equal(
    resolveLocalNetworkUrl(
      { ...BASE_RUNTIME_CONFIG, web: { host: 'localhost', port: 5173, bindHost: '127.0.0.1' } },
      {
        networkInterfaces: () => ({
          eth0: [{ family: 'IPv4', internal: false, address: '172.22.210.70' }],
        }),
      }
    ),
    null
  );
  assert.equal(
    resolveLocalNetworkUrl(
      { ...BASE_RUNTIME_CONFIG, web: { host: 'localhost', port: 5173, bindHost: '0.0.0.0' } },
      {
        networkInterfaces: () => ({
          docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
        }),
      }
    ),
    null
  );
});

test('applyTeamModeRuntimeProfile exposes only the frontend team profile service', () => {
  const profiled = applyTeamModeRuntimeProfile(BASE_RUNTIME_CONFIG, { publicHost: '192.168.1.40' });

  assert.equal(profiled.web.host, '192.168.1.40');
  assert.equal(profiled.web.bindHost, '0.0.0.0');
  assert.equal(profiled.api.host, '127.0.0.1');
  assert.equal(profiled.api.bindHost, '127.0.0.1');
});

test('applyTeamSharingGatewayRuntimeProfile exposes only a gated frontend', () => {
  const profiled = applyTeamSharingGatewayRuntimeProfile(BASE_RUNTIME_CONFIG);

  assert.equal(profiled.web.host, '127.0.0.1');
  assert.equal(profiled.web.bindHost, '0.0.0.0');
  assert.equal(profiled.api.host, '127.0.0.1');
  assert.equal(profiled.api.bindHost, '127.0.0.1');
});

test('buildTeamSharingWebBaseUrl formats the detected team host', () => {
  assert.equal(
    buildTeamSharingWebBaseUrl(BASE_RUNTIME_CONFIG, { publicHost: '192.168.1.40' }),
    'http://192.168.1.40:5173'
  );
});

test('buildTeamSharingWebBaseUrl only returns real network share links', () => {
  assert.equal(buildTeamSharingWebBaseUrl(BASE_RUNTIME_CONFIG), '');
  assert.equal(
    buildTeamSharingWebBaseUrl({
      ...BASE_RUNTIME_CONFIG,
      web: { host: '172.22.210.70', port: 5173, bindHost: '0.0.0.0' },
    }),
    'http://172.22.210.70:5173'
  );
  assert.equal(
    buildTeamSharingWebBaseUrl(
      {
        ...BASE_RUNTIME_CONFIG,
        web: { host: 'localhost', port: 5173, bindHost: '0.0.0.0' },
      },
      {
        networkInterfaces: () => ({
          docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
          eth0: [{ family: 'IPv4', internal: false, address: '172.22.210.70' }],
        }),
      }
    ),
    'http://172.22.210.70:5173'
  );
  assert.equal(
    buildTeamSharingWebBaseUrl(
      {
        ...BASE_RUNTIME_CONFIG,
        web: { host: 'localhost', port: 5173, bindHost: '0.0.0.0' },
      },
      {
        networkInterfaces: () => ({
          docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
        }),
      }
    ),
    ''
  );
});

test('shouldExposeIkdRuntime only exposes a reachable IKD runtime', () => {
  assert.equal(shouldExposeIkdRuntime({ shouldStartIkd: true, ikdManifestAvailable: true, cargoAvailable: true }), true);
  assert.equal(shouldExposeIkdRuntime({ shouldStartIkd: false, ikdManifestAvailable: true, cargoAvailable: true }), false);
  assert.equal(shouldExposeIkdRuntime({ shouldStartIkd: true, ikdManifestAvailable: false, cargoAvailable: true }), false);
  assert.equal(shouldExposeIkdRuntime({ shouldStartIkd: true, ikdManifestAvailable: true, cargoAvailable: false }), false);
});

test('startup overview gives in-session team-sharing local instructions', () => {
  const lines = buildStartupOverviewLines({
    runtimeConfig: applyTeamSharingGatewayRuntimeProfile(BASE_RUNTIME_CONFIG),
    runtimeUrls: buildRuntimeUrls(BASE_RUNTIME_CONFIG),
    teamSharingGateway: true,
  });

  assert.deepEqual(lines, [
    'Open URDF Studio: http://127.0.0.1:5173',
    'Access: local by default; remote browsers are blocked until Team sharing is on.',
    'Sharing: open Share to turn Wi-Fi/Tailnet invites on or off in this session.',
  ]);
});

test('startup overview hides raw network bind details in gated WSL local mode', () => {
  const runtimeConfig = applyTeamSharingGatewayRuntimeProfile(BASE_RUNTIME_CONFIG);
  const lines = buildStartupOverviewLines({
    localNetworkUrl: 'http://172.22.210.70:5173',
    remoteExposureIssues: [],
    runtimeConfig,
    runtimeUrls: buildRuntimeUrls(runtimeConfig),
    teamSharingGateway: true,
  });

  assert.deepEqual(lines, [
    'Open URDF Studio: http://127.0.0.1:5173',
    'Access: local by default; remote browsers are blocked until Team sharing is on.',
    'Sharing: open Share to turn Wi-Fi/Tailnet invites on or off in this session.',
  ]);
});

test('startup overview gives loopback-only local instructions by default', () => {
  const lines = buildStartupOverviewLines({
    runtimeConfig: BASE_RUNTIME_CONFIG,
    runtimeUrls: buildRuntimeUrls(BASE_RUNTIME_CONFIG),
  });

  assert.deepEqual(lines, [
    'Open URDF Studio: http://127.0.0.1:5173',
    'Access: only this laptop.',
    'Sharing: localhost links work only on this computer.',
  ]);
});

test('startup overview gives one stable LAN link when frontend is exposed', () => {
  const runtimeConfig = {
    ...BASE_RUNTIME_CONFIG,
    web: { host: '172.22.210.70', port: 5173, bindHost: '0.0.0.0' },
  };
  const lines = buildStartupOverviewLines({
    localNetworkUrl: 'http://172.22.210.70:5173',
    remoteExposureIssues: [{ service: 'frontend', host: '0.0.0.0', port: 5173 }],
    runtimeConfig,
    runtimeUrls: buildRuntimeUrls(runtimeConfig),
  });

  assert.deepEqual(lines, [
    'Open URDF Studio: http://127.0.0.1:5173',
    'Access: frontend is bound to the network; remote browsers are blocked until Team sharing is on.',
    'Sharing: turn on Share locally before sending the network link.',
    'Network link: http://172.22.210.70:5173',
  ]);
});

test('startup overview labels the detected LAN URL as direct access when host differs', () => {
  const runtimeConfig = {
    ...BASE_RUNTIME_CONFIG,
    web: { host: 'localhost', port: 5173, bindHost: '0.0.0.0' },
  };
  const lines = buildStartupOverviewLines({
    localNetworkUrl: 'http://192.168.1.44:5173',
    remoteExposureIssues: [{ service: 'frontend', host: '0.0.0.0', port: 5173 }],
    runtimeConfig,
    runtimeUrls: buildRuntimeUrls(runtimeConfig),
  });

  assert.deepEqual(lines, [
    'Open URDF Studio: http://127.0.0.1:5173',
    'Access: frontend is bound to the network; remote browsers are blocked until Team sharing is on.',
    'Sharing: turn on Share locally before sending the network link.',
    'Network link: http://192.168.1.44:5173',
  ]);
});

test('startup overview gives non-networking team instructions', () => {
  const teamRuntimeConfig = applyTeamModeRuntimeProfile(BASE_RUNTIME_CONFIG, {
    publicHost: '192.168.1.40',
  });
  const lines = buildStartupOverviewLines({
    runtimeConfig: teamRuntimeConfig,
    runtimeUrls: buildRuntimeUrls(teamRuntimeConfig),
    teamMode: true,
  });

  assert.deepEqual(lines, [
    'Team URL: http://192.168.1.40:5173',
    'Access: same Wi-Fi or Tailnet; editing is controlled by share links.',
    'Owner: open the Team URL, open Share, then send viewer/editor links.',
    'Controls: Share can lock editing or reset the editor link.',
  ]);
});

test('buildTeamModeGuideLines keeps advanced operator details out of the default path', () => {
  const lines = buildTeamModeGuideLines({
    hasSimulatorApiToken: false,
    runtimeUrls: buildRuntimeUrls(applyTeamModeRuntimeProfile(BASE_RUNTIME_CONFIG, { publicHost: '192.168.1.40' })),
  });

  assert.match(lines.join('\n'), /Team URL: http:\/\/192\.168\.1\.40:5173/);
  assert.match(lines.join('\n'), /open Share/);
  assert.match(lines.join('\n'), /Advanced: operator API is disabled/);
  assert.match(lines.join('\n'), /URDF_COLLABORATION_JOURNAL_PATH/);
});

test('parseRunArgs keeps unknown flags for explicit failure', () => {
  const parsed = parseRunArgs(['--wat']);
  assert.deepEqual(parsed.unknownArgs, ['--wat']);
});

test('parseRunArgs reads outdated-version bypass flag', () => {
  const parsed = parseRunArgs(['--allow-outdated']);
  assert.equal(parsed.allowOutdated, true);
});

test('parseRunArgs rejects invalid ports', () => {
  assert.throws(() => parseRunArgs(['--web-port', '70000']), /must be between/);
});

test('parseRunArgs reads acknowledgement flags', () => {
  const parsed = parseRunArgs(['--ack-remote-exposure']);
  assert.equal(parsed.ackRemoteExposure, true);
});

test('mergeRuntimeConfig applies scoped overrides', () => {
  const merged = mergeRuntimeConfig(BASE_RUNTIME_CONFIG, {
    web: { port: 3001 },
    api: { bindHost: '0.0.0.0' },
  });

  assert.equal(merged.web.port, 3001);
  assert.equal(merged.api.bindHost, '0.0.0.0');
  assert.equal(merged.ikd.port, BASE_RUNTIME_CONFIG.ikd.port);
});

test('remote bind guard rejects non-loopback exposure without opt-in', () => {
  const runtimeConfig = mergeRuntimeConfig(BASE_RUNTIME_CONFIG, {
    web: { bindHost: '0.0.0.0' },
  });

  assert.throws(
    () => assertRemoteBindingsAllowed(runtimeConfig, { allowRemote: false }),
    /Refusing remote bind/
  );
});

test('remote bind guard allows the gated frontend without remote opt-in', () => {
  const runtimeConfig = applyTeamSharingGatewayRuntimeProfile(BASE_RUNTIME_CONFIG);

  const issues = assertRemoteBindingsAllowed(runtimeConfig, { allowGatedFrontend: true });
  assert.deepEqual(issues, []);
});

test('remote bind guard allows non-loopback exposure with opt-in', () => {
  const runtimeConfig = mergeRuntimeConfig(BASE_RUNTIME_CONFIG, {
    api: { bindHost: '0.0.0.0' },
  });

  const issues = assertRemoteBindingsAllowed(runtimeConfig, { allowRemote: true });
  assert.deepEqual(issues, [{ service: 'backend API', host: '0.0.0.0', port: 8000 }]);
});

test('runtime env overrides propagate effective hosts and ports', () => {
  const env = applyRuntimeEnvOverrides({}, BASE_RUNTIME_CONFIG);
  assert.deepEqual(env, {
    URDF_WEB_HOST: '127.0.0.1',
    URDF_WEB_PORT: '5173',
    URDF_WEB_BIND_HOST: '127.0.0.1',
    URDF_API_HOST: '127.0.0.1',
    URDF_API_PORT: '8000',
    URDF_API_BIND_HOST: '127.0.0.1',
    URDF_IKD_HOST: '127.0.0.1',
    URDF_IKD_PORT: '8088',
    VITE_API_BASE_URL: 'http://127.0.0.1:8000',
    VITE_IKD_BASE_URL: 'http://127.0.0.1:8088',
    VITE_IKD_WS_URL: 'ws://127.0.0.1:8088/telemetry',
    VITE_IKD_APPROACH_WS_URL: 'ws://127.0.0.1:8088/approach/ws',
  });
});

test('recoverLoopbackPorts keeps configured ports when they are free', async () => {
  const result = await recoverLoopbackPorts(BASE_RUNTIME_CONFIG, {
    portAvailabilityChecker: async () => true,
  });

  assert.equal(result.runtimeConfig.web.port, BASE_RUNTIME_CONFIG.web.port);
  assert.equal(result.runtimeConfig.api.port, BASE_RUNTIME_CONFIG.api.port);
  assert.deepEqual(result.notices, []);
});

test('recoverLoopbackPorts shifts loopback ports when defaults are occupied', async () => {
  const webPort = 5173;
  const apiPort = 8000;
  const occupiedPorts = new Set([webPort, apiPort]);
  const result = await recoverLoopbackPorts(
    {
      ...BASE_RUNTIME_CONFIG,
      web: { ...BASE_RUNTIME_CONFIG.web, port: webPort },
      api: { ...BASE_RUNTIME_CONFIG.api, port: apiPort },
    },
    {
      portAvailabilityChecker: async (_host, port) => !occupiedPorts.has(port),
    }
  );

  assert.notEqual(result.runtimeConfig.web.port, webPort);
  assert.notEqual(result.runtimeConfig.api.port, apiPort);
  assert.equal(result.runtimeConfig.web.port, webPort + 1);
  assert.equal(result.runtimeConfig.api.port, apiPort + 1);
  assert.equal(result.notices.length, 2);
});

test('recoverLoopbackPorts shifts gated frontend network port when default is occupied', async () => {
  const webPort = 5173;
  const occupiedPorts = new Set([webPort]);
  const result = await recoverLoopbackPorts(
    applyTeamSharingGatewayRuntimeProfile({
      ...BASE_RUNTIME_CONFIG,
      web: { ...BASE_RUNTIME_CONFIG.web, port: webPort },
    }),
    {
      portAvailabilityChecker: async (_host, port) => !occupiedPorts.has(port),
    }
  );

  assert.equal(result.runtimeConfig.web.port, webPort + 1);
  assert.deepEqual(result.notices, [
    'Frontend port 5173 was busy on 0.0.0.0; using 5174 instead.',
  ]);
});

test('recoverLoopbackPorts leaves explicit pinned ports unchanged', async () => {
  const apiPort = 8000;
  const result = await recoverLoopbackPorts(
    {
      ...BASE_RUNTIME_CONFIG,
      api: { ...BASE_RUNTIME_CONFIG.api, port: apiPort },
    },
    {
      apiPortPinned: true,
      portAvailabilityChecker: async (_host, port) => port !== apiPort,
    }
  );

  assert.equal(result.runtimeConfig.api.port, apiPort);
  assert.deepEqual(result.notices, []);
});

test('runtime URL builder formats IPv6 hosts safely', () => {
  const urls = buildRuntimeUrls({
    ...BASE_RUNTIME_CONFIG,
    api: { host: '::1', port: 9000, bindHost: '::1' },
  });

  assert.equal(urls.apiBaseUrl, 'http://[::1]:9000');
});

test('frontend readiness URL uses loopback for remote frontend binds', () => {
  assert.equal(buildFrontendReadyUrl(BASE_RUNTIME_CONFIG), 'http://127.0.0.1:5173');
  assert.equal(
    buildFrontendReadyUrl({
      ...BASE_RUNTIME_CONFIG,
      web: { host: '172.22.210.70', port: 5173, bindHost: '0.0.0.0' },
    }),
    'http://127.0.0.1:5173'
  );
});

test('missing acknowledgement detection requires remote exposure opt-in', () => {
  const missing = getMissingSecurityAcknowledgements(
    {
      ackRemoteExposure: false,
      allowRemote: true,
    },
    {
      env: {},
      remoteExposureIssues: [{ service: 'frontend', host: '0.0.0.0', port: 5173 }],
    }
  );

  assert.deepEqual(missing, [
    {
      kind: 'remoteExposure',
      flag: '--ack-remote-exposure',
      envKey: 'URDF_STUDIO_ACK_REMOTE_EXPOSURE',
    },
  ]);
});

test('acknowledgement env vars satisfy missing acknowledgement checks', () => {
  const missing = getMissingSecurityAcknowledgements(
    {
      ackRemoteExposure: false,
      allowRemote: true,
    },
    {
      env: {
        URDF_STUDIO_ACK_REMOTE_EXPOSURE: 'yes',
      },
      remoteExposureIssues: [{ service: 'frontend', host: '0.0.0.0', port: 5173 }],
    }
  );

  assert.deepEqual(missing, []);
});

test('security posture lines summarize effective runtime exposure', () => {
  assert.deepEqual(
    buildSecurityPostureLines({
      remoteExposureIssues: [{ service: 'frontend', host: '0.0.0.0', port: 5173 }],
      runtimeConfig: BASE_RUNTIME_CONFIG,
    }),
    [
      'frontend bind: 127.0.0.1:5173',
      'backend bind: 127.0.0.1:8000',
      'team sharing gate: disabled',
      'network exposure: remote bind allowed',
    ]
  );
});

test('loopback API base URL uses bind host rather than public API host', () => {
  assert.equal(
    buildLoopbackApiBaseUrl({
      ...BASE_RUNTIME_CONFIG,
      api: { host: 'public.example.com', bindHost: '127.0.0.1', port: 9000 },
    }),
    'http://127.0.0.1:9000'
  );
});

test('helper formatting functions describe bind addresses and unknown args', () => {
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isRemoteBindHost('0.0.0.0'), true);
  assert.equal(formatBindAddress('::', 5173), '[::]:5173');
  assert.equal(
    formatUnknownRunArgsMessage(['--wat']),
    'Unknown start option(s): --wat. Use --help for supported options.'
  );
  assert.equal(
    formatMissingAcknowledgementsMessage([
      {
        kind: 'remoteExposure',
        flag: '--ack-remote-exposure',
        envKey: 'URDF_STUDIO_ACK_REMOTE_EXPOSURE',
      },
    ]),
    'remote exposure mode requires acknowledgement via --ack-remote-exposure or URDF_STUDIO_ACK_REMOTE_EXPOSURE=1'
  );
});
