#!/usr/bin/env node

import { readFileSync } from "fs";
import { readUnknownErrorMessage } from "./cliHelpers.js";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const COMMAND_VALIDATE = "validate";
const COMMAND_PUBLISH = "publish";
const COMMAND_LIST = "list";
const SUPPORTED_COMMANDS = [COMMAND_VALIDATE, COMMAND_PUBLISH, COMMAND_LIST];

const apiBaseUrl = process.env.URDF_WORLD_API_BASE_URL || DEFAULT_API_BASE_URL;

const fail = (message) => {
  console.error(`[wm-cli] ${message}`);
  process.exit(1);
};

const readManifest = (path) => {
  try {
    const text = readFileSync(path, "utf-8");
    return JSON.parse(text);
  } catch (error) {
    fail(`failed to read manifest at ${path}: ${readUnknownErrorMessage(error)}`);
  }
};

const requestJson = async (path, options = {}) => {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(`${response.status} ${response.statusText}: ${JSON.stringify(data)}`);
  }
  return data;
};

const postJson = async (path, payload) => requestJson(path, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify(payload),
});

const getJson = async (path) => {
  return requestJson(path, {
    headers: { Accept: "application/json" },
  });
};

const runValidate = async (manifestPath) => {
  if (!manifestPath) {
    fail("validate requires a manifest path");
  }
  const manifest = readManifest(manifestPath);
  const result = await postJson("/worlds/packages/validate", manifest);
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) {
    process.exit(2);
  }
};

const runPublish = async (manifestPath) => {
  if (!manifestPath) {
    fail("publish requires a manifest path");
  }
  const manifest = readManifest(manifestPath);
  const result = await postJson("/worlds/packages", manifest);
  console.log(JSON.stringify(result, null, 2));
};

const runList = async () => {
  const result = await getJson("/worlds/packages");
  console.log(JSON.stringify(result, null, 2));
};

const main = async () => {
  const command = process.argv[2];
  const manifestPath = process.argv[3];

  if (!command || !SUPPORTED_COMMANDS.includes(command)) {
    fail(`usage: world-package-cli.js <${SUPPORTED_COMMANDS.join("|")}> [manifest.json]`);
  }

  if (command === COMMAND_VALIDATE) {
    await runValidate(manifestPath);
    return;
  }
  if (command === COMMAND_PUBLISH) {
    await runPublish(manifestPath);
    return;
  }
  await runList();
};

main().catch((error) => fail(readUnknownErrorMessage(error)));
