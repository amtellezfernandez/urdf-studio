import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { syncVisibleIkDragHandlePosition } from "@/features/viewer/ikDragHandlePosition";

describe("syncVisibleIkDragHandlePosition", () => {
  it("locks the visible drag handle exactly onto the desired target", () => {
    const currentPosition = new THREE.Vector3(0.12, -0.04, 0.28);
    const desiredTargetWorld = new THREE.Vector3(1.25, -2.5, 3.75);

    const nextPosition = syncVisibleIkDragHandlePosition({
      currentPosition,
      desiredTargetWorld,
    });

    expect(nextPosition).toBe(currentPosition);
    expect(currentPosition.toArray()).toEqual(desiredTargetWorld.toArray());
  });
});
