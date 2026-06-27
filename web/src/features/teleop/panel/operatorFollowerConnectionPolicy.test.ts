import { describe, expect, it } from "vitest";

import {
  buildFollowerHardwareTargetOptions,
  buildFollowerHardwareReadinessItems,
  isFollowerArmPartProfile,
  resolveAssignedFollowerHardwareProfile,
  resolveBlockedOperatorControlMessage,
  resolveFollowerHardwareProfile,
  resolveFollowerHardwareConnectDisabled,
  resolveFollowerHardwareMotionSafetyLabel,
} from "@/features/teleop/panel/operatorFollowerConnectionPolicy";
import { OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE } from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorTeleopProfile } from "@/features/teleop/profiles/operatorTeleopProfiles";
import type { OperatorHardwareMotionSafetyStatus } from "@/features/teleop/transport/operatorHelperApi";

const TEST_HARDWARE_SAFETY_READY: OperatorHardwareMotionSafetyStatus = {
  motionReady: true,
  authoritativeJointFeedbackReady: true,
  jointRotationCalibrationReady: true,
  jointRotationCalibrationRequired: false,
  jointRotationCalibrationId: "openarm-lab-a",
  selfCollisionPreflightReady: true,
  gripperMotionEnabled: false,
  lastRejectReason: null,
};

const TEST_HARDWARE_SAFETY_REJECTED: OperatorHardwareMotionSafetyStatus = {
  ...TEST_HARDWARE_SAFETY_READY,
  motionReady: false,
  lastRejectReason: "Follower joint feedback missing controlled joints.",
};

const TEST_BASE_FOLLOWER_PROFILE: OperatorTeleopProfile = {
  id: "mobile_base",
  label: "Mobile base",
  summary: "Base drive.",
  controlTargetLabel: "Wheels",
  transport: "robot_gateway",
  robotFamily: "mobile_base",
  robotId: "lekiwi",
  adapterId: "lekiwi_native",
  teleoperationMode: OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
  controlledJointNames: [],
  controlInputs: [],
  capabilities: {
    baseTwist: true,
    lateralStrafe: false,
    armJointState: false,
    armJointCommand: false,
    stateMirroring: false,
    jointJog: false,
    gripper: false,
    targetPoseIk: false,
  },
  topics: { twist: "provider:/control/twist" },
  limits: {
    maxLinearSpeedMps: 0.2,
    maxYawSpeedRps: 0.5,
    commandTickMs: 50,
    deadmanTimeoutMs: 250,
    maxJointJogDeltaRad: 0,
    defaultJointJogStepRad: 0,
    maxJointVelocityRadPerSec: 0,
  },
};

const TEST_ARM_FOLLOWER_PROFILE: OperatorTeleopProfile = {
  ...TEST_BASE_FOLLOWER_PROFILE,
  id: "arm_part",
  label: "Arm follower",
  controlTargetLabel: "Arm",
  robotFamily: "manipulator",
  robotId: "openarm",
  controlledJointNames: ["joint1", "joint2"],
  capabilities: {
    ...TEST_BASE_FOLLOWER_PROFILE.capabilities,
    baseTwist: false,
    armJointState: true,
    armJointCommand: true,
    jointJog: true,
  },
  topics: { jointJog: "provider:/control/joint-jog" },
  limits: {
    ...TEST_BASE_FOLLOWER_PROFILE.limits,
    maxLinearSpeedMps: 0,
    maxYawSpeedRps: 0,
    maxJointJogDeltaRad: 0.05,
    defaultJointJogStepRad: 0.01,
    maxJointVelocityRadPerSec: 0.5,
  },
};

describe("operatorFollowerConnectionPolicy", () => {
  it("prefers an arm-part real-hardware profile over a base profile", () => {
    expect(
      resolveFollowerHardwareProfile([
        TEST_BASE_FOLLOWER_PROFILE,
        TEST_ARM_FOLLOWER_PROFILE,
      ])?.id,
    ).toBe(TEST_ARM_FOLLOWER_PROFILE.id);
    expect(isFollowerArmPartProfile(TEST_ARM_FOLLOWER_PROFILE)).toBe(true);
    expect(isFollowerArmPartProfile(TEST_BASE_FOLLOWER_PROFILE)).toBe(false);
  });

  it("does not expose a base-only profile as a follower arm target", () => {
    expect(resolveFollowerHardwareProfile([TEST_BASE_FOLLOWER_PROFILE])).toBeNull();
    expect(
      buildFollowerHardwareTargetOptions({
        profiles: [TEST_BASE_FOLLOWER_PROFILE],
        providerId: "robot-gateway",
        assignments: {},
        selectedProfileId: null,
        connectedDeviceKey: null,
      }),
    ).toEqual([]);
  });

  it("uses a mixed arm and base profile as an arm-part follower when no arm-only profile exists", () => {
    const mixedProfile = {
      ...TEST_ARM_FOLLOWER_PROFILE,
      id: "mobile_manipulator_arm",
      robotFamily: "mobile_manipulator",
      capabilities: {
        ...TEST_ARM_FOLLOWER_PROFILE.capabilities,
        baseTwist: true,
      },
    } satisfies OperatorTeleopProfile;

    expect(
      resolveFollowerHardwareProfile([
        TEST_BASE_FOLLOWER_PROFILE,
        mixedProfile,
      ])?.id,
    ).toBe(mixedProfile.id);
    expect(isFollowerArmPartProfile(mixedProfile)).toBe(true);
  });

  it("prefers the dual-arm gateway profile over single-arm targets", () => {
    const dualArmProfile = {
      ...TEST_ARM_FOLLOWER_PROFILE,
      id: "openarm_dual_arm_joint_jog",
      controlTargetLabel: "OpenArm robot gateway",
      controlledJointNames: ["openarm_left_joint1", "openarm_right_joint1"],
    } satisfies OperatorTeleopProfile;
    const leftArmProfile = {
      ...TEST_ARM_FOLLOWER_PROFILE,
      id: "openarm_left_arm_joint_jog",
      controlTargetLabel: "OpenArm left arm",
      controlTargetSide: "left",
      controlledJointNames: ["openarm_left_joint1"],
    } satisfies OperatorTeleopProfile;
    const rightArmProfile = {
      ...TEST_ARM_FOLLOWER_PROFILE,
      id: "openarm_right_arm_joint_jog",
      controlTargetLabel: "OpenArm right arm",
      controlTargetSide: "right",
      controlledJointNames: ["openarm_right_joint1"],
    } satisfies OperatorTeleopProfile;

    expect(
      resolveFollowerHardwareProfile([
        dualArmProfile,
        leftArmProfile,
        rightArmProfile,
      ])?.id,
    ).toBe(dualArmProfile.id);
  });

  it("builds remote follower target options with port detail without exposing stale follower state", () => {
    const options = buildFollowerHardwareTargetOptions({
      profiles: [TEST_BASE_FOLLOWER_PROFILE, TEST_ARM_FOLLOWER_PROFILE],
      providerId: "robot-gateway",
      assignments: {
        "provider:robot-gateway:lekiwi_native:lekiwi": "leader",
        "provider:robot-gateway:lekiwi_native:openarm": "follower",
      },
      selectedProfileId: TEST_ARM_FOLLOWER_PROFILE.id,
      connectedDeviceKey: null,
    });

    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      profileId: TEST_ARM_FOLLOWER_PROFILE.id,
      label: "Arm",
      status: "used_as_follower",
      statusLabel: "used as follower",
      optionLabel: "Arm (used as follower)",
    });
    expect(options[0].detailLines).toEqual([
      "2 joints",
    ]);
  });

  it("hides gateway implementation names from follower target labels", () => {
    const options = buildFollowerHardwareTargetOptions({
      profiles: [
        {
          ...TEST_ARM_FOLLOWER_PROFILE,
          label: "So100 Follower joint jog",
          controlTargetLabel: "So100 Follower robot gateway",
          robotId: "so100_follower",
          adapterId: "so100",
          controlledJointNames: [
            "shoulder_pan",
            "shoulder_lift",
            "elbow_flex",
            "wrist_flex",
            "wrist_roll",
            "gripper",
          ],
        },
      ],
      providerId: "robot-gateway",
      assignments: {},
      selectedProfileId: TEST_ARM_FOLLOWER_PROFILE.id,
      connectedDeviceKey: null,
    });

    expect(options[0]).toMatchObject({
      label: "Arm",
      optionLabel: "Arm",
    });
    expect(options[0].detailLines).toEqual(["6 joints"]);
  });

  it("marks follower targets that are already selected as leader", () => {
    const options = buildFollowerHardwareTargetOptions({
      profiles: [TEST_ARM_FOLLOWER_PROFILE],
      providerId: "robot-gateway",
      assignments: {
        "provider:robot-gateway:lekiwi_native:openarm": "leader",
      },
      selectedProfileId: TEST_ARM_FOLLOWER_PROFILE.id,
      connectedDeviceKey: null,
    });

    expect(options[0]).toMatchObject({
      status: "used_as_leader",
      statusLabel: "used as leader",
      optionLabel: "Arm (used as leader)",
    });
    expect(
      resolveFollowerHardwareConnectDisabled({
        leaseBusy: false,
        followerHardwareConnected: false,
        followerHardwareRoleConflict:
          "Disconnect this device as leader before selecting it as follower.",
        followerHardwareProfileAvailable: true,
        gatewayControlCapable: true,
        collaborationTeleopPermitted: true,
      }),
    ).toBe(true);
  });

  it("prefers a target already selected as follower when the follower panel opens", () => {
    const assignedProfile = {
      ...TEST_ARM_FOLLOWER_PROFILE,
      id: "right_arm",
      controlTargetLabel: "Right arm",
      hardwareDeviceKey: "/dev/serial/by-id/openarm-can1",
    } satisfies OperatorTeleopProfile;

    expect(
      resolveAssignedFollowerHardwareProfile({
        profiles: [TEST_ARM_FOLLOWER_PROFILE, assignedProfile],
        providerId: "robot-gateway",
        assignments: {
          "/dev/serial/by-id/openarm-can1": "follower",
        },
      })?.id,
    ).toBe(assignedProfile.id);
  });

  it("marks follower targets assigned through a physical hardware alias", () => {
    const virtualLeftArmProfile = {
      ...TEST_ARM_FOLLOWER_PROFILE,
      id: "left_arm",
      controlTargetLabel: "Left arm",
      hardwareDeviceKey: "openarm:left_arm",
      hardwareDeviceKeys: ["/dev/serial/by-id/openarm-can0"],
    } satisfies OperatorTeleopProfile;

    const options = buildFollowerHardwareTargetOptions({
      profiles: [virtualLeftArmProfile],
      providerId: "robot-gateway",
      assignments: {
        "/dev/serial/by-id/openarm-can0": "leader",
      },
      selectedProfileId: virtualLeftArmProfile.id,
      connectedDeviceKey: null,
    });

    expect(options[0]).toMatchObject({
      status: "used_as_leader",
      optionLabel: "Left arm (used as leader)",
    });
  });

  it("builds explicit readiness rows for every follower motion gate", () => {
    const items = buildFollowerHardwareReadinessItems({
      followerHardwareProfileAvailable: true,
      gatewayControlCapable: true,
      collaborationTeleopPermitted: true,
      leaseRequired: true,
      leaseHeldByThisOperator: false,
      followerTelemetryFreshForMotion: false,
      followerAuthoritativeFeedbackRecentlyReady: true,
      hardwareMotionSafety: TEST_HARDWARE_SAFETY_READY,
    });

    expect(items.map((item) => item.id)).toEqual([
      "gateway",
      "permission",
      "lease",
      "feedback",
      "joint-calibration",
      "telemetry",
      "self-collision",
    ]);
    expect(items.find((item) => item.id === "lease")).toMatchObject({
      ready: false,
      detail: "Click Connect to request the hardware lease.",
    });
    expect(items.find((item) => item.id === "telemetry")).toMatchObject({
      ready: false,
      detail: "Waiting for current follower joint positions.",
    });
  });

  it("resolves blocked control messages in production priority order", () => {
    const baseParams = {
      providerManifestAvailable: true,
      selectedProfileAvailable: true,
      providerControlCapable: true,
      collaborationTeleopPermitted: true,
      requestedTeleoperationModeLabel: "Real hardware",
      connectedTeleoperationModeLabel: "Real hardware",
      teleoperationModeMatched: true,
      selectedProfileRequiresLease: true,
      leaseHeldByOtherOperator: false,
      leaseHeldByThisOperator: true,
      selectedProfileSupportsJointJog: true,
      followerHardwareConnected: true,
      followerTelemetryFreshForMotion: true,
      followerHardwareMotionSafety: TEST_HARDWARE_SAFETY_REJECTED,
      targetMismatch: false,
    };

    expect(
      resolveBlockedOperatorControlMessage({
        ...baseParams,
        collaborationTeleopPermitted: false,
      }),
    ).toBe("This collaboration link does not include teleop permission.");
    expect(resolveBlockedOperatorControlMessage(baseParams)).toBe(
      "Follower joint feedback missing controlled joints.",
    );
  });

  it("keeps connect disabled until the follower profile, gateway, and role are usable", () => {
    expect(
      resolveFollowerHardwareConnectDisabled({
        leaseBusy: false,
        followerHardwareConnected: false,
        followerHardwareRoleConflict:
          "Disconnect this device as leader before selecting it as follower.",
        followerHardwareProfileAvailable: true,
        gatewayControlCapable: true,
        collaborationTeleopPermitted: true,
      }),
    ).toBe(true);

    expect(
      resolveFollowerHardwareConnectDisabled({
        leaseBusy: false,
        followerHardwareConnected: false,
        followerHardwareDisconnectAvailable: true,
        followerHardwareRoleConflict: null,
        followerHardwareProfileAvailable: false,
        gatewayControlCapable: false,
        collaborationTeleopPermitted: false,
      }),
    ).toBe(false);

    expect(
      resolveFollowerHardwareConnectDisabled({
        leaseBusy: true,
        followerHardwareConnected: false,
        followerHardwareDisconnectAvailable: true,
        followerHardwareRoleConflict: null,
        followerHardwareProfileAvailable: false,
        gatewayControlCapable: false,
        collaborationTeleopPermitted: false,
      }),
    ).toBe(true);

    expect(
      resolveFollowerHardwareConnectDisabled({
        leaseBusy: false,
        followerHardwareConnected: false,
        followerHardwareRoleConflict: null,
        followerHardwareProfileAvailable: true,
        gatewayControlCapable: true,
        collaborationTeleopPermitted: true,
      }),
    ).toBe(false);
  });

  it("uses the backend safety rejection before generic fallback text", () => {
    expect(
      resolveFollowerHardwareMotionSafetyLabel({
        followerHardwareMotionReady: false,
        followerHardwareMotionSafety: TEST_HARDWARE_SAFETY_REJECTED,
        followerTelemetryFreshForMotion: false,
        followerHardwareConnected: true,
      }),
    ).toBe("Follower joint feedback missing controlled joints.");
  });
});
