/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  buildXacroFilenameCandidates,
  buildXacroExpandRequestPayload,
  createXacroFilePayloadFromText,
  isXacroPath,
  isUrdfXacroPath,
  isXacroSupportPath,
  normalizeExpandedUrdfPath,
  parseXacroExpandResponsePayload,
} from "@/shared/lib/urdfCore";

describe("xacro contract helpers", () => {
  it("marks expected xacro support files", () => {
    expect(isXacroPath("pkg/robot.urdf.xacro")).toBe(true);
    expect(isUrdfXacroPath("pkg/robot.urdf.xacro")).toBe(true);
    expect(isUrdfXacroPath("pkg/robot.xacro")).toBe(false);
    expect(isXacroPath("pkg/robot.urdf")).toBe(false);
    expect(isXacroSupportPath("pkg/urdf/robot.urdf.xacro")).toBe(true);
    expect(isXacroSupportPath("pkg/package.xml")).toBe(true);
    expect(isXacroSupportPath("pkg/meshes/link.stl")).toBe(false);
  });

  it("builds a stable xacro expand request payload", () => {
    const payload = buildXacroExpandRequestPayload({
      targetPath: "pkg/urdf/robot.urdf.xacro",
      files: [createXacroFilePayloadFromText("pkg/urdf/robot.urdf.xacro", "<robot/>")],
      args: {},
      useInorder: true,
    });

    expect(payload.target_path).toBe("pkg/urdf/robot.urdf.xacro");
    expect(payload.use_inorder).toBe(true);
    expect(payload.files).toHaveLength(2);
    expect(payload.files.map((file) => file.path)).toEqual([
      "pkg/urdf/robot.urdf.xacro",
      "pkg/urdf/robot.xacro",
    ]);
    expect(payload.files[0]?.content_base64.length).toBeGreaterThan(0);
  });

  it("normalizes xacro target names and validates expansion response", () => {
    expect(normalizeExpandedUrdfPath("pkg/robot.urdf.xacro")).toBe("pkg/robot.urdf");
    expect(normalizeExpandedUrdfPath("pkg/robot.xacro")).toBe("pkg/robot.urdf");
    expect(buildXacroFilenameCandidates("pkg/robot.urdf.xacro")).toEqual([
      "robot.urdf.xacro",
      "robot.xacro",
    ]);
    expect(buildXacroFilenameCandidates("robot")).toEqual(["robot.xacro"]);
    expect(parseXacroExpandResponsePayload({ urdf: "<robot/>" }).urdf).toBe("<robot/>");
    expect(() => parseXacroExpandResponsePayload({ urdf: "" })).toThrow(
      "xacro produced empty output."
    );
  });
});
