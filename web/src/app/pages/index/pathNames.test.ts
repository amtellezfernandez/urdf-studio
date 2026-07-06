import { describe, expect, it } from "vitest";

import { getFilenameFromPath } from "@/app/pages/index/pathNames";

describe("getFilenameFromPath", () => {
  it("derives a filename from slash and backslash paths", () => {
    expect(getFilenameFromPath("/tmp/robots/demo/robot.urdf")).toBe("robot.urdf");
    expect(getFilenameFromPath("workspace\\robot.xacro")).toBe("robot.xacro");
  });

  it("uses the fallback for blank or root-like paths", () => {
    expect(getFilenameFromPath("", "fallback.urdf")).toBe("fallback.urdf");
    expect(getFilenameFromPath("///", "fallback.urdf")).toBe("fallback.urdf");
  });
});
