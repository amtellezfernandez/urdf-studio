import { describe, expect, it } from "vitest";

import {
  shouldPrepareLeKiwiDemoScene,
  shouldPreserveScenarioWorldLayoutOnDemoMotion,
} from "@/app/pages/index/demoMotionPolicy";

describe("shouldPrepareLeKiwiDemoScene", () => {
  it("prepares the scene when the loaded robot is LeKiwi", () => {
    expect(shouldPrepareLeKiwiDemoScene(true)).toBe(true);
  });

  it("skips scene preparation for non-LeKiwi robots", () => {
    expect(shouldPrepareLeKiwiDemoScene(false)).toBe(false);
  });
});

describe("shouldPreserveScenarioWorldLayoutOnDemoMotion", () => {
  it("preserves scenario ownership while loading bundled demo assets", () => {
    expect(
      shouldPreserveScenarioWorldLayoutOnDemoMotion({
        hasLoadedFiles: false,
        isLeKiwiDemoRobot: false,
      })
    ).toBe(true);
  });

  it("preserves scenario ownership for loaded LeKiwi demo robot", () => {
    expect(
      shouldPreserveScenarioWorldLayoutOnDemoMotion({
        hasLoadedFiles: true,
        isLeKiwiDemoRobot: true,
      })
    ).toBe(true);
  });

  it("does not suppress default world layout for non-LeKiwi loaded robots", () => {
    expect(
      shouldPreserveScenarioWorldLayoutOnDemoMotion({
        hasLoadedFiles: true,
        isLeKiwiDemoRobot: false,
      })
    ).toBe(false);
  });
});
