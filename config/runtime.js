import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPrivateEnvFiles } from "./privateEnv.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const configPath = path.join(rootDir, "config", "app.config.json");

loadPrivateEnvFiles({ rootDir });

const readConfigFile = () => {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    return {};
  }
};

const getConfigValue = (config, pathParts, fallback) => {
  let current = config;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return fallback;
    }
    current = current[part];
  }
  return current ?? fallback;
};

const readNumber = (envKey, fallback) => {
  const raw = process.env[envKey];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readString = (envKey, fallback) => {
  const raw = process.env[envKey];
  return raw && raw.length > 0 ? raw : fallback;
};

const LOCAL_NETWORK_HOST_RESOLUTION = {
  autoHostAliases: ["auto", "lan", "local-network"],
  fallbackHost: "127.0.0.1",
};
const AUTO_WEB_HOST_VALUES = new Set(LOCAL_NETWORK_HOST_RESOLUTION.autoHostAliases);

export const formatHostForUrl = (host) => {
  const normalized = typeof host === "string" ? host.trim() : "";
  if (normalized.includes(":") && !normalized.startsWith("[") && !normalized.endsWith("]")) {
    return `[${normalized}]`;
  }
  return normalized;
};

const normalizeIpv4Address = (address) => {
  const normalized = typeof address === "string" && address.startsWith("::ffff:")
    ? address.slice(7)
    : address;
  const parts = typeof normalized === "string" ? normalized.split(".").map(Number) : [];
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return normalized;
};

const isRfc1918Ipv4Address = (address) => {
  const normalized = normalizeIpv4Address(address);
  if (!normalized) return false;
  const [a, b] = normalized.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

const isCarrierGradeNatIpv4Address = (address) => {
  const normalized = normalizeIpv4Address(address);
  if (!normalized) return false;
  const [a, b] = normalized.split(".").map(Number);
  return a === 100 && b >= 64 && b <= 127;
};

const isIgnoredNetworkInterfaceName = (name) =>
  /^(br-|bridge|docker|veth|virbr|vmnet|lo)/i.test(String(name || ""));

const localNetworkCandidateScore = (name, address) => {
  if (isIgnoredNetworkInterfaceName(name)) return null;
  if (isRfc1918Ipv4Address(address)) return 0;
  if (isCarrierGradeNatIpv4Address(address)) return 20;
  return 50;
};

export const resolveLocalNetworkHost = ({
  networkInterfaces = os.networkInterfaces,
} = {}) => {
  const candidates = [];
  const interfaces = networkInterfaces();
  let order = 0;
  for (const [name, detailsList] of Object.entries(interfaces)) {
    for (const details of detailsList || []) {
      order += 1;
      if (!details || details.internal || !details.address) {
        continue;
      }
      if (details.family !== "IPv4" && details.family !== 4) {
        continue;
      }
      const address = normalizeIpv4Address(details.address);
      if (!address) {
        continue;
      }
      const score = localNetworkCandidateScore(name, address);
      if (score === null) {
        continue;
      }
      candidates.push({
        address,
        order,
        score,
      });
    }
  }
  candidates.sort((left, right) => left.score - right.score || left.order - right.order);
  return candidates[0]?.address || LOCAL_NETWORK_HOST_RESOLUTION.fallbackHost;
};

export const resolveRuntimeHost = (
  host,
  { networkInterfaces = os.networkInterfaces } = {},
) => {
  const normalized = typeof host === "string" ? host.trim().toLowerCase() : "";
  if (AUTO_WEB_HOST_VALUES.has(normalized)) {
    return resolveLocalNetworkHost({ networkInterfaces });
  }
  return host;
};

const fileConfig = readConfigFile();

export const runtimeConfig = {
  web: {
    host: resolveRuntimeHost(
      readString("URDF_WEB_HOST", getConfigValue(fileConfig, ["web", "host"], "127.0.0.1"))
    ),
    port: readNumber("URDF_WEB_PORT", getConfigValue(fileConfig, ["web", "port"], 5173)),
    bindHost: readString("URDF_WEB_BIND_HOST", getConfigValue(fileConfig, ["web", "bindHost"], "127.0.0.1")),
  },
  api: {
    host: readString("URDF_API_HOST", getConfigValue(fileConfig, ["api", "host"], "127.0.0.1")),
    bindHost: readString(
      "URDF_API_BIND_HOST",
      getConfigValue(fileConfig, ["api", "bindHost"], getConfigValue(fileConfig, ["api", "host"], "127.0.0.1"))
    ),
    port: readNumber("URDF_API_PORT", getConfigValue(fileConfig, ["api", "port"], 8000)),
  },
  ikd: {
    enabled: readString("URDF_IKD_ENABLED", String(getConfigValue(fileConfig, ["ikd", "enabled"], false))).toLowerCase() === "true",
    host: readString("URDF_IKD_HOST", getConfigValue(fileConfig, ["ikd", "host"], "127.0.0.1")),
    port: readNumber("URDF_IKD_PORT", getConfigValue(fileConfig, ["ikd", "port"], 8088)),
    controlHz: readNumber("URDF_IKD_CONTROL_HZ", getConfigValue(fileConfig, ["ikd", "controlHz"], 500)),
    telemetryHz: readNumber("URDF_IKD_TELEMETRY_HZ", getConfigValue(fileConfig, ["ikd", "telemetryHz"], 60)),
    staleTargetMs: readNumber("URDF_IKD_STALE_TARGET_MS", getConfigValue(fileConfig, ["ikd", "staleTargetMs"], 250)),
    useForDrag: readString("URDF_IKD_USE_FOR_DRAG", String(getConfigValue(fileConfig, ["ikd", "useForDrag"], false))).toLowerCase() === "true",
  },
  teleop: {
    enabled: readString("URDF_TELEOP_ENABLED", String(getConfigValue(fileConfig, ["teleop", "enabled"], false))).toLowerCase() === "true",
    host: readString("URDF_TELEOP_HOST", getConfigValue(fileConfig, ["teleop", "host"], "127.0.0.1")),
    httpPort: readNumber("URDF_TELEOP_HTTP_PORT", getConfigValue(fileConfig, ["teleop", "httpPort"], 8091)),
  },
  ik: getConfigValue(fileConfig, ["ik"], {}),
};

export const buildRuntimeUrls = (config) => ({
  webBaseUrl: `http://${formatHostForUrl(config.web.host)}:${config.web.port}`,
  apiBaseUrl: `http://${formatHostForUrl(config.api.host)}:${config.api.port}`,
  ikdBaseUrl: `http://${formatHostForUrl(config.ikd.host)}:${config.ikd.port}`,
  ikdWsUrl: `ws://${formatHostForUrl(config.ikd.host)}:${config.ikd.port}/telemetry`,
  teleopHttpBaseUrl: `http://${formatHostForUrl(config.teleop.host)}:${config.teleop.httpPort}`,
});

export const runtimeUrls = buildRuntimeUrls(runtimeConfig);
