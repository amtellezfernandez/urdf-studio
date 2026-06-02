import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import { clampWorldTargetToArmReach, resolveArmReachEnvelope } from "./armReach";

const MAX_LINK_TRAVERSAL = 32;
const REACH_DISTANCE_METERS = 1.0;
const TARGET_OUTSIDE_X = 1.4;
const TARGET_INSIDE_X = 0.8;
const ASSERT_EPSILON = 1e-8;

const createAnalysis = (): UrdfAnalysis =>
  ({
    isValid: true,
    rootLinks: ["base_link"],
    jointByChildLink: {
      ee_link: {
        parentLink: "base_link",
        childLink: "ee_link",
        origin: [REACH_DISTANCE_METERS, 0, 0],
        axis: [0, 0, 1],
        type: "fixed",
        limitLower: null,
        limitUpper: null,
      },
    },
  }) as unknown as UrdfAnalysis;

describe("armReach", () => {
  it("resolves strict arm reach envelope from active EE chain", () => {
    const robot = new THREE.Group() as unknown as URDFRobot;
    const base = new THREE.Group();
    base.name = "base_link";
    robot.add(base);
    robot.updateMatrixWorld(true);

    const envelope = resolveArmReachEnvelope({
      robot,
      urdfAnalysis: createAnalysis(),
      endEffectorLink: "ee_link",
      maxLinkTraversal: MAX_LINK_TRAVERSAL,
    });
    expect(envelope).not.toBeNull();
    expect(envelope!.radiusMeters).toBeCloseTo(REACH_DISTANCE_METERS, 8);
    expect(envelope!.baseLinkName).toBe("base_link");
    expect(envelope!.basePositionWorld.length()).toBeLessThan(ASSERT_EPSILON);
  });

  it("clamps only targets outside strict reach radius", () => {
    const envelope = {
      baseLinkName: "base_link",
      basePositionWorld: new THREE.Vector3(0, 0, 0),
      radiusMeters: REACH_DISTANCE_METERS,
    };

    const outside = clampWorldTargetToArmReach(
      new THREE.Vector3(TARGET_OUTSIDE_X, 0, 0),
      envelope,
      new THREE.Vector3()
    );
    expect(outside.clamped).toBe(true);
    expect(outside.targetWorld.x).toBeCloseTo(REACH_DISTANCE_METERS, 8);
    expect(outside.targetWorld.y).toBeCloseTo(0, 8);
    expect(outside.targetWorld.z).toBeCloseTo(0, 8);

    const inside = clampWorldTargetToArmReach(
      new THREE.Vector3(TARGET_INSIDE_X, 0, 0),
      envelope,
      new THREE.Vector3()
    );
    expect(inside.clamped).toBe(false);
    expect(inside.targetWorld.x).toBeCloseTo(TARGET_INSIDE_X, 8);
  });
});
