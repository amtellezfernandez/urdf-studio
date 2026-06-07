/** @vitest-environment jsdom */
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { describe, expect, it } from "vitest";

import { analyzeUrdf } from "@/shared/lib/urdfCore";
import {
  buildLivePhysicsGripperTargetPose,
  resolveLivePhysicsGripperTargetLink,
} from "@/features/viewer/gripperPhysicsTarget";

const SO101_GRIPPER_URDF = `<?xml version="1.0"?>
<robot name="so101">
  <link name="base_link" />
  <link name="wrist_link" />
  <link name="gripper_link" />
  <link name="gripper_frame_link" />
  <link name="moving_jaw_so101_v1_link" />

  <joint name="wrist_roll" type="revolute">
    <parent link="wrist_link" />
    <child link="gripper_link" />
    <limit lower="-3.14" upper="3.14" effort="10" velocity="10" />
  </joint>
  <joint name="gripper_frame_joint" type="fixed">
    <origin xyz="-0.0079 -0.000218121 -0.0981274" rpy="0 3.14159 0" />
    <parent link="gripper_link" />
    <child link="gripper_frame_link" />
  </joint>
  <joint name="gripper" type="revolute">
    <parent link="gripper_link" />
    <child link="moving_jaw_so101_v1_link" />
    <limit lower="-0.174533" upper="1.74533" effort="10" velocity="10" />
  </joint>
</robot>`;

const expectTupleClose = (
  actual: readonly number[],
  expected: readonly number[],
  precision = 6
) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((component, index) => {
    expect(component).toBeCloseTo(expected[index] ?? 0, precision);
  });
};

const createRobotWithGripperFrame = () => {
  const robot = new THREE.Object3D() as THREE.Object3D & {
    links: Record<string, THREE.Object3D>;
  };
  const gripperLink = new THREE.Object3D();
  const gripperFrameLink = new THREE.Object3D();
  gripperLink.name = "gripper_link";
  gripperFrameLink.name = "gripper_frame_link";
  gripperLink.position.set(1, 2, 3);
  gripperFrameLink.position.set(0, 0, -0.1);
  robot.add(gripperLink);
  gripperLink.add(gripperFrameLink);
  robot.links = {
    gripper_link: gripperLink,
    gripper_frame_link: gripperFrameLink,
  };
  robot.updateMatrixWorld(true);
  return robot as unknown as URDFRobot;
};

describe("gripperPhysicsTarget", () => {
  it("uses the fixed SO101 gripper frame for live physics instead of the gripper body", () => {
    const analysis = analyzeUrdf(SO101_GRIPPER_URDF);

    expect(
      resolveLivePhysicsGripperTargetLink({
        requestedLink: "gripper_link",
        urdfAnalysis: analysis,
      })
    ).toBe("gripper_frame_link");
  });

  it("avoids the moving jaw as the live physics target and uses the fixed contact frame", () => {
    const analysis = analyzeUrdf(SO101_GRIPPER_URDF);

    expect(
      resolveLivePhysicsGripperTargetLink({
        requestedLink: "moving_jaw_so101_v1_link",
        urdfAnalysis: analysis,
      })
    ).toBe("gripper_frame_link");
  });

  it("applies the selected-link to contact-link transform to dragged IK targets", () => {
    const robot = createRobotWithGripperFrame();

    const pose = buildLivePhysicsGripperTargetPose({
      robot,
      endEffectorLink: "gripper_link",
      physicsTargetLink: "gripper_frame_link",
      targetPositionXyz: [0.25, 0.5, 0.75],
      targetQuatWxyz: [1, 0, 0, 0],
    });

    expect(pose.endEffectorLink).toBe("gripper_frame_link");
    expectTupleClose(pose.positionXyz, [0.25, 0.5, 0.65]);
    expectTupleClose(pose.quatWxyz, [1, 0, 0, 0]);
  });
});
