#!/usr/bin/env node

import process from "node:process";
import {
  urdfCore,
  urdfCoreBundleMeshAssetsNode,
  urdfCoreUrdfNode,
  urdfCoreXacroNode,
} from "../../tools/scripts/urdfCoreModules.js";
import fs from "node:fs";
import path from "node:path";

const {
  analyzeRobotMorphology,
  analyzeUrdf,
  convertURDFToMJCF,
  convertURDFToUSD,
} = urdfCore;
const {
  computeKinematicFingerprint,
  stripUrdfForKinematics,
} = urdfCoreUrdfNode;
const {
  expandXacroRequestPayload,
} = urdfCoreXacroNode;
const {
  bundleMeshAssetsForUrdfFile,
} = urdfCoreBundleMeshAssetsNode;

const readJsonStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }
  const raw = chunks.join("").trim();
  return raw ? JSON.parse(raw) : {};
};

const fail = (message, code = 2) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

const main = async () => {
  const command = process.argv[2];
  if (!command) {
    fail("Missing bridge command.");
  }

  const payload = await readJsonStdin();

  if (command === "fingerprint") {
    const urdfXml = String(payload.urdfXml || "");
    process.stdout.write(JSON.stringify(computeKinematicFingerprint(urdfXml)));
    return;
  }

  if (command === "analyze-morphology") {
    const urdfXml = String(payload.urdfXml || "");
    process.stdout.write(JSON.stringify(analyzeRobotMorphology(analyzeUrdf(urdfXml))));
    return;
  }

  if (command === "strip-kinematics-urdf") {
    const urdfXml = String(payload.urdfXml || "");
    process.stdout.write(JSON.stringify({ urdf: stripUrdfForKinematics(urdfXml) }));
    return;
  }

  if (command === "bundle-mesh-assets") {
    const urdfPath = String(payload.urdfPath || "").trim();
    const outPath = String(payload.outPath || "").trim();
    if (!urdfPath || !outPath) {
      fail("bundle-mesh-assets requires urdfPath and outPath.");
    }

    const result = bundleMeshAssetsForUrdfFile({
      urdfPath,
      urdfContent: String(payload.urdfXml || ""),
      outPath,
      extraSearchRoots: Array.isArray(payload.extraSearchRoots)
        ? payload.extraSearchRoots.map((value) => String(value || "").trim()).filter(Boolean)
        : [],
    });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result.content, "utf8");
    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (command === "convert-mjcf") {
    const urdfXml = String(payload.urdfXml || "");
    process.stdout.write(JSON.stringify(convertURDFToMJCF(urdfXml)));
    return;
  }

  if (command === "convert-usd") {
    const urdfXml = String(payload.urdfXml || "");
    process.stdout.write(JSON.stringify(convertURDFToUSD(urdfXml)));
    return;
  }

  if (command === "expand-xacro") {
    const requestPayload = {
      target_path: String(payload.target_path || ""),
      files: Array.isArray(payload.files) ? payload.files : [],
      args: payload.args && typeof payload.args === "object" ? payload.args : {},
      use_inorder: payload.use_inorder !== false,
    };
    const options = {};
    if (typeof payload.pythonExecutable === "string" && payload.pythonExecutable.trim()) {
      options.pythonExecutable = payload.pythonExecutable.trim();
    }
    if (typeof payload.wheelPath === "string" && payload.wheelPath.trim()) {
      options.wheelPath = payload.wheelPath.trim();
    }
    const result = await expandXacroRequestPayload(requestPayload, options);
    process.stdout.write(JSON.stringify(result));
    return;
  }

  fail(`Unsupported bridge command: ${command}`);
};

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error), 1);
});
