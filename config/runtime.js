import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const configPath = path.join(rootDir, "config", "app.config.json");

const readConfigFile = () => {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
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

export const formatHostForUrl = (host) => {
  const normalized = typeof host === "string" ? host.trim() : "";
  if (normalized.includes(":") && !normalized.startsWith("[") && !normalized.endsWith("]")) {
    return `[${normalized}]`;
  }
  return normalized;
};

const fileConfig = readConfigFile();

export const runtimeConfig = {
  web: {
    host: readString("URDF_WEB_HOST", getConfigValue(fileConfig, ["web", "host"], "127.0.0.1")),
    port: readNumber("URDF_WEB_PORT", getConfigValue(fileConfig, ["web", "port"], 5173)),
    bindHost: readString(
      "URDF_WEB_BIND_HOST",
      getConfigValue(fileConfig, ["web", "bindHost"], "127.0.0.1"),
    ),
  },
  api: {
    host: readString("URDF_API_HOST", getConfigValue(fileConfig, ["api", "host"], "127.0.0.1")),
    bindHost: readString(
      "URDF_API_BIND_HOST",
      getConfigValue(
        fileConfig,
        ["api", "bindHost"],
        getConfigValue(fileConfig, ["api", "host"], "127.0.0.1"),
      ),
    ),
    port: readNumber("URDF_API_PORT", getConfigValue(fileConfig, ["api", "port"], 8000)),
  },
};

export const buildRuntimeUrls = (config) => ({
  webBaseUrl: `http://${formatHostForUrl(config.web.host)}:${config.web.port}`,
  apiBaseUrl: `http://${formatHostForUrl(config.api.host)}:${config.api.port}`,
});

export const runtimeUrls = buildRuntimeUrls(runtimeConfig);
