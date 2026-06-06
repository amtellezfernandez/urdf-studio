import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import {
  applyWorldLabsSo101DemoTransformToRobot,
  applyWorldLabsSplatGroundProbeToRobot,
  resolveWorldLabsSo101DemoTransform,
} from "./worldLabsSo101DemoTransform";

const WORLD_LABS_PACKAGE_PATH = fileURLToPath(
  new URL(
    "../../../public/world-layouts/world-labs-third-person-controller.world-package.json",
    import.meta.url
  )
);

const loadWorldLabsPackageJointPositions = (): Record<string, number> => {
  const manifest = JSON.parse(readFileSync(WORLD_LABS_PACKAGE_PATH, "utf8")) as {
    world_snapshot?: {
      joint_positions?: Record<string, number>;
    };
  };
  return manifest.world_snapshot?.joint_positions ?? {};
};

const loadWorldLabsPackageProvenance = (): Record<string, unknown> => {
  const manifest = JSON.parse(readFileSync(WORLD_LABS_PACKAGE_PATH, "utf8")) as {
    provenance?: Record<string, unknown>;
  };
  return manifest.provenance ?? {};
};

describe("resolveWorldLabsSo101DemoTransform", () => {
  it("keeps SO101 in metric URDF scale for the World Labs demo world", () => {
    const transform = resolveWorldLabsSo101DemoTransform({
      activePackageId: "world-labs-third-person-controller-open",
      robotName: "so101_new_calib",
    });

    expect(transform.scale).toBe(1);
    expect(transform.rotationRpy).toEqual([0, 0, 0]);
    expect(transform.jointPositions).toMatchObject({
      shoulder_lift: -0.34,
      elbow_flex: -1.32,
      wrist_flex: -0.2,
    });
    expect(transform.splatGroundProbe?.enabled).toBe(true);
    expect(transform.splatGroundProbe?.minConfidence).toBeGreaterThan(0);
  });

  it("keeps the bundled World Labs package pose aligned with the runtime demo pose", () => {
    const transform = resolveWorldLabsSo101DemoTransform({
      activePackageId: "world-labs-third-person-controller-open",
      robotName: "so101_new_calib",
    });

    expect(loadWorldLabsPackageJointPositions()).toEqual(transform.jointPositions);
  });

  it("keeps the World Labs splat and collider at metric scene scale", () => {
    const provenance = loadWorldLabsPackageProvenance();

    expect(provenance.splat_uniform_scale).toBe(1);
    expect(provenance.collider_glb_uniform_scale).toBe(1);
  });

  it("applies the World Labs demo pose directly to parsed robot instances", () => {
    const appliedJointPayloads: Record<string, number>[] = [];
    const robot = new THREE.Group() as THREE.Group & {
      joints: Record<string, THREE.Object3D>;
      setJointValues: (values: Record<string, number>) => void;
    };
    robot.name = "so101_new_calib";
    robot.rotation.set(0.5, -0.25, 0.75);
    robot.scale.setScalar(7);
    robot.joints = {};
    robot.setJointValues = (values) => {
      appliedJointPayloads.push({ ...values });
    };

    const transform = applyWorldLabsSo101DemoTransformToRobot({
      activePackageId: "world-labs-third-person-controller-open",
      robot: robot as unknown as URDFRobot,
    });

    expect(transform.jointPositions).toBeDefined();
    expect(robot.scale.x).toBe(transform.scale);
    expect(robot.scale.y).toBe(transform.scale);
    expect(robot.scale.z).toBe(transform.scale);
    expect([robot.rotation.x, robot.rotation.y, robot.rotation.z]).toEqual(
      transform.rotationRpy
    );
    expect(robot.userData.worldLabsSo101DemoTransform).toBe(transform);
    expect(appliedJointPayloads).toEqual([transform.jointPositions]);
  });

  it("grounds SO101 along the studio Z-up axis", () => {
    const robot = new THREE.Group();
    robot.name = "so101_new_calib";
    const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
    baseMesh.position.z = 0.1;
    robot.add(baseMesh);

    const result = applyWorldLabsSplatGroundProbeToRobot({
      activePackageId: "world-labs-third-person-controller-open",
      robot,
      groundProbe: {
        packageId: "world-labs-third-person-controller-open",
        probeDown: (originWorld) => {
          expect(originWorld.z).toBeCloseTo(0.8);
          return {
            point: new THREE.Vector3(0, 0, 0.3),
            normal: new THREE.Vector3(0, 0, 1),
            confidence: 1,
            hitCount: 9,
            sampleCount: 9,
            maxPlaneResidual: 0,
            sampleRadius: 0.08,
            source: "spark-splat-raycast",
          };
        },
      },
    });

    expect(result).toEqual({ applied: true, reason: "applied" });
    expect(robot.position.z).toBeCloseTo(0.31);
    expect(robot.position.y).toBe(0);
  });

  it("leaves non-demo robots unchanged", () => {
    const transform = resolveWorldLabsSo101DemoTransform({
      activePackageId: "world-labs-third-person-controller-open",
      robotName: "other_robot",
    });

    expect(transform.scale).toBe(1);
    expect(transform.rotationRpy).toEqual([0, 0, 0]);
    expect(transform.splatGroundProbe).toBeUndefined();
  });
});
