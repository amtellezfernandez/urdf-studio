import fs from "node:fs";
import path from "node:path";
export {
  PRIVATE_ENV_FILENAMES,
  PRIVATE_ROBOT_ENV_DIRNAME,
  PRIVATE_ROBOT_ENV_FILE_ENV,
  PRIVATE_ROBOT_ENV_FILE_SUFFIX,
  PRIVATE_ROBOT_ENV_SELECTOR_ENV,
} from "./privateEnvParams.js";
import {
  PRIVATE_ENV_FILENAMES,
  PRIVATE_ROBOT_ENV_DIRNAME,
  PRIVATE_ROBOT_ENV_FILE_ENV,
  PRIVATE_ROBOT_ENV_FILE_SUFFIX,
  PRIVATE_ROBOT_ENV_SELECTOR_ENV,
} from "./privateEnvParams.js";

const PRIVATE_ENV_PARSE_PARAMS = Object.freeze({
  minQuotedValueLength: 2,
  firstCharacterIndex: 0,
  nextCharacterOffset: 1,
  firstContentIndex: 1,
});

const ENV_ASSIGNMENT_PATTERN = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const loadedRobotEnvOverlayKeysByEnv = new WeakMap();

const stripInlineComment = (value) => {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < value.length; index += PRIVATE_ENV_PARSE_PARAMS.nextCharacterOffset) {
    const char = value[index];
    const previous = value[index - PRIVATE_ENV_PARSE_PARAMS.nextCharacterOffset];
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote && previous !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char === "#" && !inSingleQuote && !inDoubleQuote) {
      const before = value[index - PRIVATE_ENV_PARSE_PARAMS.nextCharacterOffset];
      if (index === PRIVATE_ENV_PARSE_PARAMS.firstCharacterIndex || /\s/.test(before)) {
        return value.slice(PRIVATE_ENV_PARSE_PARAMS.firstCharacterIndex, index).trimEnd();
      }
    }
  }
  return value.trimEnd();
};

const unquoteEnvValue = (value) => {
  const trimmed = stripInlineComment(value.trim());
  if (trimmed.length < PRIVATE_ENV_PARSE_PARAMS.minQuotedValueLength) return trimmed;
  const quote = trimmed[PRIVATE_ENV_PARSE_PARAMS.firstCharacterIndex];
  if (
    (quote !== '"' && quote !== "'") ||
    trimmed[trimmed.length - PRIVATE_ENV_PARSE_PARAMS.nextCharacterOffset] !== quote
  ) {
    return trimmed;
  }
  const inner = trimmed.slice(
    PRIVATE_ENV_PARSE_PARAMS.firstContentIndex,
    -PRIVATE_ENV_PARSE_PARAMS.firstContentIndex,
  );
  return quote === '"'
    ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    : inner;
};

export function parsePrivateEnv(content) {
  const values = {};
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = ENV_ASSIGNMENT_PATTERN.exec(line);
    if (!match) continue;
    values[match[1]] = unquoteEnvValue(match[2]);
  }
  return values;
}

const normalizePrivateEnvRelativePath = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || path.isAbsolute(trimmed)) return null;
  const normalized = path.normalize(trimmed);
  if (normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
};

const normalizeRobotEnvName = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (trimmed === "." || trimmed === "..") return null;
  return trimmed;
};

const resolveRobotEnvOverlayFilenames = (env) => {
  const filenames = [];
  const explicitFile = normalizePrivateEnvRelativePath(env[PRIVATE_ROBOT_ENV_FILE_ENV]);
  if (explicitFile) {
    filenames.push(explicitFile);
    return filenames;
  }

  const selectedRobot = normalizeRobotEnvName(env[PRIVATE_ROBOT_ENV_SELECTOR_ENV]);
  if (selectedRobot) {
    const selectedFile = normalizePrivateEnvRelativePath(
      path.join(
        PRIVATE_ROBOT_ENV_DIRNAME,
        selectedRobot.endsWith(PRIVATE_ROBOT_ENV_FILE_SUFFIX)
          ? selectedRobot
          : `${selectedRobot}${PRIVATE_ROBOT_ENV_FILE_SUFFIX}`,
      ),
    );
    if (selectedFile) {
      filenames.push(selectedFile);
    }
  }

  return Array.from(new Set(filenames));
};

const isObjectLike = (value) =>
  (typeof value === "object" || typeof value === "function") && value !== null;

const rememberRobotEnvOverlayKeys = (env, keys) => {
  if (keys.size === 0 || !isObjectLike(env)) {
    return;
  }
  const previousKeys = loadedRobotEnvOverlayKeysByEnv.get(env) ?? new Set();
  for (const key of keys) {
    previousKeys.add(key);
  }
  loadedRobotEnvOverlayKeysByEnv.set(env, previousKeys);
};

export function clearLoadedRobotEnvOverlayValues(env = process.env, { sourceEnv = env } = {}) {
  const loadedKeys = loadedRobotEnvOverlayKeysByEnv.get(sourceEnv);
  if (!loadedKeys) {
    return env;
  }
  for (const key of loadedKeys) {
    delete env[key];
  }
  return env;
}

export function loadPrivateEnvFiles({
  rootDir,
  env = process.env,
  filenames = PRIVATE_ENV_FILENAMES,
  readFile = fs.readFileSync,
  fileExists = fs.existsSync,
} = {}) {
  if (!rootDir) {
    throw new Error("rootDir is required to load private env files.");
  }
  const protectedKeys = new Set(Object.keys(env));
  const loadedFiles = [];
  const loadedFileKeys = new Set();
  const loadEnvFile = (filename, { robotOverlay = false } = {}) => {
    const envPath = path.resolve(rootDir, filename);
    if (loadedFileKeys.has(envPath)) return;
    if (!fileExists(envPath)) return;
    const parsed = parsePrivateEnv(readFile(envPath, "utf8"));
    const assignedKeys = new Set();
    loadedFiles.push(envPath);
    loadedFileKeys.add(envPath);
    for (const [key, value] of Object.entries(parsed)) {
      if (protectedKeys.has(key)) continue;
      env[key] = value;
      assignedKeys.add(key);
    }
    if (robotOverlay) {
      rememberRobotEnvOverlayKeys(env, assignedKeys);
    }
  };

  for (const filename of filenames) {
    loadEnvFile(filename);
  }
  for (const filename of resolveRobotEnvOverlayFilenames(env)) {
    loadEnvFile(filename, { robotOverlay: true });
  }
  return loadedFiles;
}
