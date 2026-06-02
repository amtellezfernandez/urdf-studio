#!/usr/bin/env node
import fs from "node:fs";
import { stripUrdfForKinematics } from "i-love-urdf/urdf-node";

const [, , inputPath] = process.argv;

if (!inputPath) {
  console.error("Usage: node tools/scripts/so100-sysid-strip-urdf.mjs <urdf-path>");
  process.exitCode = 2;
} else {
  const urdfXml = fs.readFileSync(inputPath, "utf8");
  process.stdout.write(stripUrdfForKinematics(urdfXml));
}
