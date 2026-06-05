export const RUN_PORT_LIMITS = {
  min: 1,
  max: 65535,
};

export const CAM_TO_SIM_INGRESS_PROXY_BIND_HOST = '127.0.0.1';
export const CAM_TO_SIM_PROXY_MAX_JSON_BODY_BYTES = 128 * 1024;
export const CAM_TO_SIM_PROXY_MAX_FRAME_BODY_BYTES = 4_000_000;
export const CAM_TO_SIM_PROXY_MAX_TOKEN_QUERY_CHARS = 128;
export const CAM_TO_SIM_PROXY_MAX_METADATA_HEADER_CHARS = 8_192;
export const CAM_TO_SIM_PROXY_REQUEST_TIMEOUT_MS = 30_000;
export const CAM_TO_SIM_PROXY_HEADERS_TIMEOUT_MS = 10_000;
export const CAM_TO_SIM_PROXY_KEEP_ALIVE_TIMEOUT_MS = 5_000;
export const CAM_TO_SIM_PROXY_UPSTREAM_TIMEOUT_MS = 30_000;
export const CAM_TO_SIM_PROXY_TOKEN_HEADER = 'x-urdf-cam-to-sim-proxy-token';
export const CAM_TO_SIM_PROXY_FORWARD_HEADERS = [
  'accept',
  'content-type',
  'x-cam-to-sim-meta',
];
export const CAM_TO_SIM_PROXY_RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
export const CLOUD_FLARED_BINARY_ENV = 'URDF_CLOUDFLARED_BIN';
export const RUN_SHUTDOWN_GRACE_MS = 500;
export const RUN_STALE_PROCESS_CLEANUP_GRACE_MS = 250;
export const RUN_BACKEND_READY_TIMEOUT_MS = 30_000;
export const RUN_FRONTEND_READY_TIMEOUT_MS = 30_000;
export const RUN_READY_POLL_INTERVAL_MS = 250;
export const RUN_READY_REQUEST_TIMEOUT_MS = 1_000;
export const RUN_SKIP_STALE_PROCESS_CLEANUP_ENV = 'URDF_STUDIO_SKIP_STALE_CLEANUP';
export const RUN_TEAM_MODE_HOST_ENV = 'URDF_STUDIO_TEAM_HOST';
export const RUN_TEAM_MODE_BIND_HOST = '0.0.0.0';
export const RUN_TEAM_MODE_HOST_FALLBACK = 'localhost';
export const RUN_TEAM_MODE_NETWORK_FAMILY = 'IPv4';
export const RUN_TEAM_MODE_NETWORK_FAMILY_NUMBER = 4;
export const COLLABORATION_JOURNAL_PATH_ENV = 'URDF_COLLABORATION_JOURNAL_PATH';

export const RUN_OPTION_FLAGS = {
  help: '--help',
  helpShort: '-h',
  dataMode: '--data',
  teleopMode: '--teleop',
  teamMode: '--team',
  teamHost: '--team-host',
  robot: '--robot',
  robotEnvFile: '--robot-env-file',
  runtimeDemoMode: '--demo',
  allowRemote: '--allow-remote',
  allowOutdated: '--allow-outdated',
  ackRemoteExposure: '--ack-remote-exposure',
  ackPublicTunnel: '--ack-public-tunnel',
  webHost: '--web-host',
  webPort: '--web-port',
  webBindHost: '--web-bind-host',
  apiHost: '--api-host',
  apiPort: '--api-port',
  apiBindHost: '--api-bind-host',
  ikdHost: '--ikd-host',
  ikdPort: '--ikd-port',
  teleopHost: '--teleop-host',
  teleopHttpPort: '--teleop-http-port',
  teleopWebTransportPort: '--teleop-webtransport-port',
  teleopNativeQuicPort: '--teleop-native-quic-port',
};

export const RUN_LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export const RUN_ACK_ENV_KEYS = {
  remoteExposure: 'URDF_STUDIO_ACK_REMOTE_EXPOSURE',
  publicTunnel: 'URDF_STUDIO_ACK_PUBLIC_TUNNEL',
};

export const RUN_UPDATE_CHECK_ENV_KEYS = {
  allowOutdated: 'URDF_STUDIO_ALLOW_OUTDATED',
  skip: 'URDF_STUDIO_SKIP_UPDATE_CHECK',
};

export const RUN_UPDATE_CHECK_REMOTE_NAME = 'origin';
export const RUN_UPDATE_CHECK_DEFAULT_BRANCH = 'main';
export const RUN_UPDATE_CHECK_CACHE_FILE = '.urdf-studio-version-check.json';
export const RUN_UPDATE_CHECK_CACHE_VERSION = 1;
export const RUN_UPDATE_CHECK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const RUN_UPDATE_CHECK_TIMEOUT_MS = 5_000;
export const RUN_UPDATE_CHECK_API_BASE_URL = 'https://api.github.com';
export const RUN_UPDATE_CHECK_GIT_REMOTE_HEAD_REF = 'refs/remotes/origin/HEAD';

export const RUN_ACKNOWLEDGEMENT_TOKENS = {
  remoteExposure: 'REMOTE',
  publicTunnel: 'PUBLIC',
};

export const RUN_HELP_LINES = [
  'URDF Studio start options',
  '',
  'Most people only need:',
  '  npm run start          Start locally only',
  '  npm run team           Start with same-Wi-Fi/Tailnet sharing intentionally enabled',
  '',
  'Common options:',
  '  --team                 Guided same-Wi-Fi team session',
  '  --team-host <host>     Use this only if the Team URL points at the wrong Wi-Fi address',
  '  --robot <name>         Select .env.robots/<name>.env for this robot gateway process',
  '  --web-port <port>      Use another app port if the default is busy',
  '  --api-port <port>      Use another internal API port if the default is busy',
  '  --help, -h             Show this help',
  '',
  'Advanced options:',
  '  --robot-env-file <path> Select an explicit per-robot env file, e.g. .env.robots/so100-left-2.env',
  '  --teleop               Start the live teleop relay',
  '  --teleop-http-port <port> Override teleop relay status port',
  '  --teleop-webtransport-port <port> Override fast browser teleop port',
  '  --teleop-native-quic-port <port> Override native robot channel port',
  '  --teleop-host <host>   Override teleop relay host',
  '  --web-host <host>      Override frontend URL host',
  '  --api-host <host>      Override backend API URL host',
  '  --ikd-host <host>      Override native IKD bind host',
  '  --ikd-port <port>      Override native IKD port',
  '  --web-bind-host <host> Override frontend bind host',
  '  --api-bind-host <host> Override backend API bind host',
  '  --demo                 Enable runtime demo objects',
  '  --data                 Enable phone/tunnel data mode',
  '  --allow-remote         Allow non-loopback binds explicitly',
  '  --allow-outdated       Bypass the official latest-version gate once',
  '  --ack-remote-exposure  Acknowledge network exposure risk',
  '  --ack-public-tunnel    Acknowledge public phone-link tunnel risk',
  '',
  'Safety defaults:',
  '  Local start is private to the laptop.',
  '  Local start blocks remote browsers until the owner enables Team sharing from Share.',
  '  Team sharing auto-detects the Wi-Fi address and still uses share links for editing control.',
  '  Data mode only exposes camera/session upload and fails closed if the tunnel cannot start.',
  '  Start checks the official repo and refuses outdated checkouts by default.',
  '  Set URDF_STUDIO_VERBOSE=1 to print bind addresses and transport details.',
];
