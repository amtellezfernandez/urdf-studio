import { describe, expect, it } from "vitest";

import {
  applyOperatorLeaderTelemetryPoseReferences,
  applyOperatorLeaderTelemetryZeroOffsets,
  buildMappedOperatorLeaderTelemetry,
  buildOperatorLeaderHardwareReleaseRequest,
  buildOperatorLeaderTelemetryTargetReleaseRequest,
  pruneOperatorLeaderTelemetryZeroOffsets,
  resolveOperatorLeaderTargetJointDirections,
  resolveOperatorLeaderTelemetryTargets,
  scoreOperatorLeaderControlPartForTarget,
} from "@/features/teleop/transport/operatorLeaderTelemetry";
import type {
  OperatorLeaderDevice,
  OperatorLeaderState,
} from "@/features/teleop/transport/operatorHelperApi";
import {
  OPERATOR_LEROBOT_CALIBRATION_FILE_SYNC_REVISION_INITIAL,
  OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
} from "@/features/teleop/params/operatorTeleopParams";

const TEST_LEADER_POSE_REFERENCES = {
  targetResetPoseRad: 1.2,
  fallbackReferencePoseRad: -0.4,
  leaderDeltaFromNeutralRad: 0.25,
} as const;

const buildLeader = (): OperatorLeaderDevice => ({
  id: "leader-1",
  path: "/dev/ttyACM0",
  devicePath: "/dev/ttyACM0",
  identityKey: "serial:test",
  identityStable: true,
  serial: "test",
  label: "Leader",
  source: "serial_by_id",
  leaderType: "serial_leader_candidate",
  hardwareFamily: "arm_controller",
  motorBus: "feetech",
  motorIds: [1, 2, 3, 4, 5, 6],
  motorModels: {},
  motorCount: 6,
  motorProbeError: null,
  controlParts: [
    {
      id: "arm-a",
      kind: "arm",
      label: "Arm",
      actuatorCount: 3,
      motorBus: "feetech",
      motorIds: [1, 2, 3],
      motorModel: "sts3215",
      motorModels: {},
      jointNames: [
        "shoulder_pan",
        "shoulder_lift",
        "elbow_flex",
      ],
      zeroPositionsRad: {
        shoulder_pan: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
        shoulder_lift: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
        elbow_flex: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
      },
      calibrationCategory: "teleoperators",
      calibrationProfile: "so100_leader",
      calibrationId: "my_leader",
      calibrationGroup: "all",
      configuredPort: null,
      configuredPortMatches: false,
      configuredPortStatus: "none",
    },
  ],
  recommendedEnv: "LEADER_SERIAL_PORT",
  available: true,
});

describe("operatorLeaderTelemetry", () => {
  it("resolves one typed polling target from leader detection and assignment state", () => {
    const targets = resolveOperatorLeaderTelemetryTargets({
      leaders: [buildLeader()],
      assignments: {
        "serial:test": {
          side: "both",
          targetGroupId: "arm.primary",
          targetJointNames: [
            "arm_elbow_flex",
            "arm_shoulder_lift",
            "arm_shoulder_pan",
            "arm_wrist_flex",
          ],
          targetEndEffectorJointNames: ["gripper"],
          controlPartId: "arm-a",
          sourceMotorIds: [1, 2, 3],
          sourceMotorModel: "sts3215",
          sourceActuatorCount: 3,
          sourceCalibrationCategory: "teleoperators",
          sourceCalibrationProfile: "so100_leader",
          sourceCalibrationId: "my_leader",
          sourceCalibrationGroup: "all",
        },
      },
      availableJointNames: [
        "arm_elbow_flex",
        "arm_shoulder_lift",
        "arm_shoulder_pan",
        "arm_wrist_flex",
      ],
    });

    expect(targets).toEqual([
      {
        id: "leader-1",
        path: "/dev/ttyACM0",
        identityKey: "serial:test",
        label: "Leader",
        side: "both",
        motorIds: [1, 2, 3],
        motorModel: "sts3215",
        calibrationCategory: "teleoperators",
        calibrationProfile: "so100_leader",
        calibrationId: "my_leader",
        calibrationGroup: "all",
        calibrationRevision:
          OPERATOR_LEROBOT_CALIBRATION_FILE_SYNC_REVISION_INITIAL,
        sourceJointNames: ["shoulder_pan", "shoulder_lift", "elbow_flex"],
        targetJointNames: [
          "arm_shoulder_pan",
          "arm_shoulder_lift",
          "arm_elbow_flex",
        ],
        targetJointDirections: [1, 1, 1],
        sourceNeutralPositionsByTargetJointName: {
          arm_shoulder_pan: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
          arm_shoulder_lift: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
          arm_elbow_flex: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
        },
      },
    ]);
  });

  it("maps ordered leader axes to target URDF joints", () => {
    const state: OperatorLeaderState = {
      connected: true,
      port: "/dev/ttyACM0",
      side: "both",
      sourceTsMs: 123,
      joints: {
        leader_axis_2: {
          positionRad: 0.2,
          velocityRadPerSec: null,
          torqueNm: null,
        },
        leader_axis_1: {
          positionRad: 0.1,
          velocityRadPerSec: null,
          torqueNm: null,
        },
      },
      error: null,
    };

    expect(
      buildMappedOperatorLeaderTelemetry({
        state,
        sourceId: "leader:serial:test",
        sourceLabel: "Leader",
        targetJointNames: ["shoulder", "elbow"],
      }),
    ).toMatchObject({
      shoulder: { positionRad: 0.1, sourceTsMs: 123 },
      elbow: { positionRad: 0.2, sourceTsMs: 123 },
    });
  });

  it("maps named LeRobot leader joints by source joint name", () => {
    const state: OperatorLeaderState = {
      connected: true,
      port: "/dev/ttyACM0",
      side: "both",
      sourceTsMs: 123,
      joints: {
        gripper: {
          positionRad: 0.6,
          velocityRadPerSec: null,
          torqueNm: null,
        },
        elbow_flex: {
          positionRad: 0.3,
          velocityRadPerSec: null,
          torqueNm: null,
        },
        shoulder_pan: {
          positionRad: 0.1,
          velocityRadPerSec: null,
          torqueNm: null,
        },
      },
      error: null,
    };

    expect(
      buildMappedOperatorLeaderTelemetry({
        state,
        sourceId: "leader:serial:test",
        sourceLabel: "Leader",
        sourceJointNames: ["shoulder_pan", "elbow_flex", "gripper"],
        sourceMotorIds: [5, 4, 6],
        targetJointNames: ["arm_shoulder_pan", "arm_elbow_flex", "arm_gripper"],
      }),
    ).toMatchObject({
      arm_shoulder_pan: { positionRad: 0.1, sourceTsMs: 123, motorId: 5 },
      arm_elbow_flex: { positionRad: 0.3, sourceTsMs: 123, motorId: 4 },
      arm_gripper: { positionRad: 0.6, sourceTsMs: 123, motorId: 6 },
    });
  });

  it("maps an SO101 leader onto crane boom and finger slide while keeping the base fixed", () => {
    const state: OperatorLeaderState = {
      connected: true,
      port: "/dev/ttyACM0",
      side: "both",
      sourceTsMs: 123,
      joints: {
        shoulder_pan: {
          positionRad: 0.4,
          velocityRadPerSec: 0.2,
          torqueNm: 0.1,
        },
        shoulder_lift: {
          positionRad: -0.25,
          velocityRadPerSec: 0.1,
          torqueNm: 0.2,
        },
        elbow_flex: {
          positionRad: 0,
          velocityRadPerSec: null,
          torqueNm: null,
        },
        wrist_flex: {
          positionRad: 0,
          velocityRadPerSec: null,
          torqueNm: null,
        },
        wrist_roll: {
          positionRad: 0,
          velocityRadPerSec: null,
          torqueNm: null,
        },
        gripper: {
          positionRad: 1.25,
          velocityRadPerSec: 0.05,
          torqueNm: 0.3,
        },
      },
      error: null,
    };

    const mapped = buildMappedOperatorLeaderTelemetry({
      state,
      sourceId: "leader:serial:test",
      sourceLabel: "SO101 Leader",
      sourceJointNames: [
        "shoulder_pan",
        "shoulder_lift",
        "elbow_flex",
        "wrist_flex",
        "wrist_roll",
        "gripper",
      ],
      sourceMotorIds: [1, 2, 3, 4, 5, 6],
      targetJointNames: ["base_yaw", "boom_luff", "finger_slide"],
    });

    expect(mapped.base_yaw).toBeUndefined();
    expect(mapped.boom_luff?.positionRad).toBeCloseTo(-0.25);
    expect(mapped.finger_slide?.positionRad).toBeCloseTo(0.02);
    expect(Object.keys(mapped).sort()).toEqual([
      "boom_luff",
      "finger_slide",
    ]);
  });

  it("keeps SO-style LeRobot leader deltas in LeRobot joint direction", () => {
    const directions = resolveOperatorLeaderTargetJointDirections({
      calibrationProfile: "so100_leader",
      targetJointNames: ["arm_shoulder_pan"],
    });
    const offsets = {};
    const first = buildMappedOperatorLeaderTelemetry({
      state: {
        connected: true,
        port: "/dev/ttyACM0",
        side: "both",
        sourceTsMs: 123,
        joints: {
          shoulder_pan: {
            positionRad: 0.4,
            velocityRadPerSec: 0.2,
            torqueNm: 0.1,
          },
        },
        error: null,
      },
      sourceId: "leader:serial:test",
      sourceLabel: "Leader",
      sourceJointNames: ["shoulder_pan"],
      targetJointNames: ["arm_shoulder_pan"],
      targetJointDirections: directions,
    });
    const zeroedFirst = applyOperatorLeaderTelemetryZeroOffsets({
      telemetryByName: first,
      zeroOffsetKey: "leader|arm|1",
      referencePositionsByJointName: { arm_shoulder_pan: 0 },
      zeroOffsetsByKey: offsets,
    });
    const second = buildMappedOperatorLeaderTelemetry({
      state: {
        connected: true,
        port: "/dev/ttyACM0",
        side: "both",
        sourceTsMs: 173,
        joints: {
          shoulder_pan: {
            positionRad: 0.5,
            velocityRadPerSec: 0.3,
            torqueNm: 0.2,
          },
        },
        error: null,
      },
      sourceId: "leader:serial:test",
      sourceLabel: "Leader",
      sourceJointNames: ["shoulder_pan"],
      targetJointNames: ["arm_shoulder_pan"],
      targetJointDirections: directions,
    });
    const zeroedSecond = applyOperatorLeaderTelemetryZeroOffsets({
      telemetryByName: second,
      zeroOffsetKey: "leader|arm|1",
      referencePositionsByJointName: { arm_shoulder_pan: 0 },
      zeroOffsetsByKey: offsets,
    });

    expect(first.arm_shoulder_pan?.positionRad).toBeCloseTo(0.4);
    expect(first.arm_shoulder_pan?.velocityRadPerSec).toBeCloseTo(0.2);
    expect(first.arm_shoulder_pan?.torqueNm).toBeCloseTo(0.1);
    expect(zeroedFirst.arm_shoulder_pan?.positionRad).toBeCloseTo(0);
    expect(zeroedSecond.arm_shoulder_pan?.positionRad).toBeCloseTo(0.1);
  });

  it("keeps non-SO leader profiles in the native URDF model direction", () => {
    expect(
      resolveOperatorLeaderTargetJointDirections({
        calibrationProfile: "openarm_leader",
        targetJointNames: ["openarm_left_joint1", "openarm_left_joint2"],
      }),
    ).toEqual([1, 1]);
  });

  it("maps calibrated LeRobot neutral to the loaded URDF reset pose", () => {
    const offsets = {};
    const first = applyOperatorLeaderTelemetryPoseReferences({
      telemetryByName: {
        arm_elbow_flex: {
          positionRad: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
          velocityRadPerSec: null,
          torqueNm: null,
          tempMos: Number.NaN,
          tempRotor: Number.NaN,
          sourceId: "leader:serial:test",
          sourceLabel: "Leader",
          sourceTsMs: 123,
        },
      },
      zeroOffsetKey: "leader|arm",
      sourceNeutralPositionsByTargetJointName: {
        arm_elbow_flex: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
      },
      targetZeroPositionsByJointName: {
        arm_elbow_flex: TEST_LEADER_POSE_REFERENCES.targetResetPoseRad,
      },
      fallbackReferencePositionsByJointName: {
        arm_elbow_flex: TEST_LEADER_POSE_REFERENCES.fallbackReferencePoseRad,
      },
      zeroOffsetsByKey: offsets,
    });
    const second = applyOperatorLeaderTelemetryPoseReferences({
      telemetryByName: {
        arm_elbow_flex: {
          ...first.arm_elbow_flex!,
          positionRad:
            OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD +
            TEST_LEADER_POSE_REFERENCES.leaderDeltaFromNeutralRad,
          sourceTsMs: 173,
        },
      },
      zeroOffsetKey: "leader|arm",
      sourceNeutralPositionsByTargetJointName: {
        arm_elbow_flex: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
      },
      targetZeroPositionsByJointName: {
        arm_elbow_flex: TEST_LEADER_POSE_REFERENCES.targetResetPoseRad,
      },
      fallbackReferencePositionsByJointName: {
        arm_elbow_flex: TEST_LEADER_POSE_REFERENCES.fallbackReferencePoseRad,
      },
      zeroOffsetsByKey: offsets,
    });

    expect(first.arm_elbow_flex?.positionRad).toBeCloseTo(
      TEST_LEADER_POSE_REFERENCES.targetResetPoseRad,
    );
    expect(second.arm_elbow_flex?.positionRad).toBeCloseTo(
      TEST_LEADER_POSE_REFERENCES.targetResetPoseRad +
        TEST_LEADER_POSE_REFERENCES.leaderDeltaFromNeutralRad,
    );
    expect(offsets).toEqual({});
  });

  it("falls back to the current pose when a URDF reset pose is unavailable", () => {
    const offsets = {};
    const telemetry = applyOperatorLeaderTelemetryPoseReferences({
      telemetryByName: {
        arm_elbow_flex: {
          positionRad: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
          velocityRadPerSec: null,
          torqueNm: null,
          tempMos: Number.NaN,
          tempRotor: Number.NaN,
          sourceId: "leader:serial:test",
          sourceLabel: "Leader",
          sourceTsMs: 123,
        },
      },
      zeroOffsetKey: "leader|arm",
      sourceNeutralPositionsByTargetJointName: {
        arm_elbow_flex: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
      },
      targetZeroPositionsByJointName: {},
      fallbackReferencePositionsByJointName: {
        arm_elbow_flex: TEST_LEADER_POSE_REFERENCES.fallbackReferencePoseRad,
      },
      zeroOffsetsByKey: offsets,
    });

    expect(telemetry.arm_elbow_flex?.positionRad).toBeCloseTo(
      TEST_LEADER_POSE_REFERENCES.fallbackReferencePoseRad,
    );
    expect(offsets).toEqual({});
  });

  it("drops stale zero offsets for calibrated joints while fallback joints remain", () => {
    const zeroOffsetKey = "leader|arm";
    const offsets = {
      [zeroOffsetKey]: {
        arm_elbow_flex: TEST_LEADER_POSE_REFERENCES.leaderDeltaFromNeutralRad,
        arm_wrist_flex: TEST_LEADER_POSE_REFERENCES.leaderDeltaFromNeutralRad,
      },
    };

    applyOperatorLeaderTelemetryPoseReferences({
      telemetryByName: {
        arm_elbow_flex: {
          positionRad: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
          velocityRadPerSec: null,
          torqueNm: null,
          tempMos: Number.NaN,
          tempRotor: Number.NaN,
          sourceId: "leader:serial:test",
          sourceLabel: "Leader",
          sourceTsMs: 123,
        },
        arm_wrist_flex: {
          positionRad: TEST_LEADER_POSE_REFERENCES.leaderDeltaFromNeutralRad,
          velocityRadPerSec: null,
          torqueNm: null,
          tempMos: Number.NaN,
          tempRotor: Number.NaN,
          sourceId: "leader:serial:test",
          sourceLabel: "Leader",
          sourceTsMs: 123,
        },
      },
      zeroOffsetKey,
      sourceNeutralPositionsByTargetJointName: {
        arm_elbow_flex: OPERATOR_LEROBOT_CALIBRATION_ZERO_POSITION_RAD,
      },
      targetZeroPositionsByJointName: {
        arm_elbow_flex: TEST_LEADER_POSE_REFERENCES.targetResetPoseRad,
      },
      fallbackReferencePositionsByJointName: {
        arm_wrist_flex: TEST_LEADER_POSE_REFERENCES.fallbackReferencePoseRad,
      },
      zeroOffsetsByKey: offsets,
    });

    expect(offsets[zeroOffsetKey]).not.toHaveProperty("arm_elbow_flex");
    expect(offsets[zeroOffsetKey]?.arm_wrist_flex).toBeCloseTo(
      TEST_LEADER_POSE_REFERENCES.leaderDeltaFromNeutralRad,
    );
  });

  it("zeros the first leader sample to the current target pose", () => {
    const offsets = {};
    const first = applyOperatorLeaderTelemetryZeroOffsets({
      telemetryByName: {
        shoulder: {
          positionRad: -1.8,
          velocityRadPerSec: null,
          torqueNm: null,
          tempMos: Number.NaN,
          tempRotor: Number.NaN,
          sourceId: "leader:serial:test",
          sourceLabel: "Leader",
          sourceTsMs: 123,
        },
      },
      zeroOffsetKey: "leader|arm",
      referencePositionsByJointName: {
        shoulder: 0,
      },
      zeroOffsetsByKey: offsets,
    });
    const second = applyOperatorLeaderTelemetryZeroOffsets({
      telemetryByName: {
        shoulder: {
          ...first.shoulder!,
          positionRad: -1.7,
          sourceTsMs: 173,
        },
      },
      zeroOffsetKey: "leader|arm",
      referencePositionsByJointName: {
        shoulder: 0.5,
      },
      zeroOffsetsByKey: offsets,
    });

    expect(first.shoulder?.positionRad).toBeCloseTo(0);
    expect(second.shoulder?.positionRad).toBeCloseTo(0.1);
  });

  it("prunes leader zero offsets for inactive targets", () => {
    const offsets = {
      active: { shoulder: 1 },
      stale: { elbow: 2 },
    };

    pruneOperatorLeaderTelemetryZeroOffsets(offsets, new Set(["active"]));

    expect(offsets).toEqual({
      active: { shoulder: 1 },
    });
  });

  it("builds release payloads from the selected control part", () => {
    expect(
      buildOperatorLeaderHardwareReleaseRequest(
        buildLeader(),
        buildLeader().controlParts[0],
      ),
    ).toEqual({
      port: "/dev/ttyACM0",
      motorIds: [1, 2, 3],
      motorModel: "sts3215",
      calibrationCategory: "teleoperators",
      calibrationProfile: "so100_leader",
      calibrationId: "my_leader",
      calibrationGroup: "all",
    });
  });

  it("builds release payloads from active telemetry targets", () => {
    const target = resolveOperatorLeaderTelemetryTargets({
      leaders: [buildLeader()],
      assignments: {
        "serial:test": {
          side: "both",
          targetGroupId: "arm.primary",
          targetJointNames: ["shoulder", "elbow"],
          targetEndEffectorJointNames: [],
          controlPartId: "part-1",
          sourceMotorIds: [1, 2, 3],
          sourceMotorModel: "sts3215",
          sourceActuatorCount: 3,
          sourceCalibrationCategory: "teleoperators",
          sourceCalibrationProfile: "so100_leader",
          sourceCalibrationId: "my_leader",
          sourceCalibrationGroup: "all",
        },
      },
      availableJointNames: ["shoulder", "elbow"],
    })[0];

    expect(buildOperatorLeaderTelemetryTargetReleaseRequest(target)).toEqual({
      port: "/dev/ttyACM0",
      motorIds: [1, 2, 3],
      motorModel: "sts3215",
      calibrationCategory: "teleoperators",
      calibrationProfile: "so100_leader",
      calibrationId: "my_leader",
      calibrationGroup: "all",
    });
  });

  it("scores side-specific OpenArm Mini parts against side-specific targets", () => {
    expect(
      scoreOperatorLeaderControlPartForTarget(
        {
          jointNames: ["left_joint_1", "left_joint_2"],
        },
        ["openarm_left_joint1", "openarm_left_joint2"],
      ),
    ).toBeGreaterThan(
      scoreOperatorLeaderControlPartForTarget(
        {
          jointNames: ["right_joint_1", "right_joint_2"],
        },
        ["openarm_left_joint1", "openarm_left_joint2"],
      ),
    );
  });
});
