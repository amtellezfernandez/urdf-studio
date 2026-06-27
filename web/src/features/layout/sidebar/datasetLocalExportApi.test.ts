import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadDatasetArchiveForOps } from "@/features/layout/sidebar/datasetLocalExportApi";

describe("datasetLocalExportApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads a v3 archive for local URDF Ops discovery", async () => {
    const fetchMock: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            datasetPath: "/tmp/urdf-studio-teleop-replays/studio_recorded_v3",
            datasetName: "studio_recorded_v3",
            fileCount: 6,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadDatasetArchiveForOps({
        archive: new Blob(["zip-bytes"], { type: "application/zip" }),
        datasetName: "studio_recorded_v3",
      }),
    ).resolves.toMatchObject({
      datasetPath: "/tmp/urdf-studio-teleop-replays/studio_recorded_v3",
    });

    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toContain("/datasets/local-exports");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
  });
});
