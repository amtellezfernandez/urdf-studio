import { describe, expect, it } from "vitest";
import {
  buildGitHubCandidateDialogCopy,
  formatGitHubCandidateSourceLabel,
  resolveSuggestedGitHubFolderPath,
} from "@/features/dataset/githubCandidateSelection";

describe("githubCandidateSelection", () => {
  it("formats a repository source label with an optional path", () => {
    expect(
      formatGitHubCandidateSourceLabel({
        owner: "unitreerobotics",
        repo: "unitree_ros",
      })
    ).toBe("unitreerobotics/unitree_ros");

    expect(
      formatGitHubCandidateSourceLabel({
        owner: "unitreerobotics",
        repo: "unitree_ros",
        path: "robots/go1_description",
      })
    ).toBe("unitreerobotics/unitree_ros/robots/go1_description");
  });

  it("suggests a package folder for nested urdf and xacro candidates", () => {
    expect(resolveSuggestedGitHubFolderPath("robots/go1_description/urdf/go1.urdf")).toBe(
      "robots/go1_description"
    );
    expect(resolveSuggestedGitHubFolderPath("robots/a1_description/xacro/robot.xacro")).toBe(
      "robots/a1_description"
    );
  });

  it("describes multi-robot repository loads with a folder hint", () => {
    const copy = buildGitHubCandidateDialogCopy(
      {
        owner: "unitreerobotics",
        repo: "unitree_ros",
      },
      [
        {
          path: "robots/go1_description/urdf/go1.urdf",
          name: "go1.urdf",
          displayName: "go1",
          fileBase: "go1",
          sourceFile: "go1.urdf",
          hasMeshesFolder: true,
        },
        {
          path: "robots/a1_description/urdf/a1.urdf",
          name: "a1.urdf",
          displayName: "a1",
          fileBase: "a1",
          sourceFile: "a1.urdf",
          hasMeshesFolder: true,
        },
      ]
    );

    expect(copy.title).toBe("Choose Robot · unitreerobotics/unitree_ros");
    expect(copy.description).toContain("Found 2 robot files");
    expect(copy.description).toContain("robots/go1_description");
    expect(copy.discoveryToast).toContain("Choose one in the dialog");
  });

  it("keeps single-candidate folder loads concise", () => {
    const copy = buildGitHubCandidateDialogCopy(
      {
        owner: "unitreerobotics",
        repo: "unitree_ros",
        path: "robots/go1_description",
      },
      [
        {
          path: "robots/go1_description/urdf/go1.urdf",
          name: "go1.urdf",
          displayName: "go1",
          fileBase: "go1",
          sourceFile: "go1.urdf",
          hasMeshesFolder: true,
        },
      ]
    );

    expect(copy.title).toBe("Choose Robot · unitreerobotics/unitree_ros/robots/go1_description");
    expect(copy.description).toBeNull();
    expect(copy.discoveryToast).toBeNull();
  });
});
