import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import {
  buildWorldObjectObstacleBounds,
  computeRobotMeshMinWorldZ,
  evaluateRobotJointPoseFloorContact,
  STUDIO_ROBOT_FLOOR_CLEARANCE_M,
} from "@/features/viewer/robotFloorContact";
import type { CreatedObject } from "@/features/objects";

const createRobotWithToolMesh = (): URDFRobot => {
  const robot = new THREE.Group() as unknown as URDFRobot;
  const tool = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, 0.04),
    new THREE.MeshBasicMaterial()
  );

  robot.setJointValues = (values: Record<string, number>) => {
    const value = values.head_z;
    if (Number.isFinite(value)) {
      tool.position.z = value;
    }
    return true;
  };
  tool.name = "head";
  tool.position.z = 0.04;
  robot.add(tool);
  robot.updateMatrixWorld(true);
  return robot;
};

describe("robotFloorContact", () => {
  it("computes the lowest robot mesh point in world space", () => {
    const robot = createRobotWithToolMesh();

    expect(computeRobotMeshMinWorldZ(robot)).toBeCloseTo(0.02);
  });

  it("rejects candidate joint poses that put robot geometry below the floor", () => {
    const robot = createRobotWithToolMesh();

    const result = evaluateRobotJointPoseFloorContact({
      robot,
      candidateJointValues: { head_z: 0.0 },
      restoreJointValues: { head_z: 0.04 },
    });

    expect(result.safe).toBe(false);
    expect(result.penetrationM).toBeGreaterThan(STUDIO_ROBOT_FLOOR_CLEARANCE_M);
    expect(computeRobotMeshMinWorldZ(robot)).toBeCloseTo(0.02);
  });

  it("accepts candidate joint poses that keep robot geometry above the floor", () => {
    const robot = createRobotWithToolMesh();

    const result = evaluateRobotJointPoseFloorContact({
      robot,
      candidateJointValues: { head_z: 0.08 },
      restoreJointValues: { head_z: 0.04 },
    });

    expect(result.safe).toBe(true);
    expect(result.penetrationM).toBe(0);
    expect(computeRobotMeshMinWorldZ(robot)).toBeCloseTo(0.02);
  });

  it("accepts candidate poses when an existing floor artifact is not worsened", () => {
    const robot = createRobotWithToolMesh();
    const floorArtifact = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.02),
      new THREE.MeshBasicMaterial()
    );
    floorArtifact.position.z = -0.005;
    robot.add(floorArtifact);
    robot.updateMatrixWorld(true);

    const result = evaluateRobotJointPoseFloorContact({
      robot,
      candidateJointValues: { head_z: 0.08 },
      restoreJointValues: { head_z: 0.04 },
    });

    expect(result.safe).toBe(true);
    expect(result.penetrationM).toBeGreaterThan(0);
    expect(result.baselinePenetrationM).toBeGreaterThan(0);
    expect(computeRobotMeshMinWorldZ(robot)).toBeCloseTo(-0.015);
  });

  it("rejects candidate poses that deeply intersect solid obstacle bounds", () => {
    const robot = createRobotWithToolMesh();

    const result = evaluateRobotJointPoseFloorContact({
      robot,
      candidateJointValues: { head_z: 0.04 },
      restoreJointValues: { head_z: 0.04 },
      obstacleBounds: [
        {
          id: "container-a",
          bounds: new THREE.Box3(
            new THREE.Vector3(-0.04, -0.04, 0.01),
            new THREE.Vector3(0.04, 0.04, 0.07)
          ),
        },
      ],
      objectPenetrationToleranceM: 0.001,
    });

    expect(result.safe).toBe(false);
    expect(result.objectCollision).toEqual({
      obstacleId: "container-a",
      penetrationM: expect.any(Number),
    });
    expect(result.objectCollision?.penetrationM).toBeGreaterThan(0.001);
  });

  it("builds solid bounds for all visible primitive world objects", () => {
    const objects: CreatedObject[] = [
      {
        id: "container-a",
        type: "cube",
        position: new THREE.Vector3(0.2, 0.1, 0.03),
        rotation: new THREE.Euler(0, 0, Math.PI / 4),
        size: new THREE.Vector3(0.1, 0.06, 0.04),
        color: "#ef4444",
        isIkTarget: true,
        trackedJointName: null,
      },
      {
        id: "hidden-container",
        type: "cube",
        position: new THREE.Vector3(),
        size: new THREE.Vector3(0.1, 0.1, 0.1),
        color: "#ef4444",
        isIkTarget: true,
        trackedJointName: null,
        isHidden: true,
      },
    ];

    const bounds = buildWorldObjectObstacleBounds(objects);

    expect(bounds).toHaveLength(1);
    expect(bounds[0]?.id).toBe("container-a");
    expect(bounds[0]?.bounds.isEmpty()).toBe(false);
  });
});
