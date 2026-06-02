import { describe, expect, it } from "vitest";
import { resolveViewerPartSelection } from "@/features/viewer/viewerPartSelectionPolicy";

describe("resolveViewerPartSelection", () => {
  it("prefers the link editor while simulation prep is open", () => {
    expect(
      resolveViewerPartSelection({
        jointName: "wheel_joint",
        linkName: "wheel_link",
        simulationPrepPanelOpen: true,
      })
    ).toEqual({
      jointName: null,
      linkName: "wheel_link",
    });
  });

  it("keeps the joint selection behavior outside simulation prep", () => {
    expect(
      resolveViewerPartSelection({
        jointName: "wheel_joint",
        linkName: "wheel_link",
        simulationPrepPanelOpen: false,
      })
    ).toEqual({
      jointName: "wheel_joint",
      linkName: "wheel_link",
    });
  });

  it("falls back to the joint when no link name is available", () => {
    expect(
      resolveViewerPartSelection({
        jointName: "wheel_joint",
        linkName: null,
        simulationPrepPanelOpen: true,
      })
    ).toEqual({
      jointName: "wheel_joint",
      linkName: null,
    });
  });
});
