/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InertialControl } from "./InertialControl";

const TEST_INERTIAL = {
  mass: 0.25,
  origin: { xyz: [0, 0, 0] as [number, number, number], rpy: [0, 0, 0] as [number, number, number] },
  inertia: {
    ixx: 0.01,
    ixy: 0,
    ixz: 0,
    iyy: 0.02,
    iyz: 0,
    izz: 0.03,
  },
};

describe("InertialControl", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("shows a voxel-derived badge when the staged inertial used voxel fallback", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(InertialControl, {
          linkName: "arm_link",
          inertial: TEST_INERTIAL,
          voxelDerived: true,
          onGenerateFromGeometry: vi.fn(),
        })
      );
    });

    expect(container.textContent).toContain("Voxel-Derived");

    await act(async () => {
      root.unmount();
    });
  });
});
