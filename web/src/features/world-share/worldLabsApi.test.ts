import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateWorldLabsWorld,
  getWorldLabsCapabilities,
  getWorldLabsOperation,
  importWorldLabsWorld,
  listWorldLabsWorlds,
  parseWorldLabsWorldId,
} from "@/features/world-share/worldLabsApi";

describe("worldLabsApi", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", originalFetch);
  });

  it("extracts a world id from Marble links and raw ids", () => {
    expect(parseWorldLabsWorldId("world_abc")).toBe("world_abc");
    expect(parseWorldLabsWorldId("https://marble.worldlabs.ai/world/world_abc")).toBe(
      "world_abc"
    );
    expect(parseWorldLabsWorldId("https://marble.worldlabs.ai/worlds/world_abc?tab=assets")).toBe(
      "world_abc"
    );
    expect(parseWorldLabsWorldId("https://marble.worldlabs.ai/view?world_id=world_abc")).toBe(
      "world_abc"
    );
    expect(parseWorldLabsWorldId("https://marble.worldlabs.ai/library")).toBe("");
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

  it("lists persistent worlds through the backend proxy", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          worlds: [
            {
              world_id: "world_abc",
              display_name: "Robot warehouse",
              world_marble_url: "https://marble.worldlabs.ai/world/world_abc",
              raw_world: { world_id: "world_abc" },
            },
          ],
          raw_response: { worlds: [{ world_id: "world_abc" }] },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const response = await listWorldLabsWorlds({ page_size: 5 });

    expect(response.worlds[0].world_id).toBe("world_abc");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/worlds/world-labs/worlds:list");
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(requestInit?.headers as HeadersInit | undefined);
    expect(headers.has("WLT-Api-Key")).toBe(false);
    expect(JSON.parse(String(requestInit?.body))).toEqual({ page_size: 5 });
  });

  it("imports a persistent world as a WSP fork through the backend proxy", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          world_id: "world_abc",
          world_marble_url: "https://marble.worldlabs.ai/world/world_abc",
          world_package: {
            schema_version: "1.0.0",
            package_id: "world-labs-world-abc",
            version: "0.1.0",
            title: "Robot warehouse",
            created_at: "2026-06-06T00:00:00Z",
            runtime_targets: [],
            interface: {
              observation_modalities: [],
              action_semantics: "world_scene_static_layout",
              timestep_ms: 33,
              frame_convention: "world-labs-generated-metric-scale",
            },
            artifacts: [],
            world_snapshot: {
              urdf_xml: "<robot name='world_labs_generated_world'/>",
              joint_positions: {},
              cameras: [],
              objects: [],
              scenario_time_ms: 0,
              scenario_duration_ms: 0,
            },
            provenance: { source: "world_labs", world_id: "world_abc" },
            security: {
              signature_ref: null,
              attestation_refs: [],
              sbom_ref: null,
            },
          },
          raw_world: { world_id: "world_abc" },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const imported = await importWorldLabsWorld("world_abc");

    expect(imported.world_package.package_id).toBe("world-labs-world-abc");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/worlds/world-labs/worlds/world_abc");
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(requestInit?.headers as HeadersInit | undefined);
    expect(headers.has("WLT-Api-Key")).toBe(false);
  });
});
