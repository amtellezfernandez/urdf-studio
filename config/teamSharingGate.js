import {
  TEAM_SHARING_MAX_CONTROL_BODY_BYTES,
  TEAM_SHARING_REMOTE_DISABLED_MESSAGE,
  TEAM_SHARING_REMOTE_DISABLED_STATUS_CODE,
  TEAM_SHARING_STATUS_PATH,
} from "./teamSharingParams.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const IPV4_LOOPBACK_FIRST_OCTET = 127;
const IPV4_OCTET_COUNT = 4;
const IPV4_OCTET_MIN = 0;
const IPV4_OCTET_MAX = 255;
const HTTP_METHOD_GET = "GET";
const HTTP_METHOD_POST = "POST";
const HTTP_METHOD_OPTIONS = "OPTIONS";

const stripIpv6Brackets = (host) =>
  host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

const normalizeHost = (host) => {
  const trimmed = String(host || "").trim().toLowerCase();
  const withoutBrackets = stripIpv6Brackets(trimmed);
  return withoutBrackets.startsWith("::ffff:")
    ? withoutBrackets.slice("::ffff:".length)
    : withoutBrackets;
};

const parseIpv4Octets = (host) => {
  const parts = host.split(".");
  if (parts.length !== IPV4_OCTET_COUNT) return null;
  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) return Number.NaN;
    return Number(part);
  });
  return octets.every(
    (octet) =>
      Number.isInteger(octet) &&
      octet >= IPV4_OCTET_MIN &&
      octet <= IPV4_OCTET_MAX,
  )
    ? octets
    : null;
};

const isPrivateIpv4Address = (host) => {
  const ipv4 = parseIpv4Octets(normalizeHost(host));
  if (!ipv4) return false;
  const [a, b] = ipv4;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

const isLoopbackBindHost = (host) => LOOPBACK_HOSTS.has(normalizeHost(host));

export const isLoopbackRemoteAddress = (remoteAddress) => {
  const normalized = normalizeHost(remoteAddress);
  const ipv4 = parseIpv4Octets(normalized);
  return LOOPBACK_HOSTS.has(normalized) || Boolean(ipv4 && ipv4[0] === IPV4_LOOPBACK_FIRST_OCTET);
};

export const resolveTeamSharingRequestRemoteAddress = ({
  remoteAddress = "",
  webBindHost = "",
} = {}) => {
  const normalizedRemoteAddress = normalizeHost(remoteAddress);
  if (isLoopbackRemoteAddress(normalizedRemoteAddress)) {
    return "127.0.0.1";
  }
  if (isLoopbackBindHost(webBindHost) && isPrivateIpv4Address(normalizedRemoteAddress)) {
    return "127.0.0.1";
  }
  return normalizedRemoteAddress;
};

export const isTeamSharingControlPath = (requestUrl) => {
  const requestPath = String(requestUrl || "").split("?")[0];
  return requestPath === TEAM_SHARING_STATUS_PATH;
};

export const shouldBlockTeamSharingRequest = ({
  enabled = false,
  remoteAddress = "",
  requestUrl = "",
} = {}) =>
  !enabled &&
  !isLoopbackRemoteAddress(remoteAddress) &&
  !isTeamSharingControlPath(requestUrl);

const readRequestBody = (request) =>
  new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > TEAM_SHARING_MAX_CONTROL_BODY_BYTES) {
        reject(new Error("Team sharing request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });

const writeJson = (response, statusCode, payload) => {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
};

const writeText = (response, statusCode, message) => {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(message);
};

export const createTeamSharingState = ({
  enabled = false,
  localUrl = "",
  teamUrl = "",
} = {}) => ({
  enabled: Boolean(enabled),
  localUrl,
  teamUrl,
});

export const serializeTeamSharingState = (state) => ({
  available: true,
  enabled: Boolean(state.enabled),
  localUrl: state.localUrl || "",
  teamUrl: state.teamUrl || "",
});

export const handleTeamSharingControlRequest = async ({
  request,
  response,
  state,
}) => {
  const method = String(request.method || HTTP_METHOD_GET).toUpperCase();
  if (method === HTTP_METHOD_OPTIONS) {
    response.statusCode = 204;
    response.setHeader("Allow", `${HTTP_METHOD_GET}, ${HTTP_METHOD_POST}, ${HTTP_METHOD_OPTIONS}`);
    response.end();
    return;
  }

  if (!isLoopbackRemoteAddress(request.socket?.remoteAddress)) {
    writeText(response, 403, "Team sharing can only be changed from this computer.");
    return;
  }

  if (method === HTTP_METHOD_GET) {
    writeJson(response, 200, serializeTeamSharingState(state));
    return;
  }

  if (method !== HTTP_METHOD_POST) {
    response.setHeader("Allow", `${HTTP_METHOD_GET}, ${HTTP_METHOD_POST}, ${HTTP_METHOD_OPTIONS}`);
    writeText(response, 405, "Method not allowed.");
    return;
  }

  let parsedBody = null;
  try {
    const body = await readRequestBody(request);
    parsedBody = body.trim() ? JSON.parse(body) : {};
  } catch (error) {
    writeText(
      response,
      400,
      error instanceof Error ? error.message : "Invalid team sharing request.",
    );
    return;
  }

  state.enabled = Boolean(parsedBody?.enabled);
  writeJson(response, 200, serializeTeamSharingState(state));
};

export const writeTeamSharingBlockedResponse = (response) => {
  writeText(
    response,
    TEAM_SHARING_REMOTE_DISABLED_STATUS_CODE,
    TEAM_SHARING_REMOTE_DISABLED_MESSAGE,
  );
};
