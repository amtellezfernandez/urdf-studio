import { afterEach, describe, expect, it, vi } from "vitest";

import { BACKEND_REQUEST_ID_HEADER } from "@/shared/lib/backendRequest";
import { issueRosVizStreamTicket } from "@/runtime_engine/rosviz/api/rosVizApi";

const TEST_SESSION_ID = "session-1";

describe("rosVizApi", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", originalFetch);
  });

  it("issues ROS viz stream tickets over the guarded backend path", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          session_id: TEST_SESSION_ID,
          ticket: "ticket-123",
          expires_at_ms: 1_234_567,
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const response = await issueRosVizStreamTicket(TEST_SESSION_ID);

    expect(response).toEqual({
      session_id: TEST_SESSION_ID,
      ticket: "ticket-123",
      expires_at_ms: 1_234_567,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/ros-viz/sessions/${TEST_SESSION_ID}/stream-ticket`),
      expect.objectContaining({
        method: "POST",
      })
    );
    const firstCall = fetchMock.mock.calls[0] as unknown[] | undefined;
    const requestInit = firstCall?.[1] as RequestInit | undefined;
    const headers = new Headers(requestInit?.headers as HeadersInit | undefined);
    expect(headers.get(BACKEND_REQUEST_ID_HEADER)).toBeTruthy();
  });
});
