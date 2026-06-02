import { describe, expect, it } from "vitest";
import type { URDFRobot } from "urdf-loader";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import { buildMotionPartitions } from "./partition";

const mockRobot = (jointNames: string[]): URDFRobot =>
  ({
    joints: Object.fromEntries(jointNames.map((jointName) => [jointName, {}])),
  }) as unknown as URDFRobot;

const mockAnalysis = (): UrdfAnalysis =>
  ({
    jointHierarchy: {
      orderedJoints: [
        {
          jointName: "shoulder_shared",
          parentLink: "base_link",
          childLink: "torso_link",
        },
        {
          jointName: "left_elbow",
          parentLink: "torso_link",
          childLink: "left_forearm",
        },
        {
          jointName: "right_elbow",
          parentLink: "torso_link",
          childLink: "right_forearm",
        },
      ],
    },
    jointByChildLink: {
      torso_link: {
        parentLink: "base_link",
      },
      left_forearm: {
        parentLink: "torso_link",
      },
      right_forearm: {
        parentLink: "torso_link",
      },
    },
  }) as unknown as UrdfAnalysis;

describe("buildMotionPartitions", () => {
  it("splits manipulator ownership and isolates shared chain joints", () => {
    const partitions = buildMotionPartitions({
      robot: mockRobot([
        "left_elbow",
        "right_elbow",
        "shoulder_shared",
        "left_wheel_joint",
      ]),
      urdfAnalysis: mockAnalysis(),
      endEffectorLinks: ["left_forearm", "right_forearm"],
    });

    expect(partitions.manipulators).toHaveLength(2);
    const left = partitions.manipulators.find((item) => item.endEffectorLink === "left_forearm");
    const right = partitions.manipulators.find(
      (item) => item.endEffectorLink === "right_forearm"
    );
    expect(left?.ownedJointNames).toContain("left_elbow");
    expect(right?.ownedJointNames).toContain("right_elbow");
    expect(left?.ownedJointNames).not.toContain("shoulder_shared");
    expect(right?.ownedJointNames).not.toContain("shoulder_shared");
    expect(partitions.baseJointNames).toEqual(["left_wheel_joint"]);
  });
});
