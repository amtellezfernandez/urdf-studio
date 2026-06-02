#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  urdfCore,
  urdfCoreLoadSourceNode,
  urdfCoreLocal,
} from "./urdfCoreModules.js";

const { loadSourceFromPath } = urdfCoreLoadSourceNode;
const { inspectLocalRepositoryUrdfs } = urdfCoreLocal;

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const urdf =
  "<robot name=\"smoke_robot\"><link name=\"base\"/><link name=\"tip\"/>" +
  "<joint name=\"j\" type=\"revolute\"><parent link=\"base\"/><child link=\"tip\"/>" +
  "<axis xyz=\"1 1 0\"/></joint><link name=\"mesh_link\"><visual><geometry>" +
  "<mesh filename=\"/abs/path/mesh.stl\"/></geometry></visual></link></robot>";

const validate = urdfCore.validateUrdf(urdf);
if (!validate.isValid) {
  throw new Error("ilu validate smoke test failed");
}

const axes = urdfCore.normalizeJointAxes(urdf);
if (!axes.urdfContent.includes("0.7071067812")) {
  throw new Error("ilu normalize-axes smoke test failed");
}

const meshes = urdfCore.fixMeshPaths(urdf);
if (!meshes.urdfContent.includes("package://smoke_robot_description")) {
  throw new Error("ilu fix-mesh-paths smoke test failed");
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ilu-smoke-"));
const repoRoot = path.join(tempRoot, "robot-repo");
const urdfDir = path.join(repoRoot, "urdf");

fs.mkdirSync(urdfDir, { recursive: true });
fs.writeFileSync(path.join(urdfDir, "robot.urdf"), urdf, "utf8");

const inspection = await inspectLocalRepositoryUrdfs({ path: repoRoot });
if (inspection.primaryCandidatePath !== "urdf/robot.urdf") {
  throw new Error("ilu inspect-repo smoke test failed");
}

const loaded = await loadSourceFromPath({ path: repoRoot, entryPath: "urdf/robot.urdf" });
if (loaded.entryPath !== "urdf/robot.urdf" || loaded.entryFormat !== "urdf") {
  throw new Error("ilu load-source smoke test failed");
}
if (loaded.urdf.trim() !== urdf) {
  throw new Error("ilu load-source returned unexpected URDF content");
}

fs.rmSync(tempRoot, { recursive: true, force: true });

console.log("ilu smoke test passed.");
