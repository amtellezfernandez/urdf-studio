/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  createScenarioRun,
  listScenarios,
  publishScenarioPack,
  pullScenarioPack,
  scenarioRunReportUrl,
} from "@/features/scenarios/scenariosApi";

vi.mock("@/shared/lib/backendGuard", () => ({
  guardedFetch: (url: string, init?: RequestInit) => mockFetch(url, init),
}));

let mockFetch: Mock<(url: string, init?: RequestInit) => Promise<Response>>;

beforeEach(() => {
  mockFetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

describe("scenariosApi", () => {
  it("lists scenarios from the library endpoint", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ scenarios: [{ scenario_id: "carton_sorting_0001" }] })
    );

    const scenarios = await listScenarios();

    expect(mockFetch.mock.calls[0][0]).toContain("/scenarios");
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].scenario_id).toBe("carton_sorting_0001");
  });

  it("posts a run request with the selected simulators", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ run_id: "abc", scenario_id: "carton_sorting_0001", sims: ["mujoco"], status: "queued" })
    );

    const summary = await createScenarioRun("carton_sorting_0001", ["mujoco", "genesis"], 3);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/scenarios/carton_sorting_0001/runs");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      sims: ["mujoco", "genesis"],
      episodes: 3,
    });
    expect(summary.run_id).toBe("abc");
  });

  it("surfaces backend error detail on failure", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ detail: "Unsupported simulator: holodeck" }, false, 400));

    await expect(createScenarioRun("carton_sorting_0001", ["holodeck"])).rejects.toThrow(
      /Unsupported simulator/
    );
  });

  it("builds the report url for a run", () => {
    expect(scenarioRunReportUrl("abc123")).toContain("/scenarios/runs/abc123/report");
  });

  it("publishes a pack with a version", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ package_id: "carton", version: "1.0.0", digest_sha256: "a".repeat(64) })
    );

    await publishScenarioPack("carton", "1.0.0");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/scenarios/carton/packs");
    expect(JSON.parse(String(init?.body))).toEqual({ version: "1.0.0" });
  });

  it("pulls a pack by package id and version", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ package_id: "carton", version: "2.1.0", digest_sha256: "b".repeat(64) })
    );

    const summary = await pullScenarioPack("carton", "2.1.0");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/scenarios/packs/carton/2.1.0/pull");
    expect(init?.method).toBe("POST");
    expect(summary.version).toBe("2.1.0");
  });
});
