import { describe, expect, it } from "vitest";

import type { LinkData } from "@/shared/lib/urdfCore";
import { buildRepeatedInertiaDiagnostics } from "@/features/layout/page/repeatedInertiaDiagnostics";

const createMeshLinkData = ({
  inertialOrigin,
  inertia,
  collisionRpy = [0, 0, 0] as [number, number, number],
  mass = 1,
}: {
  inertialOrigin: [number, number, number];
  inertia: NonNullable<LinkData["inertial"]>["inertia"];
  collisionRpy?: [number, number, number];
  mass?: number;
}): LinkData => ({
  name: "part",
  visuals: [],
  inertial: {
    origin: {
      xyz: inertialOrigin,
      rpy: [0, 0, 0],
    },
    mass,
    inertia,
  },
  collisions: [
    {
      origin: {
        xyz: [0, 0, 0],
        rpy: collisionRpy,
      },
      geometry: {
        type: "mesh",
        params: {
          filename: "shared_part.stl",
          scale: "1 1 1",
        },
      },
    },
  ],
});

describe("buildRepeatedInertiaDiagnostics", () => {
  it("reports repeated mesh groups when only viewer confidence differs", () => {
    const diagnostics = buildRepeatedInertiaDiagnostics({
      linkDataByName: {
        wheel_a: createMeshLinkData({
          inertialOrigin: [0.01, 0, 0],
          inertia: {
            ixx: 1,
            ixy: 0,
            ixz: 0,
            iyy: 2,
            iyz: 0,
            izz: 3,
          },
        }),
        wheel_b: createMeshLinkData({
          inertialOrigin: [0, 0.01, 0],
          collisionRpy: [0, 0, Math.PI / 2],
          inertia: {
            ixx: 2,
            ixy: 0,
            ixz: 0,
            iyy: 1,
            iyz: 0,
            izz: 3,
          },
        }),
      },
      reliabilityEntries: [
        {
          linkName: "wheel_a",
          confidence: "high",
          strategy: "principal",
        },
        {
          linkName: "wheel_b",
          confidence: "medium",
          strategy: "principal",
        },
      ],
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.issueKeys).toEqual(["confidence-mismatch"]);
    expect(diagnostics[0]?.physicalMismatch).toBe(false);
    expect(diagnostics[0]?.meshLocalComMaxSeparationMeters).toBeCloseTo(0, 8);
  });

  it("reports repeated mesh groups when every copy shares the same review confidence", () => {
    const diagnostics = buildRepeatedInertiaDiagnostics({
      linkDataByName: {
        wheel_a: createMeshLinkData({
          inertialOrigin: [0.01, 0, 0],
          inertia: {
            ixx: 1,
            ixy: 0,
            ixz: 0,
            iyy: 2,
            iyz: 0,
            izz: 3,
          },
        }),
        wheel_b: createMeshLinkData({
          inertialOrigin: [0, 0.01, 0],
          collisionRpy: [0, 0, Math.PI / 2],
          inertia: {
            ixx: 2,
            ixy: 0,
            ixz: 0,
            iyy: 1,
            iyz: 0,
            izz: 3,
          },
        }),
      },
      reliabilityEntries: [
        {
          linkName: "wheel_a",
          confidence: "medium",
          strategy: "principal",
        },
        {
          linkName: "wheel_b",
          confidence: "medium",
          strategy: "principal",
        },
      ],
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.issueKeys).toEqual(["group-review"]);
    expect(diagnostics[0]?.issueSummary).toEqual([
      "Viewer confidence is medium across repeated copies.",
    ]);
    expect(diagnostics[0]?.physicalMismatch).toBe(false);
  });

  it("reports repeated mesh groups when every copy is already high confidence", () => {
    const diagnostics = buildRepeatedInertiaDiagnostics({
      linkDataByName: {
        wheel_a: createMeshLinkData({
          inertialOrigin: [0.01, 0, 0],
          inertia: {
            ixx: 1,
            ixy: 0,
            ixz: 0,
            iyy: 2,
            iyz: 0,
            izz: 3,
          },
        }),
        wheel_b: createMeshLinkData({
          inertialOrigin: [0, 0.01, 0],
          collisionRpy: [0, 0, Math.PI / 2],
          inertia: {
            ixx: 2,
            ixy: 0,
            ixz: 0,
            iyy: 1,
            iyz: 0,
            izz: 3,
          },
        }),
      },
      reliabilityEntries: [
        {
          linkName: "wheel_a",
          confidence: "high",
          strategy: "principal",
        },
        {
          linkName: "wheel_b",
          confidence: "high",
          strategy: "principal",
        },
      ],
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.issueKeys).toEqual(["group-review"]);
    expect(diagnostics[0]?.issueSummary).toEqual([
      "Viewer confidence is high across repeated copies.",
    ]);
    expect(diagnostics[0]?.physicalMismatch).toBe(false);
  });

  it("reports repeated mesh groups even before viewer confidence is available", () => {
    const diagnostics = buildRepeatedInertiaDiagnostics({
      linkDataByName: {
        wheel_a: createMeshLinkData({
          inertialOrigin: [0.01, 0, 0],
          inertia: {
            ixx: 1,
            ixy: 0,
            ixz: 0,
            iyy: 2,
            iyz: 0,
            izz: 3,
          },
        }),
        wheel_b: createMeshLinkData({
          inertialOrigin: [0, 0.01, 0],
          collisionRpy: [0, 0, Math.PI / 2],
          inertia: {
            ixx: 2,
            ixy: 0,
            ixz: 0,
            iyy: 1,
            iyz: 0,
            izz: 3,
          },
        }),
      },
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.issueKeys).toEqual(["group-review"]);
    expect(diagnostics[0]?.issueSummary).toEqual([
      "Repeated mesh copies should be reviewed together.",
    ]);
  });

  it("flags physical disagreement when repeated copies move the center of mass in mesh-local space", () => {
    const diagnostics = buildRepeatedInertiaDiagnostics({
      linkDataByName: {
        part_a: createMeshLinkData({
          inertialOrigin: [0.01, 0, 0],
          inertia: {
            ixx: 1,
            ixy: 0,
            ixz: 0,
            iyy: 2,
            iyz: 0,
            izz: 3,
          },
        }),
        part_b: createMeshLinkData({
          inertialOrigin: [0.012, 0, 0],
          inertia: {
            ixx: 1,
            ixy: 0,
            ixz: 0,
            iyy: 2,
            iyz: 0,
            izz: 3,
          },
        }),
      },
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.issueKeys).toContain("mesh-local-com-mismatch");
    expect(diagnostics[0]?.physicalMismatch).toBe(true);
    expect(diagnostics[0]?.meshLocalComMaxSeparationMeters).toBeCloseTo(0.002, 8);
  });
});
