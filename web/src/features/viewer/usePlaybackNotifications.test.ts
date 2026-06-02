import { describe, expect, it, vi } from "vitest";

import {
  cancelScheduledPlaybackNotification,
  schedulePlaybackNotification,
} from "@/features/viewer/usePlaybackNotifications";
import { PLAYBACK_NOTIFICATIONS_IDLE_TIMEOUT_MS } from "@/features/viewer/playback/playbackNotificationParams";

describe("schedulePlaybackNotification", () => {
  it("uses requestIdleCallback when available", () => {
    const requestIdleCallback = vi.fn(() => 17);
    const run = vi.fn();

    const handle = schedulePlaybackNotification({
      windowWithIdleCallback: {
        requestIdleCallback,
      } as Window & {
        requestIdleCallback: typeof requestIdleCallback;
      },
      run,
    });

    expect(handle).toBe(17);
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: PLAYBACK_NOTIFICATIONS_IDLE_TIMEOUT_MS,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("falls back to setTimeout when idle callbacks are unavailable", () => {
    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi.fn(() => 23 as unknown as number);
    globalThis.setTimeout = setTimeoutSpy as unknown as typeof globalThis.setTimeout;
    const run = vi.fn();

    try {
      const handle = schedulePlaybackNotification({
        windowWithIdleCallback: null,
        run,
      });

      expect(handle).toBe(23);
      expect(setTimeoutSpy).toHaveBeenCalledWith(run, 0);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});

describe("cancelScheduledPlaybackNotification", () => {
  it("uses cancelIdleCallback when available", () => {
    const cancelIdleCallback = vi.fn();

    cancelScheduledPlaybackNotification(
      {
        cancelIdleCallback,
      } as Window & {
        cancelIdleCallback: typeof cancelIdleCallback;
      },
      11
    );

    expect(cancelIdleCallback).toHaveBeenCalledWith(11);
  });

  it("falls back to clearTimeout when idle callbacks are unavailable", () => {
    const originalClearTimeout = globalThis.clearTimeout;
    const clearTimeoutSpy = vi.fn();
    globalThis.clearTimeout = clearTimeoutSpy as unknown as typeof globalThis.clearTimeout;

    try {
      cancelScheduledPlaybackNotification(null, 29);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(29);
    } finally {
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});
