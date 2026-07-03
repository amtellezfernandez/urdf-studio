import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCollaborationShareUrl,
  buildCollaborationWebSocketProtocols,
  buildCollaborationWebSocketUrl,
  createCollaborationClientId,
  describeCollaborationLinkAccess,
  getCollaborationBaseAccess,
  readCollaborationShareSessionFromUrl,
} from "@/features/collaboration/collaborationTransport";

const DEV_PROXY_API_BASE_URL = "/api";
const DEV_PROXY_BROWSER_URL = "http://localhost:5173/studio?view=main";

describe("collaborationTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a share URL with the collaboration session token in the fragment", () => {
    const url = buildCollaborationShareUrl(
      {
        sessionId: "collab-abc",
        sessionToken: "secret-token",
      },
      "http://localhost:5173/?view=studio",
    );

    expect(url).toBe(
      "http://localhost:5173/?view=studio#collab=collab-abc&collabToken=secret-token",
    );
  });


  it("builds editor share URLs only when an editor token is present", () => {
    const url = buildCollaborationShareUrl(
      {
        sessionId: "collab-abc",
        sessionToken: "viewer-token",
        editorToken: "editor-token",
      },
      "http://localhost:5173/?view=studio",
      "editor",
    );

    expect(url).toBe(
      "http://localhost:5173/?view=studio#collab=collab-abc&collabToken=editor-token",
    );

    expect(() =>
      buildCollaborationShareUrl(
        { sessionId: "collab-abc", sessionToken: "viewer-token" },
        "http://localhost:5173/?view=studio",
        "editor",
      ),
    ).toThrow("Only the room owner can create edit links.");
  });

  it("describes supported share-link access levels", () => {
    expect(getCollaborationBaseAccess("viewer")).toBe("viewer");
    expect(getCollaborationBaseAccess("editor")).toBe("editor");
    expect(describeCollaborationLinkAccess("viewer")).toBe("Can view");
    expect(describeCollaborationLinkAccess("editor")).toBe("Can edit");
  });

  it("scrubs old query-string share tokens from generated links", () => {
    const url = buildCollaborationShareUrl(
      {
        sessionId: "collab-new",
        sessionToken: "new-secret-token",
      },
      "http://localhost:5173/?view=studio&collab=collab-old&collabToken=old-secret-token",
    );

    expect(url).toBe(
      "http://localhost:5173/?view=studio#collab=collab-new&collabToken=new-secret-token",
    );
  });

  it("builds a share URL from a relative browser URL", () => {
    vi.stubGlobal("window", {
      location: { href: DEV_PROXY_BROWSER_URL },
    });

    const url = buildCollaborationShareUrl(
      {
        sessionId: "collab-abc",
        sessionToken: "secret-token",
      },
      "/studio?view=main",
    );

    expect(url).toBe(
      "http://localhost:5173/studio?view=main#collab=collab-abc&collabToken=secret-token",
    );
  });

  it("reads a share session from a relative fragment URL", () => {
    vi.stubGlobal("window", {
      location: { href: DEV_PROXY_BROWSER_URL },
    });

    expect(
      readCollaborationShareSessionFromUrl(
        "#collab=collab-abc&collabToken=secret-token",
      ),
    ).toEqual({
      sessionId: "collab-abc",
      sessionToken: "secret-token",
    });
  });

  it("reads a share session from a fragment URL", () => {
    expect(
      readCollaborationShareSessionFromUrl(
        "http://localhost:5173/#collab=collab-abc&collabToken=secret-token",
      ),
    ).toEqual({
      sessionId: "collab-abc",
      sessionToken: "secret-token",
    });
  });

  it("rejects query-string share tokens", () => {
    expect(
      readCollaborationShareSessionFromUrl(
        "http://localhost:5173/?collab=collab-abc&collabToken=secret-token",
      ),
    ).toBeNull();
  });

  it("builds a websocket URL and subprotocols for collaboration events", () => {
    expect(
      buildCollaborationWebSocketUrl({
        apiBaseUrl: "https://api.example.test",
        clientId: "editor-a",
        sessionId: "collab-abc",
      }),
    ).toBe(
      "wss://api.example.test/ws/collaboration/collab-abc?client_id=editor-a",
    );

    expect(buildCollaborationWebSocketProtocols("secret-token")).toEqual([
      "urdf-collab",
      "urdf-collab-token-secret-token",
    ]);
  });

  it("builds a websocket URL through the relative Vite API proxy", () => {
    vi.stubGlobal("window", {
      location: { href: DEV_PROXY_BROWSER_URL },
    });

    expect(
      buildCollaborationWebSocketUrl({
        apiBaseUrl: DEV_PROXY_API_BASE_URL,
        clientId: "editor-a",
        sessionId: "collab-abc",
      }),
    ).toBe(
      "ws://localhost:5173/api/ws/collaboration/collab-abc?client_id=editor-a",
    );
  });

  it("creates stable browser-safe client IDs", () => {
    expect(createCollaborationClientId(() => "client-uuid")).toBe(
      "urdf-web-client-uuid",
    );
  });
});
