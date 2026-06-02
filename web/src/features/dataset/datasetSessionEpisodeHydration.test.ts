import { describe, expect, it } from "vitest";

import { hydrateDatasetSessionEpisode } from "@/features/dataset/datasetSessionEpisodeHydration";
import type { DatasetSessionEpisodeDetailResponse } from "@/features/dataset/datasetSessionTypes";

describe("hydrateDatasetSessionEpisode", () => {
  it("builds the exact viewer episode from backend episode detail", () => {
    const episodeNumber = 4;
    const frameCount = 2;
    const durationSec = 0.1;
    const fps = 20;
    const firstTimestamp = 100;
    const secondTimestamp = 200;
    const firstJointPosition = 0.2;
    const secondJointPosition = 0.4;
    const createdAtMs = 1234;
    const detail: DatasetSessionEpisodeDetailResponse = {
      schema_version: "dataset-session/v1",
      session_id: "session-a",
      episode: {
        episode_id: "hf-episode-4",
        episode_number: episodeNumber,
        frame_count: frameCount,
        duration_sec: durationSec,
        fps,
        flagged: false,
        detected_reasons: [],
        manual_reasons: [],
        review_reasons: [],
        source_kind: "hf",
        source_name: "lerobot/example",
        source_id: "hf:lerobot/example:main:train:4",
        canonical_source: "lerobot/example",
        content_fingerprint: "sha256:episode-4",
        robot_type: "so101",
        naming_status: "named",
      },
      frames: [
        {
          timestamp: firstTimestamp,
          joint_positions: { shoulder: firstJointPosition },
        },
        {
          timestamp: secondTimestamp,
          joint_positions: { shoulder: secondJointPosition },
        },
      ],
      metadata: {
        additional: {
          hfConfig: "main",
        },
        createdAt: createdAtMs,
      },
    };

    const episode = hydrateDatasetSessionEpisode(detail);

    expect(episode.id).toBe("hf-episode-4");
    expect(episode.number).toBe(episodeNumber);
    expect(episode.frames).toEqual([
      {
        timestamp: firstTimestamp,
        jointPositions: { shoulder: firstJointPosition },
      },
      {
        timestamp: secondTimestamp,
        jointPositions: { shoulder: secondJointPosition },
      },
    ]);
    expect(episode.metadata).toMatchObject({
      episode_id: "hf-episode-4",
      episodeNumber,
      fps,
      robot_type: "so101",
      naming_status: "named",
      episode_length_sec: durationSec,
      num_frames: frameCount,
      additional: {
        hfConfig: "main",
        sourceType: "hf",
        sourceName: "lerobot/example",
        sourceId: "hf:lerobot/example:main:train:4",
        canonicalSource: "lerobot/example",
        contentFingerprint: "sha256:episode-4",
      },
    });
  });
});
