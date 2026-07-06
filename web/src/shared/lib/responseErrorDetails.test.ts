import { describe, expect, it } from "vitest";

import { readResponseErrorDetail } from "@/shared/lib/responseErrorDetails";

describe("readResponseErrorDetail", () => {
  it("reads JSON detail fields before raw response text", async () => {
    const response = new Response(JSON.stringify({ detail: "  Invalid package  " }), {
      status: 400,
    });

    await expect(readResponseErrorDetail(response)).resolves.toBe("Invalid package");
  });

  it("reads JSON error fields when detail is absent", async () => {
    const response = new Response(JSON.stringify({ error: "solver failed" }), {
      status: 500,
    });

    await expect(readResponseErrorDetail(response)).resolves.toBe("solver failed");
  });

  it("falls back to raw text for non-JSON bodies", async () => {
    const response = new Response("plain failure", { status: 500 });

    await expect(readResponseErrorDetail(response)).resolves.toBe("plain failure");
  });

  it("uses the provided fallback for empty bodies", async () => {
    const response = new Response("", { status: 404, statusText: "Not Found" });

    await expect(
      readResponseErrorDetail(response, { fallback: "Missing resource" })
    ).resolves.toBe("Missing resource");
  });
});
