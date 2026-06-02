/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addPageVisibilityListener,
  isPageVisible,
  startVisiblePageInterval,
} from "@/shared/lib/pageVisibility";

const VISIBILITY_TEST_INTERVAL_MS = 1000;

const setVisibilityState = (visibilityState: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
};

describe("pageVisibility", () => {
  afterEach(() => {
    vi.useRealTimers();
    setVisibilityState("visible");
  });

  it("reports hidden browser pages as not visible", () => {
    setVisibilityState("hidden");

    expect(isPageVisible()).toBe(false);
  });

  it("removes visibility listeners", () => {
    const listener = vi.fn();
    const remove = addPageVisibilityListener(listener);

    document.dispatchEvent(new Event("visibilitychange"));
    remove();
    document.dispatchEvent(new Event("visibilitychange"));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("runs visible intervals immediately, on timer ticks, and when visibility returns", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    setVisibilityState("visible");

    const stop = startVisiblePageInterval(callback, VISIBILITY_TEST_INTERVAL_MS);
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(VISIBILITY_TEST_INTERVAL_MS);
    expect(callback).toHaveBeenCalledTimes(2);

    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(VISIBILITY_TEST_INTERVAL_MS);
    expect(callback).toHaveBeenCalledTimes(2);

    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(VISIBILITY_TEST_INTERVAL_MS);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
