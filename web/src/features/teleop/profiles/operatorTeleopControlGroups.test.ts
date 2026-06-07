import { describe, expect, it } from "vitest";

import { buildOperatorTeleopControlGroups } from "@/features/teleop/profiles/operatorTeleopControlGroups";

describe("operatorTeleopControlGroups", () => {
  it("keeps SO101 wrist roll as an arm joint when it parents the gripper link", () => {
    const groups = buildOperatorTeleopControlGroups({
      jointNames: [
        "gripper_frame_joint",
        "gripper",
        "wrist_roll",
        "wrist_flex",
        "elbow_flex",
        "shoulder_lift",
        "shoulder_pan",
      ],
      jointTopologyByName: {
        gripper_frame_joint: {
          name: "gripper_frame_joint",
          type: "fixed",
          parentLinkName: "gripper_link",
          childLinkNames: ["gripper_frame_link"],
        },
        gripper: {
          name: "gripper",
          type: "revolute",
          parentLinkName: "gripper_link",
          childLinkNames: ["moving_jaw_so101_v1"],
        },
        wrist_roll: {
          name: "wrist_roll",
          type: "revolute",
          parentLinkName: "wrist_link",
          childLinkNames: ["gripper_link"],
        },
        wrist_flex: {
          name: "wrist_flex",
          type: "revolute",
          parentLinkName: "lower_arm_link",
          childLinkNames: ["wrist_link"],
        },
        elbow_flex: {
          name: "elbow_flex",
          type: "revolute",
          parentLinkName: "upper_arm_link",
          childLinkNames: ["lower_arm_link"],
        },
        shoulder_lift: {
          name: "shoulder_lift",
          type: "revolute",
          parentLinkName: "shoulder_link",
          childLinkNames: ["upper_arm_link"],
        },
        shoulder_pan: {
          name: "shoulder_pan",
          type: "revolute",
          parentLinkName: "base_link",
          childLinkNames: ["shoulder_link"],
        },
      },
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: "arm.primary",
      kind: "arm",
      teleopEnabled: true,
      endEffectorJointNames: ["gripper"],
    });
    expect(groups[0]?.jointNames).toEqual([
      "gripper",
      "wrist_roll",
      "wrist_flex",
      "elbow_flex",
      "shoulder_lift",
      "shoulder_pan",
    ]);
  });

  it("maps an SO100-style leader as one arm with the gripper inside the arm group", () => {
    const groups = buildOperatorTeleopControlGroups({
      jointNames: [
        "shoulder_pan",
        "shoulder_lift",
        "elbow_flex",
        "wrist_flex",
        "wrist_roll",
        "gripper",
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: "arm.primary",
      kind: "arm",
      teleopEnabled: true,
      endEffectorJointNames: ["gripper"],
    });
    expect(groups[0]?.jointNames).toEqual([
      "elbow_flex",
      "gripper",
      "shoulder_lift",
      "shoulder_pan",
      "wrist_flex",
      "wrist_roll",
    ]);
  });

  it("keeps the crane fixed base out of the enabled arm target", () => {
    const groups = buildOperatorTeleopControlGroups({
      jointNames: ["anchor", "base_yaw", "boom_luff", "finger_slide"],
      jointLimits: {
        anchor: { type: "fixed", lower: 0, upper: 0 },
        base_yaw: { type: "fixed", lower: 0, upper: 0 },
        boom_luff: { type: "revolute", lower: -0.6, upper: 1.2 },
        finger_slide: { type: "prismatic", lower: 0, upper: 0.02 },
      },
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: "arm.primary",
      kind: "arm",
      teleopEnabled: true,
      endEffectorJointNames: ["finger_slide"],
    });
    expect(groups[0]?.jointNames).toEqual([
      "boom_luff",
      "finger_slide",
    ]);
  });

  it("keeps LeKiwi wheels visible but disabled while the arm remains enabled", () => {
    const groups = buildOperatorTeleopControlGroups({
      jointNames: [
        "arm_shoulder_pan",
        "arm_shoulder_lift",
        "arm_elbow_flex",
        "arm_wrist_flex",
        "arm_wrist_roll",
        "arm_gripper",
        "base_left_wheel_joint",
        "base_right_wheel_joint",
        "base_back_wheel_joint",
      ],
    });

    expect(groups.map((group) => group.id)).toEqual([
      "arm.primary",
      "wheel_base.primary",
    ]);
    expect(groups[0]).toMatchObject({
      kind: "arm",
      teleopEnabled: true,
      endEffectorJointNames: ["arm_gripper"],
    });
    expect(groups[1]).toMatchObject({
      kind: "wheel_base",
      teleopEnabled: false,
      disabledReason: "Wheel teleop is not enabled yet.",
    });
    expect(groups[1]?.jointNames).toEqual([
      "base_back_wheel_joint",
      "base_left_wheel_joint",
      "base_right_wheel_joint",
    ]);
  });

  it("uses URDF topology to detect CAD-named LeKiwi-style arm joints", () => {
    const wheelJoints = [
      "ST3215_Servo_Motor-v1-2_Revolute-60",
      "ST3215_Servo_Motor-v1-1_Revolute-62",
      "ST3215_Servo_Motor-v1_Revolute-64",
    ];
    const armJoints = [
      "STS3215_03a-v1_Revolute-45",
      "STS3215_03a-v1-1_Revolute-49",
      "STS3215_03a-v1-2_Revolute-51",
      "STS3215_03a-v1-3_Revolute-53",
      "STS3215_03a_Wrist_Roll-v1_Revolute-55",
      "STS3215_03a-v1-4_Revolute-57",
    ];
    const fixedArmAssemblyJoints = [
      "Rotation_Pitch_08i-v1_Rigid-46",
      "SO_ARM100_08k_116_Square-v1_Rigid-50",
      "Wrist_Roll_08c-v1_Rigid-56",
    ];
    const groups = buildOperatorTeleopControlGroups({
      jointNames: [...wheelJoints, ...armJoints, ...fixedArmAssemblyJoints],
      jointTopologyByName: {
        [wheelJoints[0]]: {
          name: wheelJoints[0],
          type: "continuous",
          parentLinkName: "drive_motor_mount-v11-2",
          childLinkNames: ["omni_wheel_mount-v5-2"],
        },
        [wheelJoints[1]]: {
          name: wheelJoints[1],
          type: "continuous",
          parentLinkName: "drive_motor_mount-v11-1",
          childLinkNames: ["omni_wheel_mount-v5-1"],
        },
        [wheelJoints[2]]: {
          name: wheelJoints[2],
          type: "continuous",
          parentLinkName: "drive_motor_mount-v11",
          childLinkNames: ["omni_wheel_mount-v5"],
        },
        [armJoints[0]]: {
          name: armJoints[0],
          type: "continuous",
          parentLinkName: "STS3215_03a-v1",
          childLinkNames: ["Rotation_Pitch_08i-v1"],
        },
        [armJoints[1]]: {
          name: armJoints[1],
          type: "continuous",
          parentLinkName: "STS3215_03a-v1-1",
          childLinkNames: ["SO_ARM100_08k_116_Square-v1"],
        },
        [armJoints[2]]: {
          name: armJoints[2],
          type: "continuous",
          parentLinkName: "STS3215_03a-v1-2",
          childLinkNames: ["SO_ARM100_08k_Mirror-v1"],
        },
        [armJoints[3]]: {
          name: armJoints[3],
          type: "continuous",
          parentLinkName: "STS3215_03a-v1-3",
          childLinkNames: ["Wrist_Roll_Pitch_08i-v1"],
        },
        [armJoints[4]]: {
          name: armJoints[4],
          type: "continuous",
          parentLinkName: "STS3215_03a_Wrist_Roll-v1",
          childLinkNames: ["Wrist_Roll_08c-v1"],
        },
        [armJoints[5]]: {
          name: armJoints[5],
          type: "continuous",
          parentLinkName: "STS3215_03a-v1-4",
          childLinkNames: ["Moving_Jaw_08d-v1"],
        },
        [fixedArmAssemblyJoints[0]]: {
          name: fixedArmAssemblyJoints[0],
          type: "fixed",
          parentLinkName: "Rotation_Pitch_08i-v1",
          childLinkNames: ["SO_ARM100_08k_Asym_Mirror_Clip-v1"],
        },
        [fixedArmAssemblyJoints[1]]: {
          name: fixedArmAssemblyJoints[1],
          type: "fixed",
          parentLinkName: "SO_ARM100_08k_116_Square-v1",
          childLinkNames: ["STS3215_03a-v1-2"],
        },
        [fixedArmAssemblyJoints[2]]: {
          name: fixedArmAssemblyJoints[2],
          type: "fixed",
          parentLinkName: "Wrist_Roll_08c-v1",
          childLinkNames: ["STS3215_03a-v1-4"],
        },
      },
    });

    expect(groups.map((group) => group.id)).toEqual([
      "arm.primary",
      "wheel_base.primary",
    ]);
    expect(groups[0]).toMatchObject({
      kind: "arm",
      teleopEnabled: true,
      endEffectorJointNames: ["STS3215_03a-v1-4_Revolute-57"],
    });
    expect(groups[0]?.jointNames).toEqual(armJoints);
    expect(groups[1]).toMatchObject({
      kind: "wheel_base",
      teleopEnabled: false,
    });
    expect(groups[1]?.jointNames).toEqual([
      "ST3215_Servo_Motor-v1_Revolute-64",
      "ST3215_Servo_Motor-v1-1_Revolute-62",
      "ST3215_Servo_Motor-v1-2_Revolute-60",
    ]);
  });

  it("detects legs but leaves them non-clickable for the current teleop scope", () => {
    const groups = buildOperatorTeleopControlGroups({
      jointNames: ["left_hip_yaw", "left_knee", "right_hip_yaw", "right_knee"],
    });

    expect(groups).toEqual([
      {
        id: "leg.primary",
        kind: "leg",
        label: "Legs",
        jointNames: ["left_hip_yaw", "left_knee", "right_hip_yaw", "right_knee"],
        endEffectorJointNames: [],
        teleopEnabled: false,
        disabledReason: "Leg teleop is not enabled yet.",
      },
    ]);
  });

  it("splits explicit left and right arms while preserving center gripper joints in the left group", () => {
    const groups = buildOperatorTeleopControlGroups({
      jointNames: [
        "left_shoulder_pan",
        "left_elbow_flex",
        "right_shoulder_pan",
        "right_elbow_flex",
        "gripper",
      ],
    });

    expect(groups.map((group) => group.id)).toEqual(["arm.left", "arm.right"]);
    expect(groups[0]?.jointNames).toEqual([
      "gripper",
      "left_elbow_flex",
      "left_shoulder_pan",
    ]);
    expect(groups[0]?.endEffectorJointNames).toEqual(["gripper"]);
    expect(groups[1]?.jointNames).toEqual([
      "right_elbow_flex",
      "right_shoulder_pan",
    ]);
  });

  it("maps OpenArm as two enabled arms and does not expose fixed structural joints", () => {
    const groups = buildOperatorTeleopControlGroups({
      jointNames: [
        "openarm_body_world_joint",
        "openarm_left_openarm_body_link0_joint",
        "openarm_left_joint1",
        "openarm_left_joint2",
        "openarm_left_joint3",
        "openarm_left_joint4",
        "openarm_left_joint5",
        "openarm_left_joint6",
        "openarm_left_joint7",
        "left_openarm_hand_joint",
        "openarm_left_hand_tcp_joint",
        "openarm_left_finger_joint1",
        "openarm_left_finger_joint2",
        "openarm_right_openarm_body_link0_joint",
        "openarm_right_joint1",
        "openarm_right_joint2",
        "openarm_right_joint3",
        "openarm_right_joint4",
        "openarm_right_joint5",
        "openarm_right_joint6",
        "openarm_right_joint7",
        "right_openarm_hand_joint",
        "openarm_right_hand_tcp_joint",
        "openarm_right_finger_joint1",
        "openarm_right_finger_joint2",
        "unrelated_visual_joint",
      ],
    });

    expect(groups.map((group) => group.id)).toEqual(["arm.left", "arm.right"]);
    expect(groups[0]).toMatchObject({
      id: "arm.left",
      teleopEnabled: true,
      endEffectorJointNames: [
        "openarm_left_finger_joint1",
        "openarm_left_finger_joint2",
      ],
    });
    expect(groups[0]?.jointNames).toEqual([
      "openarm_left_finger_joint1",
      "openarm_left_finger_joint2",
      "openarm_left_joint1",
      "openarm_left_joint2",
      "openarm_left_joint3",
      "openarm_left_joint4",
      "openarm_left_joint5",
      "openarm_left_joint6",
      "openarm_left_joint7",
    ]);
    expect(groups[1]).toMatchObject({
      id: "arm.right",
      teleopEnabled: true,
      endEffectorJointNames: [
        "openarm_right_finger_joint1",
        "openarm_right_finger_joint2",
      ],
    });
    expect(groups[1]?.jointNames).toEqual([
      "openarm_right_finger_joint1",
      "openarm_right_finger_joint2",
      "openarm_right_joint1",
      "openarm_right_joint2",
      "openarm_right_joint3",
      "openarm_right_joint4",
      "openarm_right_joint5",
      "openarm_right_joint6",
      "openarm_right_joint7",
    ]);
  });
});
