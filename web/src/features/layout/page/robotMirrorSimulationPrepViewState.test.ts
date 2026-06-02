import { describe, expect, it } from "vitest";

import { resolveRobotMirrorSimulationPrepViewState } from "@/features/layout/page/robotMirrorSimulationPrepViewState";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import type { RobotMirrorSelectionLink } from "@/features/layout/page/robotMirrorSymmetrySelection";

const ROBOT_MIRROR_CHECK: RobotMirrorSymmetryCheck = {
  averageResidualMeters: 0.0015,
  centeredLinkCount: 1,
  centeredLinkNames: ["STS3215_03a-v1-4"],
  matchedPairs: [],
  matchedPairCount: 3,
  maxResidualMeters: 0.003,
  originMeters: [0, 0, 0],
  pairedGroupCount: 3,
  pairedLinkCount: 6,
  planeLabel: "xz",
  planeNormalWorld: [0, 1, 0],
  reviewGroups: [
    {
      groupKey: "standoff",
      maxResidualMeters: null,
      meshLabel: "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff.stl",
      supportedLinkCount: 0,
      totalLinkCount: 3,
      unsupportedLinkNames: [
        "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-3",
        "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-4",
        "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-5",
      ],
    },
    {
      groupKey: "motor-mount",
      maxResidualMeters: null,
      meshLabel: "drive_motor_mount-v11.stl",
      supportedLinkCount: 0,
      totalLinkCount: 3,
      unsupportedLinkNames: [
        "drive_motor_mount-v11",
        "drive_motor_mount-v11-1",
        "drive_motor_mount-v11-2",
      ],
    },
  ],
  reviewLinkCount: 6,
  supportedGroupCount: 3,
  supportedLinkCount: 7,
  supportedLinkNames: [
    "arm_left",
    "arm_right",
    "ST3215_Servo_Motor-v1",
    "ST3215_Servo_Motor-v1-1",
    "ST3215_Servo_Motor-v1-2",
    "wheel_left",
    "wheel_right",
  ],
  totalRepeatedLinkCount: 13,
};

const ROBOT_MIRROR_SELECTION_LINKS: RobotMirrorSelectionLink[] = [
  {
    counterpartLinkName: null,
    defaultExclusionReason: null,
    groupKey: "standoff",
    groupLinkCount: 3,
    linkName: "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-3",
    meshLabel: "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff.stl",
    preselected: false,
    status: "review",
  },
  {
    counterpartLinkName: null,
    defaultExclusionReason: null,
    groupKey: "motor-mount",
    groupLinkCount: 3,
    linkName: "drive_motor_mount-v11-1",
    meshLabel: "drive_motor_mount-v11.stl",
    preselected: false,
    status: "review",
  },
  {
    counterpartLinkName: null,
    defaultExclusionReason: null,
    groupKey: "sensor",
    groupLinkCount: 1,
    linkName: "sensor_center",
    meshLabel: "sensor.stl",
    preselected: false,
    status: "available",
  },
];

describe("resolveRobotMirrorSimulationPrepViewState", () => {
  it("promotes live plane-touching review links into centered support", () => {
    const result = resolveRobotMirrorSimulationPrepViewState({
      robotMirrorSelectionLinks: ROBOT_MIRROR_SELECTION_LINKS,
      robotMirrorSymmetryCheck: ROBOT_MIRROR_CHECK,
      robotMirrorPlaneTouchingLinkNames: [
        "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-3",
        "drive_motor_mount-v11-1",
        "sensor_center",
      ],
    });

    expect(result.robotMirrorSymmetryCheck?.centeredLinkNames).toEqual([
      "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-3",
      "drive_motor_mount-v11-1",
      "sensor_center",
      "STS3215_03a-v1-4",
    ]);
    expect(result.robotMirrorSymmetryCheck?.supportedLinkCount).toBe(10);
    expect(result.robotMirrorSymmetryCheck?.supportedGroupCount).toBe(6);
    expect(result.robotMirrorSymmetryCheck?.reviewLinkCount).toBe(4);
    expect(result.robotMirrorSymmetryCheck?.totalRepeatedLinkCount).toBe(13);
    expect(result.robotMirrorSymmetryCheck?.reviewGroups).toEqual([
      {
        groupKey: "standoff",
        maxResidualMeters: null,
        meshLabel: "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff.stl",
        supportedLinkCount: 1,
        totalLinkCount: 3,
        unsupportedLinkNames: [
          "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-4",
          "94868A713_NO-THREADS_Female-Threaded-Hex-Standoff-5",
        ],
      },
      {
        groupKey: "motor-mount",
        maxResidualMeters: null,
        meshLabel: "drive_motor_mount-v11.stl",
        supportedLinkCount: 1,
        totalLinkCount: 3,
        unsupportedLinkNames: [
          "drive_motor_mount-v11",
          "drive_motor_mount-v11-2",
        ],
      },
    ]);
    expect(result.robotMirrorSelectionLinks).toEqual([
      {
        ...ROBOT_MIRROR_SELECTION_LINKS[0],
        status: "centered",
      },
      {
        ...ROBOT_MIRROR_SELECTION_LINKS[1],
        status: "centered",
      },
      {
        ...ROBOT_MIRROR_SELECTION_LINKS[2],
        status: "centered",
      },
    ]);
  });
});
