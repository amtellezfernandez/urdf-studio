import { describe, expect, it } from "vitest";

import { resolveSubstitutionReplacement } from "@/features/dataset/substitutionApply";

describe("resolveSubstitutionReplacement", () => {
  it("returns replacement content from staged documents while preserving the host filename", () => {
    expect(
      resolveSubstitutionReplacement({
        hostUrdfPath: "host_pkg/host.urdf",
        replacementUrdfPath: "tool_pkg/tool.urdf",
        activeUrdfPath: "host_pkg/host.urdf",
        urdfDocuments: {
          "host_pkg/host.urdf": "<robot name='host'/>",
          "tool_pkg/tool.urdf": "<robot name='tool'/>",
        },
        vizUrdfContent: "<robot name='host'/>",
      })
    ).toEqual({
      hostFilename: "host.urdf",
      replacementActivePath: "tool_pkg/tool.urdf",
      nextUrdfDocuments: {
        "host_pkg/host.urdf": "<robot name='host'/>",
        "tool_pkg/tool.urdf": "<robot name='tool'/>",
      },
      replacementContent: "<robot name='tool'/>",
    });
  });

  it("falls back to the active document when the replacement path is currently active", () => {
    expect(
      resolveSubstitutionReplacement({
        hostUrdfPath: "host_pkg/host.urdf",
        replacementUrdfPath: "tool_pkg/tool.urdf",
        activeUrdfPath: "tool_pkg/tool.urdf",
        urdfDocuments: {},
        vizUrdfContent: "<robot name='tool'/>",
      }).replacementContent
    ).toBe("<robot name='tool'/>");
  });

  it("rejects missing replacement content", () => {
    expect(() =>
      resolveSubstitutionReplacement({
        hostUrdfPath: "host_pkg/host.urdf",
        replacementUrdfPath: "tool_pkg/tool.urdf",
        activeUrdfPath: "host_pkg/host.urdf",
        urdfDocuments: {},
        vizUrdfContent: "<robot name='host'/>",
      })
    ).toThrow("Replacement URDF is unavailable. Reload substitution mode and try again.");
  });
});
