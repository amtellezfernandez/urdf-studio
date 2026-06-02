import { describe, expect, it } from "vitest";

import { getRosVizRuntimeDecision } from "./runtimeSelector";

describe("runtimeSelector", () => {
  it("uses ROS viz runtime when all requirements are met", () => {
    const decision = getRosVizRuntimeDecision({
      rosVizFlagEnabled: true,
      rosVizGateEnabled: true,
      webGpuSupported: true,
    });

    expect(decision.runtime).toBe("rosVizV2");
    expect(decision.reason).toBe("enabled");
  });

  it("falls back when legacy runtime is explicitly preferred", () => {
    const decision = getRosVizRuntimeDecision({
      preferLegacyRuntime: true,
      rosVizFlagEnabled: true,
      rosVizGateEnabled: true,
      webGpuSupported: true,
    });

    expect(decision.runtime).toBe("legacy");
    expect(decision.reason).toBe("prefer_legacy_runtime");
  });

  it("falls back when flag is disabled", () => {
    const decision = getRosVizRuntimeDecision({
      rosVizFlagEnabled: false,
      rosVizGateEnabled: true,
      webGpuSupported: true,
    });

    expect(decision.runtime).toBe("legacy");
    expect(decision.reason).toBe("flag_disabled");
  });

  it("falls back when backend gate is unavailable", () => {
    const decision = getRosVizRuntimeDecision({
      rosVizFlagEnabled: true,
      rosVizGateEnabled: false,
      rosVizGateReason: "Core API unavailable.",
      webGpuSupported: true,
    });

    expect(decision.runtime).toBe("legacy");
    expect(decision.reason).toBe("backend_unavailable");
    expect(decision.message).toContain("Core API unavailable.");
  });

  it("falls back in thumbnail mode even when enabled", () => {
    const decision = getRosVizRuntimeDecision({
      thumbnailMode: true,
      rosVizFlagEnabled: true,
      rosVizGateEnabled: true,
      webGpuSupported: true,
    });

    expect(decision.runtime).toBe("legacy");
    expect(decision.reason).toBe("thumbnail_mode");
  });
});
