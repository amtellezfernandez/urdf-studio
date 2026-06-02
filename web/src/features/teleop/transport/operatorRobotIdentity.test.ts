import { describe, expect, it } from "vitest";

import {
  normalizeOperatorRobotModelId,
  operatorRobotModelIdsMatch,
} from "@/features/teleop/transport/operatorRobotIdentity";

describe("operatorRobotIdentity", () => {
  it("normalizes display descriptors away from model ids", () => {
    expect(normalizeOperatorRobotModelId("So100 Follower robot gateway")).toBe(
      "so100",
    );
    expect(normalizeOperatorRobotModelId("Open Arm Bimanual")).toBe("openarm");
  });

  it("matches loaded model names against expected gateway model ids", () => {
    expect(operatorRobotModelIdsMatch("so100", "so100_follower")).toBe(true);
    expect(operatorRobotModelIdsMatch("OpenArm Bimanual", "openarm")).toBe(true);
    expect(operatorRobotModelIdsMatch("LeKiwi", ["so100", "LeKiwi"])).toBe(
      true,
    );
    expect(operatorRobotModelIdsMatch("so101", ["so100_follower", "so101"])).toBe(
      true,
    );
    expect(operatorRobotModelIdsMatch("LeKiwi", "so100")).toBe(false);
    expect(operatorRobotModelIdsMatch("openarm", "so100")).toBe(false);
  });
});
