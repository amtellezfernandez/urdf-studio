import { describe, expect, it } from "vitest";
import {
  createDefaultWorldPublishDraft,
  inferRemoteUrdfFileName,
  prepareWorldPublishManifestOverrides,
  toWorldPublishFailureMessage,
  toWorldPublishSuccessLabel,
  toWorldPublishTargetLabel,
} from "@/app/pages/index/indexPageHelpers";

describe("index page world publish helpers", () => {
  it("creates robot-specific default publish drafts", () => {
    expect(createDefaultWorldPublishDraft("so101")).toEqual({
      packageId: "so101",
      version: "0.1.0",
      title: "so101",
      description: "",
    });
  });

  it("trims publish drafts into manifest overrides", () => {
    const publishDraftPreparation = prepareWorldPublishManifestOverrides({
      draft: {
        packageId: "  lab-layout  ",
        version: "  1.2.3  ",
        title: "  Lab Layout  ",
        description: "  Shared cameras and props  ",
      },
      resolvedRobotName: "so101",
    });

    expect(publishDraftPreparation).toEqual({
      ok: true,
      manifestOverrides: {
        package_id: "lab-layout",
        version: "1.2.3",
        title: "Lab Layout",
        description: "Shared cameras and props",
      },
    });
  });

  it("falls back to robot title and default version while omitting blank descriptions", () => {
    const publishDraftPreparation = prepareWorldPublishManifestOverrides({
      draft: {
        packageId: "robot-world",
        version: "   ",
        title: "   ",
        description: "   ",
      },
      resolvedRobotName: "open-arm",
    });

    expect(publishDraftPreparation).toEqual({
      ok: true,
      manifestOverrides: {
        package_id: "robot-world",
        version: "0.1.0",
        title: "open-arm",
      },
    });
  });

  it("requires a non-empty package id", () => {
    expect(
      prepareWorldPublishManifestOverrides({
        draft: {
          packageId: "   ",
          version: "0.1.0",
          title: "Shared World",
          description: "",
        },
        resolvedRobotName: null,
      })
    ).toEqual({
      ok: false,
      errorMessage: "Package ID is required",
    });
  });

  it("labels world publish targets consistently", () => {
    expect(toWorldPublishTargetLabel("registry")).toBe("World Registry");
    expect(toWorldPublishSuccessLabel("registry")).toBe("Published");
    expect(toWorldPublishFailureMessage("registry")).toBe("Failed to publish world package");
    expect(toWorldPublishTargetLabel("hub")).toBe("URDF Star Hub");
    expect(toWorldPublishSuccessLabel("hub")).toBe("Published to URDF Star");
    expect(toWorldPublishFailureMessage("hub")).toBe("Failed to publish to URDF Star");
  });

  it("infers supported remote URDF file names", () => {
    expect(inferRemoteUrdfFileName("https://example.test/robots/demo%20arm.urdf")).toBe(
      "demo arm.urdf"
    );
    expect(inferRemoteUrdfFileName("https://example.test/robots/")).toBe("robot.urdf");
    expect(inferRemoteUrdfFileName("not a url")).toBe("robot.urdf");
  });
});
