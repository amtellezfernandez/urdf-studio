// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDisplayStore } from "@/features/displays/useDisplayStore";

const reset = () => {
  window.localStorage.removeItem("urdfstudio:displayManager:v1");
  useDisplayStore.getState().resetDisplays();
};

describe("useDisplayStore", () => {
  beforeEach(() => {
    reset();
  });

  it("starts with default enabled displays", () => {
    const state = useDisplayStore.getState();
    expect(state.displays.robot_model.enabled).toBe(true);
    expect(state.displays.markers.enabled).toBe(true);
  });

  it("toggles and persists enabled state", () => {
    const store = useDisplayStore.getState();
    store.setDisplayEnabled("markers", false);

    const after = useDisplayStore.getState();
    expect(after.displays.markers.enabled).toBe(false);

    const raw = window.localStorage.getItem("urdfstudio:displayManager:v1");
    expect(raw).toBeTruthy();
    expect(raw).toContain("markers");
  });

  it("updates status and metrics", () => {
    const store = useDisplayStore.getState();
    store.setDisplayStatus("trajectory", "ok");
    store.setDisplayMetrics("trajectory", { points: 42 });

    const after = useDisplayStore.getState();
    expect(after.displays.trajectory.status).toBe("ok");
    expect(after.displays.trajectory.metrics.points).toBe(42);
  });

  it("applies only valid persisted display enabled states", async () => {
    const storageKey = "urdfstudio:displayManager:v1";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        markers: { enabled: false },
        robot_model: { enabled: "no" },
        tf_frames: null,
        trajectory: true,
        unknown_display: { enabled: false },
      })
    );

    vi.resetModules();
    const { useDisplayStore: freshDisplayStore } = await import("@/features/displays/useDisplayStore");
    const displays = freshDisplayStore.getState().displays;

    expect(displays.markers.enabled).toBe(false);
    expect(displays.robot_model.enabled).toBe(true);
    expect(displays.tf_frames.enabled).toBe(true);
    expect(displays.trajectory.enabled).toBe(true);
    expect(displays.diagnostics_overlay.enabled).toBe(true);
  });
});
