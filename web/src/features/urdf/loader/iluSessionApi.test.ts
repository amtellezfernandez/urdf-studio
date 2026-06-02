import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKEND_REQUEST_ID_HEADER } from "@/shared/lib/backendRequest";
import {
  fetchIluSessionAssetManifest,
  fetchIluSessionSnapshot,
  getIluSessionAssetManifestUrl,
  saveIluSessionSnapshot,
} from "@/features/urdf/loader/iluSessionApi";

const originalFetch = globalThis.fetch;

const createJsonResponse = (payload: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
});

describe("iluSessionApi", () => {
  it("maps the backend snapshot into the ILU contract and derives the GitHub source", async () => {
    const fetchMock: typeof fetch = vi.fn(async () =>
      createJsonResponse({
        schema: "ilu-shared-session",
        schemaVersion: 1,
        sessionId: "session-1",
        createdAt: "2026-03-23T00:00:00Z",
        updatedAt: "2026-03-23T00:00:01Z",
        workingUrdfPath: "/tmp/working.urdf",
        lastUrdfPath: "/tmp/source.urdf",
        urdfContent: "<robot name=\"demo\" />",
        loadedSource: {
          source: "github",
          urdfPath: "/tmp/working.urdf",
          githubRef: "https://github.com/openai/robot.git",
          githubRevision: "main",
          repositoryUrdfPath: "robots/demo/robot.urdf",
        },
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchIluSessionSnapshot("session-1");

    expect(snapshot.sessionId).toBe("session-1");
    expect(snapshot.urdfContent).toBe("<robot name=\"demo\" />");
    expect(snapshot.loadedSource?.repositoryUrdfPath).toBe("robots/demo/robot.urdf");
    expect(snapshot.githubSource).toEqual({
      owner: "openai",
      repo: "robot",
      ref: "main",
      repositoryUrl: "https://github.com/openai/robot",
    });
  });

  it("saves the ILU contract using the camelCase request body", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({}));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await saveIluSessionSnapshot("session-1", "<robot name=\"updated\" />");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/ilu-session/session-1"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          urdfContent: "<robot name=\"updated\" />",
        }),
      })
    );
    const firstCall = fetchMock.mock.calls[0] as unknown[] | undefined;
    expect(firstCall).toBeDefined();
    const requestInit = firstCall?.[1] as RequestInit | undefined;
    const headers = new Headers(requestInit?.headers as HeadersInit | undefined);
    expect(headers.get(BACKEND_REQUEST_ID_HEADER)).toBeTruthy();
  });

  it("builds a manifest URL for local ilu session assets", () => {
    expect(getIluSessionAssetManifestUrl("session-1")).toContain(
      "/ilu-session/session-1/manifest"
    );
  });

  it("fetches the ilu asset manifest", async () => {
    const fetchMock: typeof fetch = vi.fn(async () =>
      createJsonResponse({
        label: "Attached ilu session session-1",
        files: [
          {
            path: "robots/demo/robot.urdf",
            url: "/ilu-session/session-1/asset?kind=working&path=robots%2Fdemo%2Frobot.urdf",
            mime: "application/xml",
          },
        ],
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const manifest = await fetchIluSessionAssetManifest("session-1");

    expect(manifest.files[0]?.path).toBe("robots/demo/robot.urdf");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/ilu-session/session-1/manifest"),
      expect.anything()
    );
  });
});
