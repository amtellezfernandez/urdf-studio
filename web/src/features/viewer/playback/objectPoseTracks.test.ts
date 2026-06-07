import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import type { CreatedObject } from "@/features/objects";
import {
  applyPlaybackObjectPoses,
  findPlaybackObjectByTrackId,
} from "@/features/viewer/playback/objectPoseTracks";

const buildObject = (overrides?: Partial<CreatedObject>): CreatedObject => ({
  id: "object-1",
  label: "red pickup cube",
  type: "cube",
  position: new THREE.Vector3(0, 0, 0),
  rotation: new THREE.Euler(0, 0, 0),
  size: new THREE.Vector3(0.05, 0.05, 0.05),
  color: "#ff1f1f",
  source: "demo-world",
  trackedJointName: null,
  isIkTarget: true,
  ikTargetType: "punctual",
  ...overrides,
});

describe("object pose tracks", () => {
  it("resolves generated world-layout objects by stable label", () => {
    const object = buildObject({ id: "object-17" });

    expect(findPlaybackObjectByTrackId([object], "Red   Pickup Cube")).toBe(object);
  });

  it("applies playback poses without recording object-edit history", () => {
    const object = buildObject();
    const updateObjectPosition = vi.fn();
    const updateObjectRotation = vi.fn();
    const setObjectHidden = vi.fn();

    applyPlaybackObjectPoses(
      {
        "red pickup cube": {
          position: { x: 0.1, y: 0.2, z: 0.3 },
          rotation: { x: 0, y: 0, z: 0.4 },
          isHidden: false,
        },
      },
      {
        objects: [object],
        updateObjectPosition,
        updateObjectRotation,
        setObjectHidden,
      }
    );

    expect(updateObjectPosition).toHaveBeenCalledWith(
      "object-1",
      expect.objectContaining({ x: 0.1, y: 0.2, z: 0.3 }),
      { trackHistory: false }
    );
    expect(updateObjectRotation).toHaveBeenCalledWith(
      "object-1",
      expect.objectContaining({ z: 0.4 }),
      { trackHistory: false }
    );
    expect(setObjectHidden).not.toHaveBeenCalled();
  });
});
