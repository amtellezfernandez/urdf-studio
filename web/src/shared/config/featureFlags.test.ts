// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  getFeatureFlagSource,
  isFeatureFlagEnabled,
  isFeatureFlagUrlLocked,
  setFeatureFlag,
  subscribeFeatureFlags,
} from "./featureFlags";

const resetFlagStorage = () => {
  window.localStorage.removeItem("urdfstudio:featureFlags");
  window.localStorage.removeItem("urdfstudio:playbackDebug");
};

describe("featureFlags", () => {
  beforeEach(() => {
    resetFlagStorage();
    window.history.replaceState({}, "", "/");
  });

  it("defaults to disabled ROS viz v2", () => {
    expect(isFeatureFlagEnabled("rosVizV2")).toBe(false);
    expect(getFeatureFlagSource("rosVizV2")).toBe("default");
    expect(isFeatureFlagUrlLocked("rosVizV2")).toBe(false);
  });

  it("defaults motion kernel v2 to enabled", () => {
    expect(isFeatureFlagEnabled("motionKernelV2")).toBe(true);
    expect(getFeatureFlagSource("motionKernelV2")).toBe("default");
    expect(isFeatureFlagUrlLocked("motionKernelV2")).toBe(false);
  });

  it("persists runtime flag to localStorage", () => {
    setFeatureFlag("rosVizV2", true);

    expect(isFeatureFlagEnabled("rosVizV2")).toBe(true);
    expect(getFeatureFlagSource("rosVizV2")).toBe("localStorage");
    expect(isFeatureFlagUrlLocked("rosVizV2")).toBe(false);
  });

  it("treats URL flags as authoritative and locked", () => {
    setFeatureFlag("rosVizV2", true);
    window.history.replaceState({}, "", "/?flags=-rosVizV2");

    expect(isFeatureFlagEnabled("rosVizV2")).toBe(false);
    expect(getFeatureFlagSource("rosVizV2")).toBe("url");
    expect(isFeatureFlagUrlLocked("rosVizV2")).toBe(true);
  });

  it("notifies subscribers when flag changes", () => {
    let notifications = 0;
    const unsubscribe = subscribeFeatureFlags(() => {
      notifications += 1;
    });

    setFeatureFlag("rosVizV2", true);
    unsubscribe();

    expect(notifications).toBe(1);
  });
});
