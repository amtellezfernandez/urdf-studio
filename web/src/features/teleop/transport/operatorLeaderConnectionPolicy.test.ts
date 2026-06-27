import { describe, expect, it } from "vitest";

import type { OperatorTeleopControlGroup } from "@/features/teleop/profiles/operatorTeleopControlGroups";
import {
  buildLeaderCalibrationSetupLines,
  buildLeaderDeviceRoleKeys,
  buildLeaderHardwareDetailLines,
  findCompatibleLeaderControlPart,
  formatLeaderControlPartChoiceLabel,
  listCompatibleLeaderControlParts,
  resolveLeaderMappedTargetJointNames,
  resolveLeaderSideForControlGroup,
  resolveLeaderTargetCompatibility,
  resolveLeaderTargetSelection,
  resolveTeleopTargetActuatorJointNames,
} from "@/features/teleop/transport/operatorLeaderConnectionPolicy";
import type {
  OperatorLeaderControlPart,
  OperatorLeaderDevice,
} from "@/features/teleop/transport/operatorHelperApi";

const TEST_ACTUATOR_COUNT = {
  partial: 6,
  exact: 8,
} as const;
const TEST_EIGHT_MOTOR_IDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const TEST_EIGHT_LEADER_JOINT_NAMES = [
  "leader_axis_1",
  "leader_axis_2",
  "leader_axis_3",
  "leader_axis_4",
  "leader_axis_5",
  "leader_axis_6",
  "leader_axis_7",
  "leader_axis_8",
] as const;
const TEST_SIX_LEADER_JOINT_NAMES = TEST_EIGHT_LEADER_JOINT_NAMES.slice(
  0,
  TEST_ACTUATOR_COUNT.partial,
);

const buildArmGroup = (
  overrides: Partial<OperatorTeleopControlGroup> = {},
): OperatorTeleopControlGroup => ({
  id: "arm.primary",
  kind: "arm",
  label: "Primary arm",
  jointNames: [
    "openarm_left_finger_joint1",
    "openarm_left_joint2",
    "openarm_left_joint1",
  ],
  endEffectorJointNames: ["openarm_left_finger_joint1"],
  teleopEnabled: true,
  disabledReason: null,
  ...overrides,
});

const buildEightAxisArmGroup = (
  overrides: Partial<OperatorTeleopControlGroup> = {},
): OperatorTeleopControlGroup =>
  buildArmGroup({
    jointNames: [
      "openarm_left_joint1",
      "openarm_left_joint2",
      "openarm_left_joint3",
      "openarm_left_joint4",
      "openarm_left_joint5",
      "openarm_left_joint6",
      "openarm_left_joint7",
      "openarm_left_finger_joint1",
    ],
    ...overrides,
  });

const buildSo101ArmGroup = (
  overrides: Partial<OperatorTeleopControlGroup> = {},
): OperatorTeleopControlGroup =>
  buildArmGroup({
    label: "Arm",
    jointNames: [
      "gripper",
      "wrist_roll",
      "wrist_flex",
      "elbow_flex",
      "shoulder_lift",
      "shoulder_pan",
    ],
    endEffectorJointNames: ["gripper"],
    ...overrides,
  });

const buildControlPart = (
  overrides: Partial<OperatorLeaderControlPart> = {},
): OperatorLeaderControlPart => ({
  id: "leader-arm",
  kind: "arm",
  label: "Leader arm",
  actuatorCount: TEST_ACTUATOR_COUNT.exact,
  motorBus: "feetech",
  motorIds: [...TEST_EIGHT_MOTOR_IDS],
  motorModel: "sts3215",
  motorModels: {},
  jointNames: [...TEST_EIGHT_LEADER_JOINT_NAMES],
  zeroPositionsRad: {},
  calibrationCategory: "teleoperators",
  calibrationProfile: "openarm_mini",
  calibrationId: "lab-leader",
  calibrationGroup: "left",
  calibrationMtimeNs: 0,
  configuredPort: "/dev/serial/by-id/leader",
  configuredPortMatches: true,
  configuredPortStatus: "matched",
  ...overrides,
});

const buildLeader = (
  controlParts: OperatorLeaderControlPart[],
  overrides: Partial<OperatorLeaderDevice> = {},
): OperatorLeaderDevice => ({
  id: "leader",
  path: "/dev/serial/by-id/leader",
  devicePath: "/dev/ttyUSB0",
  identityKey: "serial-by-id:leader",
  identityStable: true,
  serial: "leader",
  label: "Leader",
  source: "serial_by_id",
  leaderType: "serial_leader_candidate",
  hardwareFamily: "arm_controller",
  motorBus: "feetech",
  motorIds: [...TEST_EIGHT_MOTOR_IDS],
  motorModels: {},
  motorCount: TEST_ACTUATOR_COUNT.exact,
  motorProbeError: null,
  controlParts,
  recommendedEnv: "",
  available: true,
  ...overrides,
});

describe("operatorLeaderConnectionPolicy", () => {
  it("orders target joints as arm axes first with gripper last", () => {
    expect(resolveTeleopTargetActuatorJointNames(buildArmGroup())).toEqual([
      "openarm_left_joint1",
      "openarm_left_joint2",
      "openarm_left_finger_joint1",
    ]);
  });

  it("rejects Feetech arm leaders until an explicit LeRobot calibration is present", () => {
    const uncalibratedLeader = buildLeader([
      buildControlPart({
        calibrationCategory: null,
        calibrationProfile: null,
        calibrationId: null,
      }),
    ]);

    expect(
      resolveLeaderTargetCompatibility(buildArmGroup(), uncalibratedLeader),
    ).toEqual({
      compatible: false,
      reason: "Calibration required. Rescan after calibration.",
    });
  });

  it("prefers calibrated compatible parts", () => {
    const calibratedPart = buildControlPart({ id: "calibrated" });
    const leader = buildLeader([
      buildControlPart({
        id: "uncalibrated",
        calibrationCategory: null,
        calibrationProfile: null,
        calibrationId: null,
      }),
      calibratedPart,
    ]);

    expect(findCompatibleLeaderControlPart(buildArmGroup(), leader)).toBe(
      calibratedPart,
    );
  });

  it("prefers leader calibration metadata over follower metadata on the same serial device", () => {
    const followerPart = buildControlPart({
      id: "follower-arm",
      label: "Follower arm",
      calibrationCategory: "robots",
      calibrationProfile: "so100_follower",
      calibrationId: "my_awesome_follower_arm",
      configuredPortMatches: false,
      configuredPortStatus: "stale",
    });
    const leaderPart = buildControlPart({
      id: "leader-arm",
      label: "Leader arm",
      calibrationCategory: "teleoperators",
      calibrationProfile: "so100_leader",
      calibrationId: "my_awesome_leader_arm",
      calibrationGroup: "all",
      configuredPortMatches: false,
      configuredPortStatus: "stale",
    });
    const leader = buildLeader([followerPart, leaderPart]);

    expect(findCompatibleLeaderControlPart(buildArmGroup(), leader)).toBe(
      leaderPart,
    );
    expect(buildLeaderHardwareDetailLines(leader, leaderPart)).toEqual([
      "Arm device",
      "LeRobot teleoperator calibration: so100_leader · my_awesome_leader_arm · all",
      "LeRobot configured port is missing",
      "8 actuators",
    ]);
  });

  it("lists selectable LeRobot calibration sources with readable labels", () => {
    const followerPart = buildControlPart({
      id: "robots:openarm_follower:follower:left",
      label: "Follower arm",
      calibrationCategory: "robots",
      calibrationProfile: "openarm_follower",
      calibrationId: "follower",
      calibrationGroup: "left",
      configuredPortMatches: false,
      configuredPortStatus: "stale",
    });
    const leaderPart = buildControlPart({
      id: "teleoperators:openarm_mini:leader:left",
      label: "Leader arm",
      calibrationCategory: "teleoperators",
      calibrationProfile: "openarm_mini",
      calibrationId: "leader",
      calibrationGroup: "left",
      configuredPortMatches: false,
      configuredPortStatus: "stale",
    });
    const leader = buildLeader([followerPart, leaderPart]);
    const options = listCompatibleLeaderControlParts(buildArmGroup(), leader);

    expect(options).toEqual([leaderPart, followerPart]);
    expect(options.map(formatLeaderControlPartChoiceLabel)).toEqual([
      "teleoperator: openarm_mini · leader · left",
      "robot/follower: openarm_follower · follower · left",
    ]);
  });

  it("surfaces OpenArm side-specific LeRobot calibration groups", () => {
    const rightMiniPart = buildControlPart({
      calibrationCategory: "teleoperators",
      calibrationProfile: "openarm_mini",
      calibrationId: "my_leader",
      calibrationGroup: "right",
      calibrationMtimeNs: 1_750_000_000_000_000_000,
      configuredPort: null,
      configuredPortMatches: false,
      configuredPortStatus: "none",
    });
    const leader = buildLeader([rightMiniPart]);
    const detailLines = buildLeaderHardwareDetailLines(leader, rightMiniPart);

    expect(detailLines).toEqual([
      "Arm device",
      "LeRobot teleoperator calibration: openarm_mini · my_leader · right",
      expect.stringMatching(/^Last modified: /u),
      "8 actuators",
    ]);
  });

  it("prefers the control part whose configured port matches the active device", () => {
    const followerPart = buildControlPart({
      id: "follower-arm",
      label: "Follower arm",
      calibrationCategory: "robots",
      calibrationProfile: "so100_follower",
      calibrationId: "my_awesome_follower_arm",
      configuredPortMatches: true,
      configuredPortStatus: "matched",
    });
    const leaderPart = buildControlPart({
      id: "leader-arm",
      label: "Leader arm",
      calibrationCategory: "teleoperators",
      calibrationProfile: "so100_leader",
      calibrationId: "my_awesome_leader_arm",
      configuredPortMatches: false,
      configuredPortStatus: "unmatched",
    });
    const leader = buildLeader([leaderPart, followerPart]);

    expect(findCompatibleLeaderControlPart(buildArmGroup(), leader)).toBe(
      followerPart,
    );
  });

  it("shows the LeRobot setup that will be used for calibration", () => {
    expect(
      buildLeaderCalibrationSetupLines({
        port: "/dev/serial/by-id/openarm-right",
        portLeft: "/dev/serial/by-id/openarm-left",
        portRight: "/dev/serial/by-id/openarm-right",
        calibrationProfile: "openarm_mini",
        calibrationId: "lab-leader_right",
        calibrationGroup: "right",
      }),
    ).toEqual([
      "LeRobot setup: bi_openarm_mini (left + right)",
      "Writes files: lab-leader_left.json + lab-leader_right.json",
    ]);
    expect(
      buildLeaderCalibrationSetupLines({
        port: "/dev/serial/by-id/openarm-right",
        calibrationProfile: "openarm_mini",
        calibrationGroup: "right",
      }),
    ).toEqual(["LeRobot setup: openarm_mini (right)"]);
    expect(
      buildLeaderCalibrationSetupLines({
        port: "/dev/serial/by-id/so100",
        calibrationProfile: "so100_leader",
      }),
    ).toEqual(["LeRobot setup: so100_leader"]);
  });

  it("builds leader role keys from stable identity, active port, and configured ports", () => {
    const leader = buildLeader([
      buildControlPart({
        configuredPort:
          "/dev/serial/by-id/usb-1a86_USB_Single_Serial_58FA095368-if00",
      }),
    ], {
      identityKey: "serial-by-id:1a86_USB_Single_Serial_58FA095368",
      path: "/dev/serial/by-id/usb-1a86_USB_Single_Serial_58FA095368-if00",
      devicePath: "/dev/ttyACM0",
    });

    expect(buildLeaderDeviceRoleKeys(leader)).toEqual([
      "serial-by-id:1a86_USB_Single_Serial_58FA095368",
      "/dev/serial/by-id/usb-1a86_USB_Single_Serial_58FA095368-if00",
      "/dev/ttyACM0",
    ]);
  });

  it("reports a failed motor probe instead of a missing arm", () => {
    const leader = buildLeader([], {
      motorIds: [],
      motorCount: 0,
      motorProbeError: "port is busy",
      hardwareFamily: "serial_unknown",
    });

    expect(buildLeaderHardwareDetailLines(leader, null)).toEqual([
      "Serial device",
      "Motor probe failed",
    ]);
    expect(resolveLeaderTargetCompatibility(buildArmGroup(), leader)).toEqual({
      compatible: false,
      reason:
        "Motor probe failed. Disconnect other use of this port, then Rescan.",
    });
  });

  it("reports detected motor count when the chain is too small for an arm", () => {
    const leader = buildLeader([], {
      motorIds: [1, 2, 3],
      motorCount: 3,
    });

    expect(
      resolveLeaderTargetCompatibility(buildEightAxisArmGroup(), leader),
    ).toEqual({
      compatible: false,
      reason: "Detected 3 motors. Primary arm needs 8.",
    });
  });

  it("allows partial mapping only for the single-arm primary target", () => {
    const partialPart = buildControlPart({
      actuatorCount: TEST_ACTUATOR_COUNT.partial,
      jointNames: [...TEST_SIX_LEADER_JOINT_NAMES],
    });
    const leader = buildLeader([partialPart]);

    expect(resolveLeaderTargetCompatibility(buildEightAxisArmGroup(), leader)).toMatchObject({
      compatible: true,
    });
    expect(
      resolveLeaderTargetCompatibility(
        buildEightAxisArmGroup({ id: "arm.left", label: "Left arm" }),
        leader,
      ),
    ).toMatchObject({
      compatible: false,
      reason:
        "6 actuators detected. Left arm needs 8. Use a single-arm target for partial mapping.",
    });
  });

  it("treats a six-actuator SO101 leader as an exact six-axis target match", () => {
    const so101Part = buildControlPart({
      actuatorCount: TEST_ACTUATOR_COUNT.partial,
      jointNames: [
        "shoulder_pan",
        "shoulder_lift",
        "elbow_flex",
        "wrist_flex",
        "wrist_roll",
        "gripper",
      ],
    });
    const leader = buildLeader([so101Part]);

    expect(resolveTeleopTargetActuatorJointNames(buildSo101ArmGroup())).toEqual([
      "shoulder_pan",
      "shoulder_lift",
      "elbow_flex",
      "wrist_flex",
      "wrist_roll",
      "gripper",
    ]);
    expect(resolveLeaderTargetCompatibility(buildSo101ArmGroup(), leader)).toEqual({
      compatible: true,
      reason: "",
    });
  });

  it("resolves side-specific leader assignments from control group ids", () => {
    expect(resolveLeaderSideForControlGroup(buildArmGroup({ id: "arm.left" }))).toBe(
      "left",
    );
    expect(resolveLeaderSideForControlGroup(buildArmGroup({ id: "arm.right" }))).toBe(
      "right",
    );
    expect(resolveLeaderSideForControlGroup(buildArmGroup())).toBe("both");
  });

  it("resolves a single active target option for the compact target toggle", () => {
    const leftGroup = buildEightAxisArmGroup({ id: "arm.left", label: "Left arm" });
    const rightGroup = buildEightAxisArmGroup({
      id: "arm.right",
      label: "Right arm",
    });
    const leader = buildLeader([buildControlPart()]);

    expect(
      resolveLeaderTargetSelection({
        targetGroups: [leftGroup, rightGroup],
        leader,
        assignment: null,
        pendingTargetGroupId: null,
      }).selectedTargetOption?.group.id,
    ).toBe("arm.left");
    expect(
      resolveLeaderTargetSelection({
        targetGroups: [leftGroup, rightGroup],
        leader,
        assignment: null,
        pendingTargetGroupId: "arm.right",
      }).selectedTargetOption?.group.id,
    ).toBe("arm.right");
    expect(
      resolveLeaderTargetSelection({
        targetGroups: [leftGroup, rightGroup],
        leader,
        assignment: null,
        pendingTargetGroupId: null,
        preferredTargetGroupId: "arm.right",
      }).selectedTargetOption?.group.id,
    ).toBe("arm.right");
    expect(
      resolveLeaderTargetSelection({
        targetGroups: [leftGroup, rightGroup],
        leader,
        assignment: { side: "right", targetGroupId: "arm.right" },
        pendingTargetGroupId: "arm.left",
      }).connectedTargetOption?.group.id,
    ).toBe("arm.right");
  });

  it("maps leader source axes onto the sorted target axes", () => {
    expect(
      resolveLeaderMappedTargetJointNames(
        buildArmGroup(),
        buildControlPart({ actuatorCount: TEST_ACTUATOR_COUNT.partial }),
      ),
    ).toEqual([
      "openarm_left_joint1",
      "openarm_left_joint2",
      "openarm_left_finger_joint1",
    ]);
  });

  it("caps mapped targets by actuator count even when source joint metadata is longer", () => {
    expect(
      resolveLeaderMappedTargetJointNames(
        buildEightAxisArmGroup(),
        buildControlPart({ actuatorCount: TEST_ACTUATOR_COUNT.partial }),
      ),
    ).toHaveLength(TEST_ACTUATOR_COUNT.partial);
  });
});
