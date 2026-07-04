import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  extractLinkWorldPose,
  resolveHierarchyTreeViewEmptyState,
  resolveHierarchyTreeViewErrorState,
  resolveNextEndEffectorLink,
} from "@/features/layout/hierarchyTreeViewHelpers";

describe("hierarchyTreeViewHelpers", () => {
  it("resolves the hierarchy empty state", () => {
    expect(
      resolveHierarchyTreeViewEmptyState({
        hasHierarchyTree: false,
        rootLinkCount: 0,
      })
    ).toBe("No joints found");
    expect(
      resolveHierarchyTreeViewEmptyState({
        hasHierarchyTree: true,
        rootLinkCount: 1,
      })
    ).toBe("");
  });

  it("resolves the hierarchy error state", () => {
    expect(resolveHierarchyTreeViewErrorState()).toBe(
      "Error rendering hierarchy view. Check console for details."
    );
  });

  it("toggles the end effector selection for a link", () => {
    expect(
      resolveNextEndEffectorLink({
        currentEndEffectorLink: "tool0",
        linkName: "tool0",
      })
    ).toBeNull();
    expect(
      resolveNextEndEffectorLink({
        currentEndEffectorLink: "wrist",
        linkName: "tool0",
      })
    ).toBe("tool0");
  });

  it("extracts a link world pose from the robot link object", () => {
    const linkObject = new THREE.Object3D();
    linkObject.name = "tool0";
    linkObject.position.set(1, 2, 3);
    linkObject.quaternion.setFromEuler(new THREE.Euler(0.1, 0.2, 0.3));
    linkObject.updateMatrixWorld(true);

    const robot = {
      links: { tool0: linkObject },
      getObjectByName: (name: string) => (name === "tool0" ? linkObject : null),
    } as unknown as import("urdf-loader").URDFRobot;

    const pose = extractLinkWorldPose(robot, "tool0");
    expect(pose?.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(pose?.quaternion.w).toBeCloseTo(linkObject.quaternion.w);
    expect(pose?.quaternion.x).toBeCloseTo(linkObject.quaternion.x);
    expect(pose?.quaternion.y).toBeCloseTo(linkObject.quaternion.y);
    expect(pose?.quaternion.z).toBeCloseTo(linkObject.quaternion.z);
  });
});
