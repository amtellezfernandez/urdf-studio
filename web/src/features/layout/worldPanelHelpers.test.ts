import { describe, expect, it } from "vitest";
import * as THREE from "three";

import type { CreatedObject } from "@/features/objects";
import {
  buildWorldObjectGroups,
  toReadableWorldSourceLabel,
  toWorldObjectDisplayName,
} from "@/features/layout/worldPanelHelpers";

const createObject = (overrides: Partial<CreatedObject>): CreatedObject => ({
  id: "object-0",
  type: "cube",
  position: new THREE.Vector3(),
  size: new THREE.Vector3(1, 1, 1),
  color: "#fff",
  trackedJointName: null,
  isIkTarget: false,
  ...overrides,
});

describe("worldPanelHelpers", () => {
  it("formats readable source labels", () => {
    expect(toReadableWorldSourceLabel("motion-plan")).toBe("Motion Plan");
    expect(toReadableWorldSourceLabel("scene_objects")).toBe("Scene Objects");
  });

  it("formats display names for generated and custom object ids", () => {
    expect(toWorldObjectDisplayName(createObject({ id: "object-7", type: "sphere" }))).toBe(
      "Sphere 7"
    );
    expect(toWorldObjectDisplayName(createObject({ id: "fixture_a", type: "cube" }))).toBe(
      "Cube fixture_a"
    );
  });

  it("groups world objects by source and sorts by configured source order", () => {
    const groups = buildWorldObjectGroups({
      objects: [
        createObject({ id: "object-3", source: "demo-world" }),
        createObject({ id: "object-1", source: "user" }),
        createObject({ id: "object-2", source: "demo-world" }),
      ],
      sourceOrder: ["user", "demo-world", "world-scenario"],
      sourceLabels: {
        user: "User Objects",
        "demo-world": "Demo World Objects",
        "world-scenario": "Scenario Objects",
      },
    });

    expect(groups.map((group) => group.source)).toEqual(["user", "demo-world"]);
    expect(groups[1]?.objects.map((object) => object.id)).toEqual(["object-2", "object-3"]);
    expect(groups[0]?.label).toBe("User Objects");
  });

  it("falls back to readable labels for unknown sources", () => {
    const groups = buildWorldObjectGroups({
      objects: [createObject({ id: "object-9", source: "sim-cache" as never })],
      sourceOrder: ["user", "demo-world", "world-scenario"],
      sourceLabels: {
        user: "User Objects",
        "demo-world": "Demo World Objects",
        "world-scenario": "Scenario Objects",
      },
    });

    expect(groups[0]?.label).toBe("Sim Cache Objects");
  });
});
