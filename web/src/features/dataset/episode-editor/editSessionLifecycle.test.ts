import { describe, expect, it } from "vitest";

import { resolveEpisodeViewerEditSessionLifecycleAction } from "@/features/dataset/episode-editor/editSessionLifecycle";

const PREVIOUS_EPISODE_ID = "episode-a";
const NEXT_EPISODE_ID = "episode-b";

describe("resolveEpisodeViewerEditSessionLifecycleAction", () => {
  it("clears viewer edit state when no episode remains mounted", () => {
    expect(
      resolveEpisodeViewerEditSessionLifecycleAction({
        previousEpisodeId: PREVIOUS_EPISODE_ID,
        nextEpisodeId: null,
        isEditMode: true,
      })
    ).toBe("clear");
  });

  it("resets edit state for a real episode id switch", () => {
    expect(
      resolveEpisodeViewerEditSessionLifecycleAction({
        previousEpisodeId: PREVIOUS_EPISODE_ID,
        nextEpisodeId: NEXT_EPISODE_ID,
        isEditMode: true,
      })
    ).toBe("reset");
  });

  it("preserves edit mode across same-episode parent refreshes", () => {
    expect(
      resolveEpisodeViewerEditSessionLifecycleAction({
        previousEpisodeId: PREVIOUS_EPISODE_ID,
        nextEpisodeId: PREVIOUS_EPISODE_ID,
        isEditMode: true,
      })
    ).toBe("preserve");
  });

  it("refreshes draft state for same-episode updates outside edit mode", () => {
    expect(
      resolveEpisodeViewerEditSessionLifecycleAction({
        previousEpisodeId: PREVIOUS_EPISODE_ID,
        nextEpisodeId: PREVIOUS_EPISODE_ID,
        isEditMode: false,
      })
    ).toBe("refresh");
  });
});
