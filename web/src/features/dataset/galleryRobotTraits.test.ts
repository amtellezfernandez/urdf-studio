import { describe, expect, it } from "vitest";
import {
  buildGalleryRobotAttentionNotes,
  buildGalleryRobotLimbLine,
  buildGalleryRobotMacroTag,
  buildGalleryRobotStructureLine,
  buildGalleryRobotTraitChips,
  formatGalleryRobotPrimaryFamily,
} from "@/features/dataset/galleryRobotTraits";
import type { IluGalleryEntry } from "@/features/dataset/iluGalleryApi";

const BASE_ENTRY: IluGalleryEntry = {
  id: "robots/demo/demo.urdf",
  title: "Demo",
  summary: "urdf, renderable",
  owner: "acme",
  repo: "robot",
  tags: ["urdf"],
};

describe("galleryRobotTraits", () => {
  it("formats a primary family label for display", () => {
    expect(
      formatGalleryRobotPrimaryFamily({
        primaryFamily: "mobile-manipulator",
        families: ["mobile-manipulator", "wheeled"],
        linkCount: 9,
        jointCount: 8,
        controllableJointCount: 8,
        dofCount: 8,
        armCount: 2,
        legCount: 0,
        wheelCount: 4,
      })
    ).toBe("Mobile manipulator");
  });

  it("builds readable chips from robot traits and source tags", () => {
    expect(
      buildGalleryRobotTraitChips({
        ...BASE_ENTRY,
        robotTraits: {
          primaryFamily: "mobile-manipulator",
          families: ["mobile-manipulator", "wheeled"],
          linkCount: 9,
          jointCount: 8,
          controllableJointCount: 8,
          dofCount: 8,
          armCount: 2,
          legCount: 0,
          wheelCount: 4,
        },
      })
    ).toEqual(["Mobile manipulator", "2 arms", "4 wheels", "URDF"]);
  });

  it("formats URDF Star style macro and count lines", () => {
    const entry: IluGalleryEntry = {
      ...BASE_ENTRY,
      macroTags: ["Arm"],
      meshCount: 13,
      linkCount: 7,
      jointCount: 6,
      armCount: 1,
      legCount: 0,
      wheelCount: 0,
      robotTraits: {
        primaryFamily: "manipulator",
        families: ["manipulator"],
        linkCount: 7,
        jointCount: 6,
        controllableJointCount: 6,
        dofCount: 6,
        armCount: 1,
        legCount: 0,
        wheelCount: 0,
      },
    };

    expect(buildGalleryRobotMacroTag(entry)).toBe("Arm");
    expect(buildGalleryRobotStructureLine(entry)).toBe("Meshes 13 · Links 7 · Joints 6");
    expect(buildGalleryRobotLimbLine(entry)).toBe("Arms 1 · Legs 0 · Wheels 0");
  });

  it("reads structure and morphology counts from metadata tags", () => {
    const entry: IluGalleryEntry = {
      ...BASE_ENTRY,
      tags: ["meshes:13", "links:7", "joints:6", "arms:1", "legs:0", "wheels:0"],
      robotTraits: null,
      macroTags: [],
    };

    expect(buildGalleryRobotMacroTag(entry)).toBe("Arm");
    expect(buildGalleryRobotStructureLine(entry)).toBe("Meshes 13 · Links 7 · Joints 6");
    expect(buildGalleryRobotLimbLine(entry)).toBe("Arms 1 · Legs 0 · Wheels 0");
  });

  it("omits the limb line when no limb metadata is available", () => {
    expect(
      buildGalleryRobotLimbLine({
        ...BASE_ENTRY,
        armCount: null,
        legCount: null,
        wheelCount: null,
        robotTraits: null,
      })
    ).toBeNull();
  });

  it("falls back to primary family labels when macro tags are unavailable", () => {
    expect(
      buildGalleryRobotMacroTag({
        ...BASE_ENTRY,
        robotTraits: {
          primaryFamily: "manipulator",
          families: ["manipulator"],
          linkCount: 7,
          jointCount: 6,
          controllableJointCount: 6,
          dofCount: 6,
          armCount: 1,
          legCount: 0,
          wheelCount: 0,
        },
      })
    ).toBe("Arm");
  });

  it("keeps only actionable status notes instead of raw gallery status noise", () => {
    expect(
      buildGalleryRobotAttentionNotes({
        ...BASE_ENTRY,
        attentionNotes: ["repo not in gallery catalog", "2 unresolved mesh refs"],
        summary: "repo not in gallery catalog | urdf, renderable, 2 unresolved mesh refs",
      })
    ).toEqual(["repo not in gallery catalog", "2 unresolved mesh refs"]);
  });

  it("falls back to parsing summary text when structured notes are unavailable", () => {
    expect(
      buildGalleryRobotAttentionNotes({
        ...BASE_ENTRY,
        summary: "repo not in gallery catalog | urdf, renderable, 2 unresolved mesh refs",
      })
    ).toEqual(["repo not in gallery catalog", "2 unresolved mesh refs"]);
  });
});
