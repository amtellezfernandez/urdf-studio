import { describe, expect, it } from "vitest";

import { BACKEND_REQUEST_ID_HEADER, withBackendRequestHeaders } from "./backendRequest";

describe("backendRequest", () => {
  it("adds a request id header while preserving existing headers", () => {
    const { init, requestId } = withBackendRequestHeaders(
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
      {
        extraHeaders: {
          Authorization: "Bearer secret",
        },
      }
    );

    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer secret");
    expect(headers.get(BACKEND_REQUEST_ID_HEADER)).toBe(requestId);
    expect(requestId.length).toBeGreaterThan(0);
  });

  it("reuses an explicit request id when provided", () => {
    const explicitRequestId = "client-trace-123";
    const { init, requestId } = withBackendRequestHeaders(undefined, {
      requestId: explicitRequestId,
    });

    expect(requestId).toBe(explicitRequestId);
    expect(new Headers(init.headers).get(BACKEND_REQUEST_ID_HEADER)).toBe(explicitRequestId);
  });
});
