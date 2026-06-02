import { describe, expect, it } from "vitest";

import {
  updateCalibrationFileEditMotorRowsFromSyncResult,
  type OperatorCalibrationFileEditMotorRow,
} from "@/features/teleop/panel/useOperatorCalibrationFileEdit";
import type { OperatorLeRobotCalibrationFileSyncResult } from "@/features/teleop/transport/operatorHelperApi";

const SYNC_RESULT_MTIME_NS = 42;
const SHOULDER_MOTOR_ID = 3;
const ELBOW_MOTOR_ID = 5;
const WRIST_MOTOR_ID = 1;

const buildSyncResult = ({
  jointNames,
  motorIds,
}: {
  jointNames: string[];
  motorIds: number[];
}): OperatorLeRobotCalibrationFileSyncResult => ({
  path: "/calibrations/robots/so100_follower/arm.json",
  exists: true,
  mtimeNs: SYNC_RESULT_MTIME_NS,
  jointNames,
  motorIds,
  zeroPositionsRad: {},
  changed: true,
  applied: true,
  message: "Reloaded selected calibration.",
});

describe("useOperatorCalibrationFileEdit", () => {
  it("updates read-only motor rows from calibration sync mapping", () => {
    const currentMotorRows: OperatorCalibrationFileEditMotorRow[] = [
      { jointName: "wrist_roll", motorId: ELBOW_MOTOR_ID },
      { jointName: "elbow_flex", motorId: SHOULDER_MOTOR_ID },
      { jointName: "shoulder_pan", motorId: WRIST_MOTOR_ID },
    ];

    expect(
      updateCalibrationFileEditMotorRowsFromSyncResult({
        currentMotorRows,
        result: buildSyncResult({
          jointNames: ["shoulder_pan", "elbow_flex", "wrist_roll"],
          motorIds: [SHOULDER_MOTOR_ID, ELBOW_MOTOR_ID, WRIST_MOTOR_ID],
        }),
      }),
    ).toEqual([
      { jointName: "wrist_roll", motorId: WRIST_MOTOR_ID },
      { jointName: "elbow_flex", motorId: ELBOW_MOTOR_ID },
      { jointName: "shoulder_pan", motorId: SHOULDER_MOTOR_ID },
    ]);
  });

  it("keeps existing row order when the sync response has no mapping", () => {
    const currentMotorRows: OperatorCalibrationFileEditMotorRow[] = [
      { jointName: "wrist_roll", motorId: ELBOW_MOTOR_ID },
      { jointName: "elbow_flex", motorId: SHOULDER_MOTOR_ID },
    ];

    expect(
      updateCalibrationFileEditMotorRowsFromSyncResult({
        currentMotorRows,
        result: buildSyncResult({
          jointNames: [],
          motorIds: [],
        }),
      }),
    ).toEqual(currentMotorRows);
  });
});
