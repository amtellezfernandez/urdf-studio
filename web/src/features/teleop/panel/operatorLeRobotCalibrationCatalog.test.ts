import { describe, expect, it } from "vitest";

import { buildOperatorLeRobotCalibrationOptions } from "@/features/teleop/panel/operatorLeRobotCalibrationCatalog";
import type { OperatorLeRobotCalibrationCatalogEntry } from "@/features/teleop/transport/operatorHelperApi";

const TEST_CALIBRATION_FIXTURE = {
  so100ActuatorCount: 6,
} as const;

const buildEntry = (
  entry: Partial<OperatorLeRobotCalibrationCatalogEntry> &
    Pick<
      OperatorLeRobotCalibrationCatalogEntry,
      "id" | "category" | "profileId" | "calibrationId"
    >,
): OperatorLeRobotCalibrationCatalogEntry => ({
  calibrationDir: `/calibrations/${entry.category}/${entry.profileId}`,
  groupId: "all",
  path: `/calibrations/${entry.category}/${entry.profileId}/${entry.calibrationId}.json`,
  jointNames: [],
  motorIds: [],
  zeroPositionsRad: {},
  actuatorCount: TEST_CALIBRATION_FIXTURE.so100ActuatorCount,
  ...entry,
});

describe("operatorLeRobotCalibrationCatalog", () => {
  it("keeps advanced calibration reuse behind the all toggle", () => {
    const entries = [
      buildEntry({
        id: "robots:so100_follower:so100-left-1:all",
        category: "robots",
        profileId: "so100_follower",
        calibrationId: "so100-left-1",
      }),
      buildEntry({
        id: "teleoperators:so100_leader:shared-arm:all",
        category: "teleoperators",
        profileId: "so100_leader",
        calibrationId: "shared-arm",
      }),
    ];

    const defaultOptions = buildOperatorLeRobotCalibrationOptions({
      entries,
      expectedActuatorCount: TEST_CALIBRATION_FIXTURE.so100ActuatorCount,
      expectedModelIds: ["so100"],
      expectedRobotIds: ["so100-left-1"],
      showAll: false,
    });
    const allOptions = buildOperatorLeRobotCalibrationOptions({
      entries,
      expectedActuatorCount: TEST_CALIBRATION_FIXTURE.so100ActuatorCount,
      expectedModelIds: ["so100"],
      expectedRobotIds: ["so100-left-1"],
      showAll: true,
    });

    expect(defaultOptions.map((option) => option.id)).toEqual([
      "robots:so100_follower:so100-left-1:all",
    ]);
    expect(allOptions.map((option) => option.compatibility)).toEqual([
      "recommended",
      "advanced",
    ]);
  });
});
