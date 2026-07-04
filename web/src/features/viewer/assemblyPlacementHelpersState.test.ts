import { describe, expect, it } from "vitest";

import {
  buildAssemblyContactRobotIds,
  buildAssemblyContactSegments,
  parseAssemblyContactPair,
  resolveAssemblyHelperRadius,
  resolveAssemblySelectedGuide,
} from "@/features/viewer/assemblyPlacementHelpersState";

describe("assemblyPlacementHelpersState", () => {
  it("parses assembly contact pair keys", () => {
    expect(parseAssemblyContactPair("arm::tool")).toEqual(["arm", "tool"]);
    expect(parseAssemblyContactPair("arm")).toBeNull();
    expect(parseAssemblyContactPair("arm::")).toBeNull();
    expect(parseAssemblyContactPair("arm::tool::extra")).toBeNull();
  });

  it("builds the contacted robot id set from valid pairs", () => {
    const robotIds = buildAssemblyContactRobotIds([
      "primary::left",
      "bad",
      "primary::right",
    ]);

    expect([...robotIds].sort()).toEqual(["left", "primary", "right"]);
  });

  it("builds contact segments only when both robot poses exist", () => {
    expect(
      buildAssemblyContactSegments({
        contactPairs: ["primary::left", "primary::missing", "bad"],
        poses: {
          primary: { x: 1, y: 0, z: 2, yaw: 0 },
          left: { x: -1, y: 0, z: -2, yaw: 0 },
        },
      })
    ).toEqual([
      {
        id: "primary::left-0",
        from: [1, 0.03, 2],
        to: [-1, 0.03, -2],
      },
    ]);
  });

  it("resolves selected snap and axis guide state against the nearest contact gap", () => {
    const guide = resolveAssemblySelectedGuide({
      selectedRobotId: "selected",
      poses: {
        selected: { x: 1, y: 0, z: 0, yaw: 0 },
        neighbor: { x: 0, y: 0, z: 0, yaw: 0 },
        farther: { x: 3, y: 0, z: 0, yaw: 0 },
      },
      radii: {
        selected: 0.4,
        neighbor: 0.6,
        farther: 0.3,
      },
    });

    expect(guide).toEqual({
      from: [1, 0.035, 0],
      to: [0, 0.035, 0],
      snap: [1, 0.035, 0],
      axisCorner: [0, 0.035, 0],
      axisXAligned: false,
      axisZAligned: true,
      gapMeters: 0,
      isNearContact: true,
    });
  });

  it("uses the selected yaw as the snap direction when two poses overlap", () => {
    const guide = resolveAssemblySelectedGuide({
      selectedRobotId: "selected",
      poses: {
        selected: { x: 0, y: 0, z: 0, yaw: 0 },
        neighbor: { x: 0, y: 0, z: 0, yaw: 0 },
      },
      radii: {
        selected: 0.2,
        neighbor: 0.2,
      },
    });

    expect(guide?.snap).toEqual([0.4, 0.035, 0]);
    expect(guide?.gapMeters).toBeCloseTo(0.4);
    expect(guide?.isNearContact).toBe(false);
  });

  it("clamps missing or tiny helper radii to release-friendly defaults", () => {
    expect(resolveAssemblyHelperRadius(undefined)).toBe(0.22);
    expect(resolveAssemblyHelperRadius(0.01)).toBe(0.08);
    expect(resolveAssemblyHelperRadius(0.3)).toBe(0.3);
  });
});
