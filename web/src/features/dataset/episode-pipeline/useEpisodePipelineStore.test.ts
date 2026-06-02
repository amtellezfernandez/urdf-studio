import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEpisodePipelineStore } from "@/features/dataset/episode-pipeline/useEpisodePipelineStore";

describe("useEpisodePipelineStore", () => {
  beforeEach(() => {
    useEpisodePipelineStore.getState().resetAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deduplicates beginEpisodeLoad for the same id", () => {
    const store = useEpisodePipelineStore.getState();
    const first = store.beginEpisodeLoad("ep-1", "Loading episode");
    const second = store.beginEpisodeLoad("ep-1", "Loading episode");

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(useEpisodePipelineStore.getState().episodeStates["ep-1"]?.status).toBe("loading");
  });

  it("marks lazy episodes as indexed and loaded episodes as ready", () => {
    useEpisodePipelineStore.getState().syncEpisodeReadiness([
      { id: "lazy-1", hasFrames: false, isLazy: true },
      { id: "ready-1", hasFrames: true, isLazy: false },
    ]);

    const state = useEpisodePipelineStore.getState().episodeStates;
    expect(state["lazy-1"]?.status).toBe("indexed");
    expect(state["ready-1"]?.status).toBe("ready");
  });

  it("clears pipeline state for removed episodes", () => {
    const store = useEpisodePipelineStore.getState();
    store.setEpisodeState("ep-a", { status: "ready" });
    store.setEpisodeState("ep-b", { status: "loading", message: "Loading" });

    store.clearMissingEpisodes(["ep-b"]);

    const current = useEpisodePipelineStore.getState();
    expect(current.episodeStates["ep-a"]).toBeUndefined();
    expect(current.episodeStates["ep-b"]?.status).toBe("loading");
  });

  it("ignores invalid status transitions", () => {
    const store = useEpisodePipelineStore.getState();
    store.setEpisodeState("ep-1", { status: "error", message: "fatal" });
    store.setEpisodeState("ep-1", { status: "throttled", retryAfterMs: 5000 });

    const state = useEpisodePipelineStore.getState().episodeStates["ep-1"];
    expect(state?.status).toBe("error");
    expect(state?.message).toBe("fatal");
    expect(state?.retryAfterMs).toBeUndefined();
  });

  it("does not rewrite state when the next payload is equivalent", () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000);
    useEpisodePipelineStore.getState().setEpisodeState("ep-1", {
      status: "throttled",
      retryAfterMs: 3000,
    });
    const firstUpdatedAt = useEpisodePipelineStore.getState().episodeStates["ep-1"]?.updatedAt;

    nowSpy.mockReturnValueOnce(2000);
    useEpisodePipelineStore.getState().setEpisodeState("ep-1", {
      status: "throttled",
      retryAfterMs: 3000,
    });
    const secondUpdatedAt = useEpisodePipelineStore.getState().episodeStates["ep-1"]?.updatedAt;

    expect(firstUpdatedAt).toBe(1000);
    expect(secondUpdatedAt).toBe(1000);
  });

  it("removes non-loading ids when readiness sync no longer reports loading", () => {
    const store = useEpisodePipelineStore.getState();
    store.setEpisodeState("ep-loading", { status: "loading", message: "Loading" });
    store.syncEpisodeReadiness([{ id: "ep-loading", hasFrames: true, isLazy: false }]);

    const current = useEpisodePipelineStore.getState();
    expect(current.episodeStates["ep-loading"]?.status).toBe("ready");
    expect(current.loadingEpisodeIds).toEqual([]);
  });
});
