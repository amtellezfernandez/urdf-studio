import { describe, expect, it } from "vitest";

import {
  getFilenameFromPath,
  getFirstPathSegment,
  getPathSegments,
} from "@/shared/lib/pathNames";

describe("path name helpers", () => {
  it("derives path segments from slash and backslash paths", () => {
    expect(getPathSegments("/tmp/robots/demo/robot.urdf")).toEqual([
      "tmp",
      "robots",
      "demo",
      "robot.urdf",
    ]);
    expect(getPathSegments("workspace\\robot.xacro")).toEqual([
      "workspace",
      "robot.xacro",
    ]);
  });

  it("derives a filename from slash and backslash paths", () => {
    expect(getFilenameFromPath("/tmp/robots/demo/robot.urdf")).toBe("robot.urdf");
    expect(getFilenameFromPath("workspace\\robot.xacro")).toBe("robot.xacro");
  });

  it("derives the first path segment", () => {
    expect(getFirstPathSegment("robots/demo/robot.urdf")).toBe("robots");
    expect(getFirstPathSegment("", "fallback")).toBe("fallback");
  });

  it("uses the fallback for blank or root-like paths", () => {
    expect(getFilenameFromPath("", "fallback.urdf")).toBe("fallback.urdf");
    expect(getFilenameFromPath("///", "fallback.urdf")).toBe("fallback.urdf");
  });
});
