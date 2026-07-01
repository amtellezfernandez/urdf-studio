import assert from "node:assert/strict";
import test from "node:test";

import { buildSetupSummarySections, isTruthyEnvValue } from "./setupHelpers.js";

test("truthy setup env values are explicit", () => {
  assert.equal(isTruthyEnvValue("1"), true);
  assert.equal(isTruthyEnvValue("yes"), true);
  assert.equal(isTruthyEnvValue("false"), false);
  assert.equal(isTruthyEnvValue(""), false);
});

test("setup summary stays on clean release surface", () => {
  const text = buildSetupSummarySections({ pythonEnvDir: ".venv" })
    .flatMap((section) => [section.heading, ...section.lines])
    .join("\n");

  assert.match(text, /Simulator Transfer/);
  assert.doesNotMatch(text, /teleop|OpenArm|LeRobot|dataset|MJLab/i);
});
