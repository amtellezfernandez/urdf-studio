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

  it("defaults to disabled ROS Viz", () => {
    expect(isFeatureFlagEnabled("rosViz")).toBe(false);
    expect(getFeatureFlagSource("rosViz")).toBe("default");
    expect(isFeatureFlagUrlLocked("rosViz")).toBe(false);
  });

  it("defaults motion kernel to enabled", () => {
    expect(isFeatureFlagEnabled("motionKernel")).toBe(true);
    expect(getFeatureFlagSource("motionKernel")).toBe("default");
    expect(isFeatureFlagUrlLocked("motionKernel")).toBe(false);
  });

  it("persists runtime flag to localStorage", () => {
    setFeatureFlag("rosViz", true);

    expect(isFeatureFlagEnabled("rosViz")).toBe(true);
    expect(getFeatureFlagSource("rosViz")).toBe("localStorage");
    expect(isFeatureFlagUrlLocked("rosViz")).toBe(false);
  });

  it("treats URL flags as authoritative and locked", () => {
    setFeatureFlag("rosViz", true);
    window.history.replaceState({}, "", "/?flags=-rosViz");

    expect(isFeatureFlagEnabled("rosViz")).toBe(false);
    expect(getFeatureFlagSource("rosViz")).toBe("url");
    expect(isFeatureFlagUrlLocked("rosViz")).toBe(true);
  });

  it("notifies subscribers when flag changes", () => {
    let notifications = 0;
    const unsubscribe = subscribeFeatureFlags(() => {
      notifications += 1;
    });

    setFeatureFlag("rosViz", true);
    unsubscribe();

    expect(notifications).toBe(1);
  });
});
