import { describe, expect, it } from "vitest";
import {
  classifyEpisodeFetchError,
  DEFAULT_THROTTLED_RETRY_MS,
  isEpisodeStateTransitionAllowed,
  isEpisodeThrottleWindowActive,
  resolveEpisodeStateTransition,
} from "@/features/dataset/episode-pipeline/episodePipelineController";

describe("classifyEpisodeFetchError", () => {
  it("classifies throttled errors with default retry", () => {
    const result = classifyEpisodeFetchError(new Error("Episode fetch is rate-limited right now"));
    expect(result.kind).toBe("throttled");
    expect(result.retryAfterMs).toBe(DEFAULT_THROTTLED_RETRY_MS);
  });

  it("classifies throttled errors with explicit retry seconds", () => {
    const result = classifyEpisodeFetchError(new Error("Throttle active, retry in 7 seconds"));
    expect(result.kind).toBe("throttled");
    expect(result.retryAfterMs).toBe(7000);
  });

  it("classifies not-ready errors", () => {
    const result = classifyEpisodeFetchError(
      new Error("Episode is indexed but not ready yet. Try loading it again.")
    );
    expect(result.kind).toBe("not_ready");
  });

  it("classifies empty frame errors", () => {
    const result = classifyEpisodeFetchError(new Error("Episode has no frames"));
    expect(result.kind).toBe("empty");
  });
});

describe("isEpisodeThrottleWindowActive", () => {
  const BASE_TIME_MS = 10_000;

  it("returns false for non-throttled states", () => {
    expect(
      isEpisodeThrottleWindowActive(
        {
          status: "ready",
          updatedAt: BASE_TIME_MS,
        },
        BASE_TIME_MS
      )
    ).toBe(false);
  });

  it("returns true while retry window is active", () => {
    expect(
      isEpisodeThrottleWindowActive(
        {
          status: "throttled",
          updatedAt: BASE_TIME_MS,
          retryAfterMs: 3000,
        },
        BASE_TIME_MS + 2000
      )
    ).toBe(true);
  });

  it("returns false once retry window expires", () => {
    expect(
      isEpisodeThrottleWindowActive(
        {
          status: "throttled",
          updatedAt: BASE_TIME_MS,
          retryAfterMs: 3000,
        },
        BASE_TIME_MS + 3000
      )
    ).toBe(false);
  });
});

describe("episode state transitions", () => {
  it("allows known transition pairs", () => {
    expect(isEpisodeStateTransitionAllowed("indexed", "loading")).toBe(true);
    expect(isEpisodeStateTransitionAllowed("loading", "throttled")).toBe(true);
    expect(isEpisodeStateTransitionAllowed("ready", "indexed")).toBe(true);
  });

  it("rejects unsupported transition pairs", () => {
    expect(isEpisodeStateTransitionAllowed("error", "throttled")).toBe(false);
  });

  it("keeps previous state when an unsupported transition is requested", () => {
    expect(resolveEpisodeStateTransition("error", "throttled", "ep-1")).toBe("error");
  });
});
