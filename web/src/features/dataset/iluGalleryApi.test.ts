import { beforeEach, describe, expect, it, vi } from "vitest";

const { guardedFetchMock } = vi.hoisted(() => ({
  guardedFetchMock: vi.fn(),
}));

vi.mock("@/shared/lib/backendGuard", () => ({
  guardedFetch: guardedFetchMock,
}));

vi.mock("@/shared/config/runtime", () => ({
  API_BASE_URL: "http://localhost:8000",
}));

import { generateIluGalleryJob, getIluGalleryRepoPreview } from "@/features/dataset/iluGalleryApi";

const TEST_GITHUB_OWNER = "google-deepmind";
const TEST_GITHUB_REPO = "mujoco_menagerie";
const TEST_GITHUB_BRANCH = "main";
const TEST_PRIMARY_CANDIDATE_PATH = "google_barkour_v0/barkour_v0.urdf";
const TEST_PRIMARY_CANDIDATE_FILE = "barkour_v0.urdf";

describe("iluGalleryApi", () => {
  beforeEach(() => {
    guardedFetchMock.mockReset();
  });

  it("uses the previous GET preview lookup when no candidate list is provided", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          source: {
            owner: TEST_GITHUB_OWNER,
            repo: TEST_GITHUB_REPO,
            path: null,
            branch: TEST_GITHUB_BRANCH,
          },
          publishedRepo: null,
          items: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await getIluGalleryRepoPreview({
      owner: TEST_GITHUB_OWNER,
      repo: TEST_GITHUB_REPO,
      branch: TEST_GITHUB_BRANCH,
    });

    expect(guardedFetchMock).toHaveBeenCalledWith(
      `http://localhost:8000/ilu/repo-gallery-preview?owner=${TEST_GITHUB_OWNER}&repo=${TEST_GITHUB_REPO}&branch=${TEST_GITHUB_BRANCH}`,
      undefined,
      expect.objectContaining({
        context: "Load gallery repo preview",
        requiredBackends: ["core-api"],
      })
    );
  });

  it("uses the POST preview fast path when the caller provides candidates", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          source: {
            owner: TEST_GITHUB_OWNER,
            repo: TEST_GITHUB_REPO,
            path: null,
            branch: TEST_GITHUB_BRANCH,
          },
          publishedRepo: null,
          items: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await getIluGalleryRepoPreview(
      {
        owner: TEST_GITHUB_OWNER,
        repo: TEST_GITHUB_REPO,
        branch: TEST_GITHUB_BRANCH,
      },
      [
        {
          path: TEST_PRIMARY_CANDIDATE_PATH,
          name: TEST_PRIMARY_CANDIDATE_FILE,
          displayName: "Barkour V0",
          fileBase: "google-barkour-v0",
          sourceFile: TEST_PRIMARY_CANDIDATE_FILE,
          hasMeshesFolder: true,
          isXacro: false,
        },
      ]
    );

    expect(guardedFetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/ilu/repo-gallery-preview",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      }),
      expect.objectContaining({
        context: "Load gallery repo preview",
        requiredBackends: ["core-api"],
      })
    );
    const requestPayload = JSON.parse(String(guardedFetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(requestPayload).toEqual({
      source: {
        owner: TEST_GITHUB_OWNER,
        repo: TEST_GITHUB_REPO,
        branch: TEST_GITHUB_BRANCH,
      },
      candidates: [
        {
          path: TEST_PRIMARY_CANDIDATE_PATH,
          name: TEST_PRIMARY_CANDIDATE_FILE,
          displayName: "Barkour V0",
          fileBase: "google-barkour-v0",
          sourceFile: TEST_PRIMARY_CANDIDATE_FILE,
          hasMeshesFolder: true,
          isXacro: false,
        },
      ],
    });
  });

  it("surfaces backend detail for gallery generation errors", async () => {
    guardedFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: "Gallery job is not ready for generation.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(generateIluGalleryJob("job-1", { mode: "repo" })).rejects.toThrow(
      "Gallery job is not ready for generation."
    );
  });
});
