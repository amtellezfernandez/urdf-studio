import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";

import { resolveViewerDraftPreview } from "@/app/pages/index/viewerDraftPreview";

const SIMPLE_BASE_URDF = `
  <robot name="base_robot">
    <link name="base_link" />
  </robot>
`;

const SIMPLE_BAKE_URDF = `
  <robot name="bake_robot">
    <link name="bake_link" />
  </robot>
`;

const SIMPLE_CANONICAL_URDF = `
  <robot name="canonical_robot">
    <link name="canonical_link" />
  </robot>
`;

const SIMPLE_PHYSICS_URDF = `
  <robot name="physics_robot">
    <link name="physics_link">
      <inertial>
        <origin xyz="0 0 0" rpy="0 0 0" />
        <mass value="1" />
        <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
      </inertial>
    </link>
  </robot>
`;

const buildCreateUrdfFile = () => (content: string, filename = "robot.urdf") =>
  new File([content], `viz-${filename}`, { type: "application/xml" });

describe("resolveViewerDraftPreview", () => {
  beforeAll(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
    globalThis.XMLSerializer = dom.window.XMLSerializer as unknown as typeof XMLSerializer;
  });

  it("falls back to the base viewer inputs when no staged draft exists", () => {
    const baseUrdfFile = new File([SIMPLE_BASE_URDF], "viz-source_robot.urdf", {
      type: "application/xml",
    });
    const baseUrdfAnalysis = {
      robotName: "base_robot",
      linkNames: ["base_link"],
      isValid: true,
    } as never;

    const preview = resolveViewerDraftPreview({
      baseUrdfFile,
      baseUrdfAnalysis,
      baseVizUrdfContent: SIMPLE_BASE_URDF,
      createUrdfFile: buildCreateUrdfFile(),
    });

    expect(preview).toEqual({
      urdfFile: baseUrdfFile,
      urdfAnalysis: baseUrdfAnalysis,
      vizUrdfContent: SIMPLE_BASE_URDF,
      source: null,
    });
  });

  it("prefers the physics draft over canonical and bake previews", () => {
    const preview = resolveViewerDraftPreview({
      baseUrdfFile: new File([SIMPLE_BASE_URDF], "viz-source_robot.urdf", {
        type: "application/xml",
      }),
      baseUrdfAnalysis: null,
      baseVizUrdfContent: SIMPLE_BASE_URDF,
      bakeDraftContent: SIMPLE_BAKE_URDF,
      canonicalDraftContent: SIMPLE_CANONICAL_URDF,
      inertialDraftContent: SIMPLE_PHYSICS_URDF,
      createUrdfFile: buildCreateUrdfFile(),
    });

    expect(preview.source).toBe("physics");
    expect(preview.vizUrdfContent).toBe(SIMPLE_PHYSICS_URDF);
    expect(preview.urdfFile?.name).toBe("viz-source_robot.urdf");
    expect(preview.urdfAnalysis?.robotName).toBe("physics_robot");
    expect(preview.urdfAnalysis?.linkNames).toEqual(["physics_link"]);
  });

  it("ignores blank staged drafts when selecting the preview source", () => {
    const preview = resolveViewerDraftPreview({
      baseUrdfFile: new File([SIMPLE_BASE_URDF], "viz-source_robot.urdf", {
        type: "application/xml",
      }),
      baseUrdfAnalysis: null,
      baseVizUrdfContent: SIMPLE_BASE_URDF,
      bakeDraftContent: SIMPLE_BAKE_URDF,
      canonicalDraftContent: "   ",
      inertialDraftContent: "\n",
      createUrdfFile: buildCreateUrdfFile(),
    });

    expect(preview.source).toBe("bake");
    expect(preview.vizUrdfContent).toBe(SIMPLE_BAKE_URDF);
    expect(preview.urdfAnalysis?.robotName).toBe("bake_robot");
  });
});
