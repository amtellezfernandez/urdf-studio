/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchIluGitHubRepoFilesMock,
  buildIluGitHubCandidateFileListMock,
  findURDFCandidatesMock,
} = vi.hoisted(() => ({
  fetchIluGitHubRepoFilesMock: vi.fn(),
  buildIluGitHubCandidateFileListMock: vi.fn(),
  findURDFCandidatesMock: vi.fn(),
}));

vi.mock("@/features/urdf/github/githubRepo", () => ({
  parseGitHubUrl: vi.fn((url: string) => ({
    owner: "acme",
    repo: "robots",
    path: url.includes("/tree/") ? "robots/demo" : "",
    branch: "main",
  })),
  findURDFCandidates: findURDFCandidatesMock,
  resolveRepositoryXacroTargetPath: vi.fn((files: Array<{ path: string }>, targetPath: string) => {
    return files.find((file) => file.path === targetPath)?.path ?? targetPath;
  }),
}));

vi.mock("@/features/urdf/github/iluGitHubImport", () => ({
  fetchIluGitHubRepoFiles: fetchIluGitHubRepoFilesMock,
  buildIluGitHubCandidateFileList: buildIluGitHubCandidateFileListMock,
}));

import {
  loadThumbnailGitHubRobot,
  THUMBNAIL_MISSING_TARGET_ERROR,
} from "@/app/pages/index/thumbnailBootstrap";

describe("loadThumbnailGitHubRobot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildIluGitHubCandidateFileListMock.mockResolvedValue({} as FileList);
    findURDFCandidatesMock.mockReturnValue([]);
  });

  it("loads an exact target path without enumerating candidates", async () => {
    fetchIluGitHubRepoFilesMock.mockResolvedValue([
      {
        name: "demo.urdf",
        path: "robots/demo/demo.urdf",
        type: "file",
        download_url: null,
      },
    ]);
    const loadFiles = vi.fn();

    await loadThumbnailGitHubRobot({
      loadFilesFromFolderWithFreshCameras: loadFiles,
      repoUrl: "https://github.com/acme/robots",
      urdfTarget: "robots/demo/demo.urdf",
    });

    expect(fetchIluGitHubRepoFilesMock).toHaveBeenCalledTimes(1);
    expect(findURDFCandidatesMock).not.toHaveBeenCalled();
    expect(buildIluGitHubCandidateFileListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "robots",
      }),
      "robots/demo/demo.urdf"
    );
    expect(loadFiles).toHaveBeenCalledTimes(1);
  });

  it("falls back to candidate discovery when the exact target cannot be resolved", async () => {
    fetchIluGitHubRepoFilesMock.mockResolvedValue([
      {
        name: "other.urdf",
        path: "robots/demo/other.urdf",
        type: "file",
        download_url: null,
      },
    ]);
    findURDFCandidatesMock.mockReturnValue([
      {
        name: "Demo",
        path: "robots/demo/other.urdf",
      },
    ]);
    const loadFiles = vi.fn();

    await loadThumbnailGitHubRobot({
      loadFilesFromFolderWithFreshCameras: loadFiles,
      repoUrl: "https://github.com/acme/robots",
      urdfTarget: "demo.urdf",
    });

    expect(fetchIluGitHubRepoFilesMock).toHaveBeenCalledTimes(1);
    expect(findURDFCandidatesMock).toHaveBeenCalledTimes(1);
    expect(buildIluGitHubCandidateFileListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "robots",
      }),
      "robots/demo/other.urdf"
    );
    expect(loadFiles).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when the repo has no exact target and no URDF candidates", async () => {
    fetchIluGitHubRepoFilesMock.mockResolvedValue([
      {
        name: "README.md",
        path: "README.md",
        type: "file",
        download_url: null,
      },
    ]);

    await expect(
      loadThumbnailGitHubRobot({
        loadFilesFromFolderWithFreshCameras: vi.fn(),
        repoUrl: "https://github.com/acme/robots",
        urdfTarget: "robots/demo/demo.urdf",
      })
    ).rejects.toThrow(THUMBNAIL_MISSING_TARGET_ERROR);

    expect(fetchIluGitHubRepoFilesMock).toHaveBeenCalledTimes(2);
    expect(findURDFCandidatesMock).toHaveBeenCalledTimes(2);
    expect(buildIluGitHubCandidateFileListMock).not.toHaveBeenCalled();
  });

  it("retries from the full repository when the hinted subtree misses the target", async () => {
    fetchIluGitHubRepoFilesMock
      .mockResolvedValueOnce([
        {
          name: "README.md",
          path: "robots/demo/README.md",
          type: "file",
          download_url: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          name: "demo.urdf",
          path: "robots/full/demo.urdf",
          type: "file",
          download_url: null,
        },
      ]);
    const loadFiles = vi.fn();

    await loadThumbnailGitHubRobot({
      loadFilesFromFolderWithFreshCameras: loadFiles,
      repoUrl: "https://github.com/acme/robots/tree/main/robots/demo",
      urdfTarget: "robots/full/demo.urdf",
    });

    expect(fetchIluGitHubRepoFilesMock).toHaveBeenCalledTimes(2);
    expect(fetchIluGitHubRepoFilesMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        owner: "acme",
        repo: "robots",
        path: "robots/demo",
        branch: "main",
      })
    );
    expect(fetchIluGitHubRepoFilesMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        owner: "acme",
        repo: "robots",
        path: "",
        branch: "main",
      })
    );
    expect(buildIluGitHubCandidateFileListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "robots",
        branch: "main",
      }),
      "robots/full/demo.urdf"
    );
    expect(loadFiles).toHaveBeenCalledTimes(1);
  });
});
