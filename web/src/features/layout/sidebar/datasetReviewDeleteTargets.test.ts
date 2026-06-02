import { describe, expect, it } from "vitest";

import { createEpisode } from "@/features/dataset/episodes";
import { resolveLiveEpisodeIdsForReviewDelete } from "@/features/layout/sidebar/datasetReviewDeleteTargets";

describe("resolveLiveEpisodeIdsForReviewDelete", () => {
  it("matches backend review episodes to live HF lazy episodes by source id", () => {
    const liveEpisode = createEpisode(
      "hf-lazy-lerobot-demo-main-train-4-1700000000",
      1,
      [],
      {
        additional: {
          sourceId: "hf:lerobot/demo:main:train:4",
        },
      }
    );

    expect(
      resolveLiveEpisodeIdsForReviewDelete({
        episodes: [liveEpisode],
        reviewEpisodes: [
          {
            episode_id: "hf-lerobot-demo-main-train-4",
            source_id: "hf:lerobot/demo:main:train:4",
          },
        ],
      })
    ).toEqual([liveEpisode.id]);
  });

  it("keeps direct local episode id deletion working", () => {
    expect(
      resolveLiveEpisodeIdsForReviewDelete({
        episodes: [
          createEpisode("recorded-episode-a", 1, [], undefined),
          createEpisode("recorded-episode-b", 2, [], undefined),
        ],
        reviewEpisodes: [{ episode_id: "recorded-episode-b" }],
      })
    ).toEqual(["recorded-episode-b"]);
  });
});
