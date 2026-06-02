import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import type { JointLimits } from "@/shared/lib/urdfBrowser";
import {
  buildInitialJointMappings,
  reconcileJointMappingsToAvailableUrdfJoints,
} from "@/features/dataset/jointAutoMapping";
import { JOINT_AUTO_MAPPING_PARAMS } from "@/features/dataset/jointAutoMappingParams";

const ACTIVE_LOWER_LIMIT = -1;
const ACTIVE_UPPER_LIMIT = 1;
const LOCKED_LOWER_LIMIT = 0;
const LOCKED_UPPER_LIMIT = 0;
const ACTIVE_JOINT_TYPE = "revolute";
const LOCKED_JOINT_TYPE = "fixed";
const CANONICAL_ARM_DATASET_JOINTS = [
  ...JOINT_AUTO_MAPPING_PARAMS.canonicalArmSemanticOrder,
];
const RIGID_WRIST_JOINT = "Wrist_Roll_Pitch_08i-v1_Rigid-54";
const BASE_SERVO_JOINT = "ST3215_Servo_Motor-v1_Revolute-64";
const STALE_LEKIWI_CAD_WRIST_ROLL_TARGET =
  "STS3215_03a_Wrist_Roll-v1_Revolute-55";
const SEMANTIC_URDF_JOINTS_WITH_EXTRA_GRIPPER_FRAME = [
  "gripper_frame_joint",
  ...CANONICAL_ARM_DATASET_JOINTS.slice().reverse(),
];
const LOCAL_SO101_URDF_PATH = new URL(
  "../../../public/demo/robot.urdf",
  import.meta.url
);
const LOCAL_LEKIWI_URDF_PATH = new URL(
  "../../../public/demo/lekiwi.urdf",
  import.meta.url
);
const URDF_JOINT_BLOCK_PATTERN =
  /<joint\s+name="([^"]+)"\s+type="([^"]+)"[\s\S]*?<\/joint>/g;
const URDF_LIMIT_PATTERN = /<limit\b[^>]*\blower="([^"]+)"[^>]*\bupper="([^"]+)"/;
const LEKIWI_ARM_URDF_JOINT_NAME_PATTERN =
  /^STS3215_03a(?:_Wrist_Roll)?-v1(?:-\d+)?_Revolute-\d+$/;

const buildActiveLimits = (jointNames: string[]): JointLimits =>
  Object.fromEntries(
    jointNames.map((jointName) => [
      jointName,
      {
        type: ACTIVE_JOINT_TYPE,
        lower: ACTIVE_LOWER_LIMIT,
        upper: ACTIVE_UPPER_LIMIT,
      },
    ])
  );

const readLocalUrdfJoints = (url: URL) => {
  const urdfContent = readFileSync(url, "utf8");
  const joints: string[] = [];
  const jointLimits: JointLimits = {};
  for (const match of urdfContent.matchAll(URDF_JOINT_BLOCK_PATTERN)) {
    const [, jointName, jointType] = match;
    if (!jointName || !jointType) {
      continue;
    }
    joints.push(jointName);
    const limitMatch = match[0].match(URDF_LIMIT_PATTERN);
    jointLimits[jointName] = {
      type: jointType,
      lower: limitMatch?.[1] ? Number.parseFloat(limitMatch[1]) : null,
      upper: limitMatch?.[2] ? Number.parseFloat(limitMatch[2]) : null,
    };
  }
  return { joints, jointLimits };
};

const resolveLocalLekiwiArmJoints = () =>
  readLocalUrdfJoints(LOCAL_LEKIWI_URDF_PATH).joints.filter((jointName) =>
    LEKIWI_ARM_URDF_JOINT_NAME_PATTERN.test(jointName)
  );

describe("buildInitialJointMappings", () => {
  it("maps semantic aliases across different delimiters", () => {
    const datasetJoints = [
      "shoulder_pan",
      "shoulder_lift",
      "elbow_flex",
      "wrist_flex",
      "gripper",
    ];
    const urdfJoints = [
      "Shoulder-Yaw_01",
      "Shoulder_Pitch_02",
      "Elbow-Pitch_03",
      "Wrist_Pitch_04",
      "Gripper_Finger_05",
    ];

    const mappings = buildInitialJointMappings({
      datasetJoints,
      urdfJoints,
      jointLimits: buildActiveLimits(urdfJoints),
    });

    expect(mappings).toEqual([
      { datasetJoint: "shoulder_pan", urdfJoint: "Shoulder-Yaw_01" },
      { datasetJoint: "shoulder_lift", urdfJoint: "Shoulder_Pitch_02" },
      { datasetJoint: "elbow_flex", urdfJoint: "Elbow-Pitch_03" },
      { datasetJoint: "wrist_flex", urdfJoint: "Wrist_Pitch_04" },
      { datasetJoint: "gripper", urdfJoint: "Gripper_Finger_05" },
    ]);
  });

  it("avoids locked joints when a movable alternative exists", () => {
    const lockedJoint = "Wrist_Roll_Pitch_08i-v1_Rigid-54";
    const activeJoint = "Wrist_Roll_Active_05";
    const jointLimits: JointLimits = {
      [lockedJoint]: {
        type: LOCKED_JOINT_TYPE,
        lower: LOCKED_LOWER_LIMIT,
        upper: LOCKED_UPPER_LIMIT,
      },
      [activeJoint]: {
        type: ACTIVE_JOINT_TYPE,
        lower: ACTIVE_LOWER_LIMIT,
        upper: ACTIVE_UPPER_LIMIT,
      },
    };

    const mappings = buildInitialJointMappings({
      datasetJoints: ["wrist_roll"],
      urdfJoints: [lockedJoint, activeJoint],
      jointLimits,
    });

    expect(mappings).toEqual([
      { datasetJoint: "wrist_roll", urdfJoint: activeJoint },
    ]);
  });

  it("leaves joints unmapped when there is no meaningful name match", () => {
    const mappings = buildInitialJointMappings({
      datasetJoints: ["shoulder_pan"],
      urdfJoints: ["joint_001"],
      jointLimits: buildActiveLimits(["joint_001"]),
    });

    expect(mappings).toEqual([
      { datasetJoint: "shoulder_pan", urdfJoint: "" },
    ]);
  });

  it("maps canonical arm joints on lekiwi-style urdf names without selecting rigid joints", () => {
    const lekiwiArmUrdfJoints = resolveLocalLekiwiArmJoints();
    const urdfJoints = [
      RIGID_WRIST_JOINT,
      ...lekiwiArmUrdfJoints,
      BASE_SERVO_JOINT,
    ];

    const mappings = buildInitialJointMappings({
      datasetJoints: CANONICAL_ARM_DATASET_JOINTS,
      urdfJoints,
      jointLimits: {},
    });

    expect(mappings).toEqual(
      CANONICAL_ARM_DATASET_JOINTS.map((datasetJoint, index) => ({
        datasetJoint,
        urdfJoint: lekiwiArmUrdfJoints[index],
      }))
    );
  });
});

describe("reconcileJointMappingsToAvailableUrdfJoints", () => {
  it("rewrites saved lekiwi CAD targets to semantic SO arm URDF targets", () => {
    const lekiwiArmUrdfJoints = resolveLocalLekiwiArmJoints();

    const mappings = reconcileJointMappingsToAvailableUrdfJoints({
      datasetJoints: CANONICAL_ARM_DATASET_JOINTS,
      urdfJoints: SEMANTIC_URDF_JOINTS_WITH_EXTRA_GRIPPER_FRAME,
      mappings: CANONICAL_ARM_DATASET_JOINTS.map((datasetJoint, index) => ({
        datasetJoint,
        urdfJoint: lekiwiArmUrdfJoints[index],
      })),
      jointLimits: buildActiveLimits(SEMANTIC_URDF_JOINTS_WITH_EXTRA_GRIPPER_FRAME),
    });

    expect(mappings).toEqual(
      CANONICAL_ARM_DATASET_JOINTS.map((datasetJoint) => ({
        datasetJoint,
        urdfJoint: datasetJoint,
      }))
    );
  });

  it("rewrites saved semantic SO arm targets to lekiwi CAD URDF targets", () => {
    const lekiwiArmUrdfJoints = resolveLocalLekiwiArmJoints();
    const urdfJoints = [
      RIGID_WRIST_JOINT,
      ...lekiwiArmUrdfJoints,
      BASE_SERVO_JOINT,
    ];

    const mappings = reconcileJointMappingsToAvailableUrdfJoints({
      datasetJoints: CANONICAL_ARM_DATASET_JOINTS,
      urdfJoints,
      mappings: CANONICAL_ARM_DATASET_JOINTS.map((datasetJoint) => ({
        datasetJoint,
        urdfJoint: datasetJoint,
      })),
      jointLimits: {},
    });

    expect(mappings).toEqual(
      CANONICAL_ARM_DATASET_JOINTS.map((datasetJoint, index) => ({
        datasetJoint,
        urdfJoint: lekiwiArmUrdfJoints[index],
      }))
    );
  });

  it("keeps saved transforms when the saved URDF target is still available", () => {
    const offset = 0.5;

    const mappings = reconcileJointMappingsToAvailableUrdfJoints({
      datasetJoints: ["wrist_roll"],
      urdfJoints: ["wrist_roll"],
      mappings: [
        {
          datasetJoint: "wrist_roll",
          urdfJoint: "wrist_roll",
          offset,
          inverted: true,
        },
      ],
      jointLimits: buildActiveLimits(["wrist_roll"]),
    });

    expect(mappings).toEqual([
      {
        datasetJoint: "wrist_roll",
        urdfJoint: "wrist_roll",
        offset,
        inverted: true,
      },
    ]);
  });

  it("drops target-specific transforms when replacing a stale URDF target", () => {
    const mappings = reconcileJointMappingsToAvailableUrdfJoints({
      datasetJoints: ["wrist_roll"],
      urdfJoints: ["wrist_roll"],
      mappings: [
        {
          datasetJoint: "wrist_roll",
          urdfJoint: STALE_LEKIWI_CAD_WRIST_ROLL_TARGET,
          offset: 0.5,
          inverted: true,
          limitMode: "shift",
        },
      ],
      jointLimits: buildActiveLimits(["wrist_roll"]),
    });

    expect(mappings).toEqual([
      {
        datasetJoint: "wrist_roll",
        urdfJoint: "wrist_roll",
      },
    ]);
  });

  it("reproduces valid mappings across bundled SO101 and LeKiwi URDFs", () => {
    const so101 = readLocalUrdfJoints(LOCAL_SO101_URDF_PATH);
    const lekiwi = readLocalUrdfJoints(LOCAL_LEKIWI_URDF_PATH);
    const lekiwiArmUrdfJoints = resolveLocalLekiwiArmJoints();

    const so101Mappings = reconcileJointMappingsToAvailableUrdfJoints({
      datasetJoints: CANONICAL_ARM_DATASET_JOINTS,
      urdfJoints: so101.joints,
      mappings: CANONICAL_ARM_DATASET_JOINTS.map((datasetJoint, index) => ({
        datasetJoint,
        urdfJoint: lekiwiArmUrdfJoints[index],
      })),
      jointLimits: so101.jointLimits,
    });
    const lekiwiMappings = reconcileJointMappingsToAvailableUrdfJoints({
      datasetJoints: CANONICAL_ARM_DATASET_JOINTS,
      urdfJoints: lekiwi.joints,
      mappings: CANONICAL_ARM_DATASET_JOINTS.map((datasetJoint) => ({
        datasetJoint,
        urdfJoint: datasetJoint,
      })),
      jointLimits: lekiwi.jointLimits,
    });

    expect(so101Mappings).toEqual(
      CANONICAL_ARM_DATASET_JOINTS.map((datasetJoint) => ({
        datasetJoint,
        urdfJoint: datasetJoint,
      }))
    );
    expect(lekiwiMappings).toEqual(
      CANONICAL_ARM_DATASET_JOINTS.map((datasetJoint, index) => ({
        datasetJoint,
        urdfJoint: lekiwiArmUrdfJoints[index],
      }))
    );
  });
});
