import { execFileSync } from 'child_process';

import { formatHostForUrl, resolveLocalNetworkHost } from '../../config/runtime.js';
import { isWslEnvironment } from '../../config/wslOwnerProxy.js';

const WSL_WINDOWS_LOCALHOST_RELAY_PARAMS = {
  listenHost: '127.0.0.1',
  httpTimeoutSec: 4,
  commandTimeoutMs: 8_000,
  startTimeoutMs: 10_000,
  staleProcessName: 'wslrelay',
  loopbackHosts: new Set(['127.0.0.1', 'localhost', '::1']),
};

const normalizeHost = (host) => {
  const normalized = String(host || '').trim().toLowerCase();
  return normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized;
};

const isLoopbackHost = (host) =>
  WSL_WINDOWS_LOCALHOST_RELAY_PARAMS.loopbackHosts.has(normalizeHost(host));

const isRemoteBindHost = (host) => {
  const normalized = normalizeHost(host);
  return Boolean(normalized) && !isLoopbackHost(normalized);
};

const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const runPowerShell = (
  command,
  {
    execFileSyncImpl = execFileSync,
    timeoutMs = WSL_WINDOWS_LOCALHOST_RELAY_PARAMS.commandTimeoutMs,
  } = {},
) =>
  execFileSyncImpl('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });

const windowsCanFetchUrl = (url, { execFileSyncImpl = execFileSync } = {}) => {
  const command = [
    "$ProgressPreference = 'SilentlyContinue'",
    'try {',
    `  $response = Invoke-WebRequest -UseBasicParsing -Uri ${psQuote(url)} -TimeoutSec ${WSL_WINDOWS_LOCALHOST_RELAY_PARAMS.httpTimeoutSec}`,
    '  if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { exit 0 }',
    '  exit 1',
    '} catch {',
    '  exit 1',
    '}',
  ].join('; ');
  try {
    runPowerShell(command, { execFileSyncImpl });
    return true;
  } catch {
    return false;
  }
};

const stopStaleWslRelayListeners = (
  port,
  { execFileSyncImpl = execFileSync } = {},
) => {
  const command = [
    '$ErrorActionPreference = "SilentlyContinue"',
    `$listeners = Get-NetTCPConnection -LocalAddress ${psQuote(WSL_WINDOWS_LOCALHOST_RELAY_PARAMS.listenHost)} -LocalPort ${Number(port)} -State Listen`,
    '$killed = @()',
    'foreach ($listener in $listeners) {',
    '  $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue',
    `  if ($process -and $process.ProcessName -eq ${psQuote(WSL_WINDOWS_LOCALHOST_RELAY_PARAMS.staleProcessName)}) {`,
    '    Stop-Process -Id $process.Id -Force',
    '    $killed += $process.Id',
    '  }',
    '}',
    '$killed -join ","',
  ].join('; ');
  try {
    return runPowerShell(command, { execFileSyncImpl })
      .trim()
      .split(',')
      .map((pid) => Number(pid))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
};

const isWindowsLocalPortFree = (
  port,
  { execFileSyncImpl = execFileSync } = {},
) => {
  const command = [
    '$ErrorActionPreference = "SilentlyContinue"',
    `$listeners = Get-NetTCPConnection -LocalAddress ${psQuote(WSL_WINDOWS_LOCALHOST_RELAY_PARAMS.listenHost)} -LocalPort ${Number(port)} -State Listen`,
    'if ($listeners) { exit 1 }',
    'exit 0',
  ].join('; ');
  try {
    runPowerShell(command, { execFileSyncImpl });
    return true;
  } catch {
    return false;
  }
};

export const buildWslWindowsLocalhostRelayScript = ({
  listenHost = WSL_WINDOWS_LOCALHOST_RELAY_PARAMS.listenHost,
  listenPort,
  targetHost,
  targetPort,
}) => `
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Net;
using System.Net.Sockets;
using System.Threading.Tasks;

public static class UrdfStudioLocalhostRelay
{
    public static void Run(string listenHost, int listenPort, string targetHost, int targetPort)
    {
        var listener = new TcpListener(IPAddress.Parse(listenHost), listenPort);
        listener.Server.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
        listener.Start();
        Console.WriteLine(string.Format("URDF Studio localhost relay listening on {0}:{1} -> {2}:{3}", listenHost, listenPort, targetHost, targetPort));
        while (true)
        {
            var client = listener.AcceptTcpClient();
            Task.Run(async delegate
            {
                TcpClient server = null;
                try
                {
                    server = new TcpClient();
                    await server.ConnectAsync(targetHost, targetPort).ConfigureAwait(false);
                    using (client)
                    using (server)
                    {
                        var clientStream = client.GetStream();
                        var serverStream = server.GetStream();
                        var upstream = clientStream.CopyToAsync(serverStream);
                        var downstream = serverStream.CopyToAsync(clientStream);
                        await Task.WhenAny(upstream, downstream).ConfigureAwait(false);
                    }
                }
                catch
                {
                    try { client.Close(); } catch { }
                    try { if (server != null) server.Close(); } catch { }
                }
            });
        }
    }
}
'@
Add-Type -TypeDefinition $source -Language CSharp
[UrdfStudioLocalhostRelay]::Run(${psQuote(listenHost)}, ${Number(listenPort)}, ${psQuote(targetHost)}, ${Number(targetPort)})
`;

export const parseWindowsProcessId = (output) => {
  const match = String(output || '').match(/\b(\d+)\b/);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
};

const startWindowsLocalhostRelay = (
  {
    listenPort,
    targetHost,
    targetPort = listenPort,
  },
  { execFileSyncImpl = execFileSync } = {},
) => {
  const relayScript = buildWslWindowsLocalhostRelayScript({
    listenPort,
    targetHost,
    targetPort,
  });
  const encodedRelayScript = Buffer.from(relayScript, 'utf16le').toString('base64');
  const command = [
    '$ErrorActionPreference = "Stop"',
    `$process = Start-Process -FilePath powershell -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-EncodedCommand',${psQuote(encodedRelayScript)})`,
    '$process.Id',
  ].join('; ');
  const output = runPowerShell(command, {
    execFileSyncImpl,
    timeoutMs: WSL_WINDOWS_LOCALHOST_RELAY_PARAMS.startTimeoutMs,
  });
  return parseWindowsProcessId(output);
};

export const stopWslWindowsLocalhostRelay = (
  relay,
  { execFileSyncImpl = execFileSync } = {},
) => {
  const pid = typeof relay === 'number' ? relay : relay?.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    runPowerShell(`Stop-Process -Id ${pid} -Force`, { execFileSyncImpl });
    return true;
  } catch {
    return false;
  }
};

export const resolveWslWindowsLocalhostRelayTargetHost = (
  {
    runtimeConfig,
    networkInterfaces,
  } = {},
) => {
  const configuredHost = normalizeHost(runtimeConfig?.web?.host);
  if (
    isRemoteBindHost(runtimeConfig?.web?.bindHost) &&
    (!configuredHost || isLoopbackHost(configuredHost))
  ) {
    return resolveLocalNetworkHost({ networkInterfaces });
  }
  return configuredHost;
};

export const ensureWslWindowsLocalhostAccess = (
  {
    runtimeConfig,
    targetHost = null,
    networkInterfaces,
    isWslEnvironmentImpl = isWslEnvironment,
    windowsCanFetchUrlImpl = windowsCanFetchUrl,
    stopStaleWslRelayListenersImpl = stopStaleWslRelayListeners,
    isWindowsLocalPortFreeImpl = isWindowsLocalPortFree,
    startWindowsLocalhostRelayImpl = startWindowsLocalhostRelay,
    stopWslWindowsLocalhostRelayImpl = stopWslWindowsLocalhostRelay,
  } = {},
) => {
  const port = Number(runtimeConfig?.web?.port);
  const bindHost = runtimeConfig?.web?.bindHost;
  const normalizedTargetHost = normalizeHost(
    targetHost ??
      resolveWslWindowsLocalhostRelayTargetHost({
        runtimeConfig,
        networkInterfaces,
      }),
  );
  const localUrl = `http://${WSL_WINDOWS_LOCALHOST_RELAY_PARAMS.listenHost}:${port}`;
  const targetUrl = `http://${formatHostForUrl(normalizedTargetHost)}:${port}`;

  if (!isWslEnvironmentImpl()) {
    return { status: 'not-wsl' };
  }
  if (!Number.isInteger(port) || port <= 0) {
    return { status: 'invalid-port' };
  }
  if (!isRemoteBindHost(bindHost)) {
    return { status: 'skipped-loopback-bind', localUrl };
  }
  if (!normalizedTargetHost || isLoopbackHost(normalizedTargetHost)) {
    return { status: 'missing-target-host', localUrl };
  }
  if (windowsCanFetchUrlImpl(localUrl)) {
    return { status: 'already-working', localUrl };
  }
  if (!windowsCanFetchUrlImpl(targetUrl)) {
    return { status: 'target-unreachable', localUrl, targetUrl };
  }

  const killedStaleRelayPids = stopStaleWslRelayListenersImpl(port);
  if (killedStaleRelayPids.length > 0 && windowsCanFetchUrlImpl(localUrl)) {
    return {
      status: 'recovered-after-stale-relay-stop',
      killedStaleRelayPids,
      localUrl,
      targetUrl,
    };
  }
  if (!isWindowsLocalPortFreeImpl(port)) {
    return {
      status: 'blocked-by-windows-listener',
      killedStaleRelayPids,
      localUrl,
      targetUrl,
    };
  }

  const relayPid = startWindowsLocalhostRelayImpl({
    listenPort: port,
    targetHost: normalizedTargetHost,
    targetPort: port,
  });
  if (!relayPid) {
    return {
      status: 'relay-start-failed',
      killedStaleRelayPids,
      localUrl,
      targetUrl,
    };
  }
  if (!windowsCanFetchUrlImpl(localUrl)) {
    stopWslWindowsLocalhostRelayImpl({ pid: relayPid });
    return {
      status: 'relay-unreachable',
      killedStaleRelayPids,
      localUrl,
      targetUrl,
    };
  }

  return {
    status: 'relay-started',
    killedStaleRelayPids,
    localUrl,
    targetUrl,
    pid: relayPid,
  };
};
