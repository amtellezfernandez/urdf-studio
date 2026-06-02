import { describe, expect, it } from "vitest";

import {
  applyJointDataZeroOffset,
  removeJointDataZeroOffset,
  resolveJointDataZeroReference,
} from "@/shared/lib/jointDataZero";

const TEST_JOINT_DATA_ZERO = {
  shoulderZeroRad: 0.4,
  elbowZeroRad: -0.2,
  shoulderDataRad: 0.1,
  elbowDataRad: 0.3,
  wristDataRad: 0.5,
} as const;

describe("jointDataZero", () => {
  it("maps dataset joint values into viewer joint values from the captured zero pose", () => {
    expect(
      applyJointDataZeroOffset({
        jointValues: {
          shoulder: TEST_JOINT_DATA_ZERO.shoulderDataRad,
          elbow: TEST_JOINT_DATA_ZERO.elbowDataRad,
          wrist: TEST_JOINT_DATA_ZERO.wristDataRad,
        },
        dataZeroJointValues: {
          shoulder: TEST_JOINT_DATA_ZERO.shoulderZeroRad,
          elbow: TEST_JOINT_DATA_ZERO.elbowZeroRad,
        },
      }),
    ).toEqual({
      shoulder:
        TEST_JOINT_DATA_ZERO.shoulderDataRad +
        TEST_JOINT_DATA_ZERO.shoulderZeroRad,
      elbow:
        TEST_JOINT_DATA_ZERO.elbowDataRad + TEST_JOINT_DATA_ZERO.elbowZeroRad,
      wrist: TEST_JOINT_DATA_ZERO.wristDataRad,
    });
  });

  it("maps viewer joint values back into dataset values relative to zero pose", () => {
    const dataJointValues = removeJointDataZeroOffset({
      jointValues: {
        shoulder:
          TEST_JOINT_DATA_ZERO.shoulderDataRad +
          TEST_JOINT_DATA_ZERO.shoulderZeroRad,
      },
      dataZeroJointValues: {
        shoulder: TEST_JOINT_DATA_ZERO.shoulderZeroRad,
      },
    });
    expect(dataJointValues.shoulder).toBeCloseTo(
      TEST_JOINT_DATA_ZERO.shoulderDataRad,
    );
  });

  it("uses captured zero pose as reference and falls back when none exists", () => {
    expect(
      resolveJointDataZeroReference({
        dataZeroJointValues: {
          shoulder: TEST_JOINT_DATA_ZERO.shoulderZeroRad,
        },
        fallbackJointValues: {
          shoulder: TEST_JOINT_DATA_ZERO.shoulderDataRad,
        },
      }),
    ).toEqual({
      shoulder: TEST_JOINT_DATA_ZERO.shoulderZeroRad,
    });
    expect(
      resolveJointDataZeroReference({
        dataZeroJointValues: {},
        fallbackJointValues: {
          shoulder: TEST_JOINT_DATA_ZERO.shoulderDataRad,
        },
      }),
    ).toEqual({
      shoulder: TEST_JOINT_DATA_ZERO.shoulderDataRad,
    });
  });
});
