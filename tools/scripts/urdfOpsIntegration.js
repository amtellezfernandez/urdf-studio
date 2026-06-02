import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { formatHostForUrl } from '../../config/runtime.js';
import {
  URDF_OPS_API_PORT_ENV,
  URDF_OPS_BACKEND_URL_ENV,
  URDF_OPS_DEFAULT_API_PORT,
  URDF_OPS_DEFAULT_WEB_PORT,
  URDF_OPS_DIRNAME,
  URDF_OPS_HEALTH_PATH,
  URDF_OPS_ROOT_ENV,
  URDF_OPS_WEB_PORT_ENV,
  URDF_OPS_WEB_URL_ENV,
} from './urdfOpsParams.js';

function readPort(envKey, fallback, env = process.env) {
  const parsed = Number(env[envKey]);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

export function resolveUrdfOpsRoot(studioRootDir, env = process.env) {
  const configuredRoot = typeof env[URDF_OPS_ROOT_ENV] === 'string' ? env[URDF_OPS_ROOT_ENV].trim() : '';
  if (configuredRoot) {
    return resolve(configuredRoot);
  }
  return resolve(dirname(studioRootDir), URDF_OPS_DIRNAME);
}

export function buildUrdfOpsRuntime({
  studioRootDir,
  host = '127.0.0.1',
  env = process.env,
} = {}) {
  const root = resolveUrdfOpsRoot(studioRootDir, env);
  const webPort = readPort(URDF_OPS_WEB_PORT_ENV, URDF_OPS_DEFAULT_WEB_PORT, env);
  const apiPort = readPort(URDF_OPS_API_PORT_ENV, URDF_OPS_DEFAULT_API_PORT, env);
  const webBaseUrl =
    typeof env[URDF_OPS_WEB_URL_ENV] === 'string' && env[URDF_OPS_WEB_URL_ENV].trim()
      ? env[URDF_OPS_WEB_URL_ENV].trim().replace(/\/+$/, '')
      : `http://${formatHostForUrl(host)}:${webPort}`;
  const apiBaseUrl =
    typeof env[URDF_OPS_BACKEND_URL_ENV] === 'string' && env[URDF_OPS_BACKEND_URL_ENV].trim()
      ? env[URDF_OPS_BACKEND_URL_ENV].trim().replace(/\/+$/, '')
      : `http://${formatHostForUrl(host)}:${apiPort}`;

  return {
    root,
    webPort,
    apiPort,
    webBaseUrl,
    apiBaseUrl,
    healthUrl: `${apiBaseUrl}${URDF_OPS_HEALTH_PATH}`,
    packageJsonPath: resolve(root, 'package.json'),
    nodeModulesPath: resolve(root, 'node_modules'),
  };
}

export function isUrdfOpsCheckoutAvailable(opsRuntime) {
  return existsSync(opsRuntime.packageJsonPath);
}

export function applyUrdfOpsEnv(baseEnv, opsRuntime) {
  return {
    ...baseEnv,
    [URDF_OPS_ROOT_ENV]: opsRuntime.root,
    [URDF_OPS_WEB_URL_ENV]: opsRuntime.webBaseUrl,
    VITE_URDF_OPS_WEB_URL: opsRuntime.webBaseUrl,
    [URDF_OPS_WEB_PORT_ENV]: String(opsRuntime.webPort),
    [URDF_OPS_API_PORT_ENV]: String(opsRuntime.apiPort),
    [URDF_OPS_BACKEND_URL_ENV]: opsRuntime.apiBaseUrl,
    URDF_OPS_API_BASE_URL: opsRuntime.apiBaseUrl,
  };
}
