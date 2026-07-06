import { describe, expect, it } from "vitest";

import { assertBackendResponseOk } from "@/shared/lib/backendResponse";

describe("assertBackendResponseOk", () => {
  it("resolves for successful responses", async () => {
    await expect(
      assertBackendResponseOk(new Response("{}", { status: 200 }), "Request failed")
    ).resolves.toBeUndefined();
  });

  it("uses JSON detail for failed responses", async () => {
    const response = new Response(JSON.stringify({ detail: "  Missing session  " }), {
      status: 404,
    });

    await expect(assertBackendResponseOk(response, "Request failed")).rejects.toThrow(
      "Missing session"
    );
  });

  it("keeps the fallback for non-JSON failed responses", async () => {
    const response = new Response("plain failure", { status: 500 });

    await expect(assertBackendResponseOk(response, "Request failed")).rejects.toThrow(
      "Request failed"
    );
  });
});
