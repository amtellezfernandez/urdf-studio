import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCollaborationSession,
  postCollaborationEvent,
  updateCollaborationAccess,
} from "@/features/collaboration/collaborationApi";
import { COLLABORATION_SESSION_TOKEN_HEADER } from "@/features/collaboration/collaborationTransport";
import { guardedFetch } from "@/shared/lib/backendGuard";

vi.mock("@/shared/lib/backendGuard", () => ({
  guardedFetch: vi.fn(),
}));

const HTTP_OK = 200;
const SESSION_ID = "collab-abc";
const EDITOR_TOKEN = "editor-token";
const VIEWER_TOKEN = "viewer-token";
const OWNER_TOKEN = "owner-token";
const FIRST_EVENT_ID = 1;
const PEER_COUNT = 1;
const EVENT_COUNT = 2;
const NO_PEERS = 0;
const NO_EVENTS = 0;
const SERVER_RECEIVED_AT_MS = 123;

const guardedFetchMock = vi.mocked(guardedFetch);

const jsonResponse = (payload: unknown): Response =>
  ({
    ok: true,
    status: HTTP_OK,
    statusText: "OK",
    json: vi.fn().mockResolvedValue(payload),
    text: vi.fn().mockResolvedValue(""),
  }) as unknown as Response;

describe("collaborationApi", () => {
  beforeEach(() => {
    guardedFetchMock.mockReset();
  });

  it("creates collaboration sessions through the guarded core API", async () => {
    const responsePayload = {
      session_id: SESSION_ID,
      session_token: VIEWER_TOKEN,
      editor_token: EDITOR_TOKEN,
      owner_token: OWNER_TOKEN,
      label: "Pair edit",
      role: "owner",
      editors_enabled: true,
      sharing_enabled: true,
      created_at: "2026-04-11T00:00:00Z",
      updated_at: "2026-04-11T00:00:00Z",
      peer_count: NO_PEERS,
      event_count: NO_EVENTS,
      last_event_id: NO_EVENTS,
    };
    guardedFetchMock.mockResolvedValueOnce(jsonResponse(responsePayload));

    await expect(createCollaborationSession("Pair edit")).resolves.toEqual(
      responsePayload,
    );

    expect(guardedFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/collaboration/sessions"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Pair edit" }),
      },
      expect.objectContaining({ context: "Collaboration session creation" }),
    );
  });

  it("posts collaboration events with the editor token header", async () => {
    const eventPayload = { clientSequence: FIRST_EVENT_ID, joint: "shoulder" };
    const responsePayload = {
      event_id: FIRST_EVENT_ID,
      session_id: SESSION_ID,
      client_id: "editor-a",
      event_type: "joint.value",
      payload: eventPayload,
      occurred_at: "2026-04-11T00:00:00Z",
      server_received_at_ms: SERVER_RECEIVED_AT_MS,
    };
    guardedFetchMock.mockResolvedValueOnce(jsonResponse(responsePayload));

    await expect(
      postCollaborationEvent(
        { sessionId: SESSION_ID, sessionToken: EDITOR_TOKEN },
        {
          client_id: "editor-a",
          event_type: "joint.value",
          payload: eventPayload,
        },
      ),
    ).resolves.toEqual(responsePayload);

    expect(guardedFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/collaboration/sessions/collab-abc/events"),
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [COLLABORATION_SESSION_TOKEN_HEADER]: EDITOR_TOKEN,
        },
      }),
      expect.objectContaining({ context: "Collaboration event publish" }),
    );
  });

  it("updates collaboration access with the owner token header", async () => {
    const responsePayload = {
      snapshot: {
        session_id: SESSION_ID,
        label: "Pair edit",
        role: "owner",
        editors_enabled: false,
        sharing_enabled: false,
        created_at: "2026-04-11T00:00:00Z",
        updated_at: "2026-04-11T00:00:01Z",
        peer_count: PEER_COUNT,
        event_count: EVENT_COUNT,
        last_event_id: EVENT_COUNT,
      },
      session_token: VIEWER_TOKEN,
      editor_token: EDITOR_TOKEN,
    };
    guardedFetchMock.mockResolvedValueOnce(jsonResponse(responsePayload));

    await expect(
      updateCollaborationAccess(
        {
          sessionId: SESSION_ID,
          sessionToken: EDITOR_TOKEN,
          ownerToken: OWNER_TOKEN,
        },
        { editors_enabled: false, sharing_enabled: false },
      ),
    ).resolves.toEqual(responsePayload);

    expect(guardedFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/collaboration/sessions/collab-abc/access"),
      expect.objectContaining({
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          [COLLABORATION_SESSION_TOKEN_HEADER]: OWNER_TOKEN,
        },
        body: JSON.stringify({
          editors_enabled: false,
          sharing_enabled: false,
        }),
      }),
      expect.objectContaining({ context: "Collaboration access update" }),
    );
  });

});
