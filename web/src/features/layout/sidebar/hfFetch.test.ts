import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/config/api", () => ({
  API_BASE_URL: "/api",
}));

import { fetchHfResource } from "@/features/layout/sidebar/hfFetch";

describe("fetchHfResource", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the backend HF proxy after a browser network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchHfResource("https://huggingface.co/api/datasets/demo/repo", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer hf_token",
      },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost/api/datasets/hf-proxy?url=https%3A%2F%2Fhuggingface.co%2Fapi%2Fdatasets%2Fdemo%2Frepo",
      expect.objectContaining({
        method: "GET",
        headers: expect.any(Headers),
      })
    );
    const proxyHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
    expect(proxyHeaders.get("Authorization")).toBe("Bearer hf_token");
  });
});
