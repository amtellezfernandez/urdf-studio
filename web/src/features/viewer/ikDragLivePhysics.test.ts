import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { CreatedObject } from "@/features/objects";
import {
  IK_DRAG_LIVE_PHYSICS_FRAME_MAP,
  IK_DRAG_LIVE_PHYSICS_GRIPPER_OPENING_M,
  IK_DRAG_LIVE_PHYSICS_START_GRIPPER_OPENING_M,
  buildIkDragLivePhysicsSample,
  buildIkDragLivePhysicsWorldLayout,
} from "@/features/viewer/ikDragLivePhysics";

const createObject = (overrides: Partial<CreatedObject> = {}): CreatedObject => ({
  id: "red-cube",
  label: "Red cube",
  type: "cube",
  position: new THREE.Vector3(0.1, 0.2, 0.3),
  rotation: new THREE.Euler(0.1, 0.2, 0.3, "XYZ"),
  size: new THREE.Vector3(0.05, 0.05, 0.05),
  color: "#ff1f1f",
  trackedJointName: null,
  isIkTarget: true,
  source: "user",
  ...overrides,
});

describe("ikDragLivePhysics", () => {
  it("keeps live physics in the viewer Z-up frame so containers do not levitate", () => {
    expect(IK_DRAG_LIVE_PHYSICS_FRAME_MAP).toBe("identity");
  });

  it("builds a dynamic MJLab world layout from visible primitive objects", () => {
    const layout = buildIkDragLivePhysicsWorldLayout([
      createObject(),
      createObject({
        id: "point-marker",
        type: "point",
      }),
      createObject({
        id: "hidden-box",
        isHidden: true,
      }),
    ]);

    expect(layout).not.toBeNull();
    const objects = (layout?.world_layout as { objects: unknown[] }).objects as Array<{
      id: string;
      physics: { body_type: string; mass_kg: number; restitution: number };
    }>;
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({
      id: "red-cube",
      physics: {
        body_type: "dynamic",
        restitution: 0,
      },
    });
    expect(objects[0].physics.mass_kg).toBeGreaterThanOrEqual(0.04);
  });

  it("builds dynamic MJLab world layout bodies from HK mesh proxies", () => {
    const layout = buildIkDragLivePhysicsWorldLayout(
      [],
      [
        {
          id: "world-layout-element-physics:grabbable-container-a",
          sourceElementId: "grabbable-container-a",
          name: "small grabbable shipping container",
          positionXyz: [0.1, 0.2, 0.3],
          rotationRpyRad: [0.1, 0.2, 0.3],
          sizeXyz: [0.18, 0.08, 0.07],
          color: "#ef4444",
          physics: {
            bodyType: "dynamic",
            massKg: 0.12,
            friction: 3,
            restitution: 0,
            linearDamping: 1.2,
            angularDamping: 1.2,
          },
        },
      ]
    );

    expect(layout).not.toBeNull();
    const objects = (layout?.world_layout as { objects: unknown[] }).objects as Array<{
      id: string;
      name: string;
      type: string;
      size_xyz: [number, number, number];
      physics: {
        body_type: string;
        mass_kg: number;
        friction: number;
        restitution: number;
      };
    }>;
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({
      id: "world-layout-element-physics:grabbable-container-a",
      name: "small grabbable shipping container",
      type: "cube",
      size_xyz: [0.18, 0.08, 0.07],
      physics: {
        body_type: "dynamic",
        mass_kg: 0.12,
        friction: 3,
        restitution: 0,
      },
    });
  });

  it("returns null when no rigid live physics objects are present", () => {
    expect(
      buildIkDragLivePhysicsWorldLayout([
        createObject({ id: "point", type: "point" }),
        createObject({ id: "hidden", isHidden: true }),
      ])
    ).toBeNull();
  });

  it("converts IK target poses into MJLab end-effector samples", () => {
    const sample = buildIkDragLivePhysicsSample(
      {
        endEffectorLink: "gripper",
        positionXyz: [1, 2, 3],
        quatWxyz: [1, 0, 0, 0],
        timestampMs: 42,
      },
      7
    );

    expect(sample).toEqual({
      sampleIndex: 7,
      timestampMs: 42,
      positionXyz: [1, 2, 3],
      quatWxyz: [1, 0, 0, 0],
      gripperOpeningM: IK_DRAG_LIVE_PHYSICS_GRIPPER_OPENING_M,
    });
    expect(
      buildIkDragLivePhysicsSample(
        {
          endEffectorLink: "gripper",
          positionXyz: [1, 2, 3],
          quatWxyz: [1, 0, 0, 0],
          timestampMs: 42,
          gripperOpeningM: 0.012,
        },
        8
      ).gripperOpeningM
    ).toBe(0.012);
    expect(
      buildIkDragLivePhysicsSample(
        {
          endEffectorLink: "gripper",
          positionXyz: [1, 2, 3],
          quatWxyz: [1, 0, 0, 0],
          timestampMs: 42,
        },
        0,
        IK_DRAG_LIVE_PHYSICS_START_GRIPPER_OPENING_M
      ).gripperOpeningM
    ).toBe(IK_DRAG_LIVE_PHYSICS_START_GRIPPER_OPENING_M);
  });
});
