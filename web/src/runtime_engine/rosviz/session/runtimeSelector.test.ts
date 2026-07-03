import { describe, expect, it } from "vitest";

import { getRosVizRuntimeDecision } from "./runtimeSelector";

describe("runtimeSelector", () => {
  it("uses ROS Viz runtime when all requirements are met", () => {
    const decision = getRosVizRuntimeDecision({
      rosVizFlagEnabled: true,
      rosVizGateEnabled: true,
      webGpuSupported: true,
    });

    expect(decision.runtime).toBe("rosViz");
    expect(decision.reason).toBe("enabled");
  });

  it("falls back when Studio 3D runtime is explicitly preferred", () => {
    const decision = getRosVizRuntimeDecision({
      preferStudioRuntime: true,
      rosVizFlagEnabled: true,
      rosVizGateEnabled: true,
      webGpuSupported: true,
    });

    expect(decision.runtime).toBe("studio3D");
    expect(decision.reason).toBe("prefer_studio_runtime");
  });

  it("falls back when flag is disabled", () => {
    const decision = getRosVizRuntimeDecision({
      rosVizFlagEnabled: false,
      rosVizGateEnabled: true,
      webGpuSupported: true,
    });

    expect(decision.runtime).toBe("studio3D");
    expect(decision.reason).toBe("flag_disabled");
  });

  it("falls back when backend gate is unavailable", () => {
    const decision = getRosVizRuntimeDecision({
      rosVizFlagEnabled: true,
      rosVizGateEnabled: false,
      rosVizGateReason: "Core API unavailable.",
      webGpuSupported: true,
    });

    expect(decision.runtime).toBe("studio3D");
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

    expect(decision.runtime).toBe("studio3D");
    expect(decision.reason).toBe("thumbnail_mode");
  });
});
