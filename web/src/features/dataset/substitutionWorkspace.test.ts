/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { buildSubstitutionWorkspaceLaunchPlan } from "@/features/dataset/substitutionWorkspace";

const createRelativeFile = (name: string, relativePath: string): File => {
  const file = new File(["content"], name, { type: "text/plain" });
  Object.defineProperty(file, "webkitRelativePath", {
    value: relativePath,
    configurable: true,
  });
  return file;
};

describe("buildSubstitutionWorkspaceLaunchPlan", () => {
  it("merges host and element sources into assembly-style selected paths", () => {
    const hostUrdf = createRelativeFile("host.urdf", "host_pkg/host.urdf");
    const hostMesh = createRelativeFile("host.stl", "host_pkg/meshes/host.stl");
    const elementUrdf = createRelativeFile("tool.urdf", "tool_pkg/tool.urdf");

    const plan = buildSubstitutionWorkspaceLaunchPlan(
      {
        candidate: { path: "host_pkg/host.urdf", name: "Host" },
        source: { type: "local", folder: "host_pkg" },
        files: [hostUrdf, hostMesh],
      },
      {
        candidate: { path: "tool_pkg/tool.urdf", name: "Tool" },
        source: { type: "github", owner: "acme", repo: "tooling", path: "robots", branch: "main" },
        files: [elementUrdf],
      }
    );

    expect(plan.selectedPaths).toEqual([
      "local/host_pkg/host_pkg/host.urdf",
      "github/acme/tooling/main/robots/tool_pkg/tool.urdf",
    ]);
    expect(plan.namesByPath).toEqual({
      "local/host_pkg/host_pkg/host.urdf": "Host",
      "github/acme/tooling/main/robots/tool_pkg/tool.urdf": "Tool",
    });
    expect(plan.sourceByPath).toEqual({
      "local/host_pkg/host_pkg/host.urdf": { type: "local", folder: "host_pkg" },
      "github/acme/tooling/main/robots/tool_pkg/tool.urdf": {
        type: "github",
        owner: "acme",
        repo: "tooling",
        path: "robots",
        branch: "main",
      },
    });
    expect(plan.roleByPath).toEqual({
      "local/host_pkg/host_pkg/host.urdf": "host",
      "github/acme/tooling/main/robots/tool_pkg/tool.urdf": "replacement",
    });
    expect(Array.from(plan.files).map((file) => (file as File & { webkitRelativePath?: string }).webkitRelativePath))
      .toEqual([
        "local/host_pkg/host_pkg/host.urdf",
        "local/host_pkg/host_pkg/meshes/host.stl",
        "github/acme/tooling/main/robots/tool_pkg/tool.urdf",
      ]);
  });
});
