import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateWorldLabsWorld,
  getWorldLabsCapabilities,
  getWorldLabsOperation,
} from "@/features/world-share/worldLabsApi";

describe("worldLabsApi", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", originalFetch);
  });

  it("routes capabilities through the backend proxy", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          available: true,
          configured: true,
          provider: "world-labs",
          marble_url: "https://marble.worldlabs.ai",
          docs_url: "https://docs.worldlabs.ai/api/reference/worlds/generate",
          generate_endpoint: "https://api.worldlabs.ai/marble/v1/worlds:generate",
          default_model: "marble-1.0",
          models: ["marble-1.1-plus", "marble-1.1", "marble-1.0"],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const capabilities = await getWorldLabsCapabilities();

    expect(capabilities.provider).toBe("world-labs");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/worlds/world-labs/capabilities"
    );
  });

  it("starts generation without sending provider secrets from the browser", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          operation_id: "op_123",
          status_url: "/worlds/world-labs/operations/op_123",
          raw_response: { operation_id: "op_123" },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const response = await generateWorldLabsWorld({
      prompt: "Generate a metric robot warehouse with dock doors.",
      display_name: "Robot warehouse",
      model: "marble-1.0",
      seed: 42,
      tags: ["wsp", "robotics"],
      public: false,
    });

    expect(response.operation_id).toBe("op_123");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/worlds/world-labs/generate");
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(requestInit?.headers as HeadersInit | undefined);
    const body = JSON.parse(String(requestInit?.body));
    expect(headers.has("WLT-Api-Key")).toBe(false);
    expect(headers.has("Wlt-api-key")).toBe(false);
    expect(JSON.stringify(body).toLowerCase()).not.toContain("api_key");
    expect(body).toEqual({
      prompt: "Generate a metric robot warehouse with dock doors.",
      display_name: "Robot warehouse",
      model: "marble-1.0",
      seed: 42,
      tags: ["wsp", "robotics"],
      public: false,
    });
  });

  it("polls operations through the backend proxy", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          operation_id: "op_123",
          done: false,
          metadata: { progress: 0.5 },
          raw_response: { operation_id: "op_123", done: false },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const operation = await getWorldLabsOperation("op_123");

    expect(operation.done).toBe(false);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/worlds/world-labs/operations/op_123"
    );
  });
});
