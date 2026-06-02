import { describe, expect, it } from "vitest";

import { computeEpisodeCollectionFingerprint } from "./datasetContentFingerprint";
import { buildEpisodeCollectionContentSignature } from "./datasetTreatmentSignatures";
import type { Episode } from "./episodes";
import type { EpisodeJsonEpisode } from "./io/episodeFormat";

const JOINT_ORDER = ["elbow", "shoulder"];

const buildJsonEpisode = (
  frames: EpisodeJsonEpisode["frames"],
  episodeIndex: number
): EpisodeJsonEpisode => ({
  frames,
  jointOrder: JOINT_ORDER,
  metadata: { episode_index: episodeIndex },
});

const buildViewerEpisode = (
  frames: Episode["frames"],
  episodeIndex: number
): Episode => ({
  id: `episode-${episodeIndex}`,
  number: episodeIndex + 1,
  createdAt: episodeIndex + 1,
  frames,
  metadata: { episode_index: episodeIndex },
});

describe("datasetContentFingerprint", () => {
  it("produces stable fingerprints for equivalent episode collections", () => {
    const episodes = [
      buildJsonEpisode([
        {
          timestamp: 0,
          joints: { shoulder: 0.1, elbow: -0.2 },
        },
      ], 0),
      buildJsonEpisode([
        {
          timestamp: 20,
          joints: { shoulder: 0.3, elbow: 0.4 },
        },
      ], 1),
    ];

    const first = computeEpisodeCollectionFingerprint(episodes);
    const second = computeEpisodeCollectionFingerprint([
      episodes[0],
      episodes[1],
    ]);

    expect(first).toBe(second);
  });

  it("changes fingerprints when episode content changes", () => {
    const first = computeEpisodeCollectionFingerprint([
      buildJsonEpisode([
        {
          timestamp: 0,
          joints: { shoulder: 0.1 },
        },
      ], 0),
    ]);
    const second = computeEpisodeCollectionFingerprint([
      buildJsonEpisode([
        {
          timestamp: 0,
          joints: { shoulder: 0.2 },
        },
      ], 0),
    ]);

    expect(first).not.toBe(second);
  });

  it("matches fingerprints across joints and jointPositions frame schemas", () => {
    const jsonFingerprint = computeEpisodeCollectionFingerprint([
      buildJsonEpisode([
        {
          timestamp: 0,
          joints: { shoulder: 0.1, elbow: -0.2 },
        },
        {
          timestamp: 20,
          joints: { elbow: 0.4, shoulder: 0.3 },
        },
      ], 2),
    ]);

    const viewerFingerprint = computeEpisodeCollectionFingerprint([
      buildViewerEpisode([
        {
          timestamp: 0,
          jointPositions: { elbow: -0.2, shoulder: 0.1 },
        },
        {
          timestamp: 20,
          jointPositions: { shoulder: 0.3, elbow: 0.4 },
        },
      ], 2),
    ]);

    expect(jsonFingerprint).toBe(viewerFingerprint);
  });

  it("ignores episode ordering when episode_index metadata is stable", () => {
    const first = computeEpisodeCollectionFingerprint([
      buildJsonEpisode(
        [
          {
            timestamp: 20,
            joints: { shoulder: 0.3, elbow: 0.4 },
          },
        ],
        1
      ),
      buildJsonEpisode(
        [
          {
            timestamp: 0,
            joints: { shoulder: 0.1, elbow: -0.2 },
          },
        ],
        0
      ),
    ]);
    const second = computeEpisodeCollectionFingerprint([
      buildJsonEpisode(
        [
          {
            timestamp: 0,
            joints: { shoulder: 0.1, elbow: -0.2 },
          },
        ],
        0
      ),
      buildJsonEpisode(
        [
          {
            timestamp: 20,
            joints: { shoulder: 0.3, elbow: 0.4 },
          },
        ],
        1
      ),
    ]);

    expect(first).toBe(second);
  });

  it("builds canonical content signatures for episode collections", () => {
    expect(
      buildEpisodeCollectionContentSignature([
        buildJsonEpisode(
          [
            {
              timestamp: 0,
              joints: { shoulder: 0.1, elbow: -0.2 },
            },
          ],
          0
        ),
      ])
    ).toEqual({
      kind: "episode-series-v1",
      episodes: [
        {
          episode_index: 0,
          frames: [
            {
              timestamp: 0,
              joints: { elbow: -0.2, shoulder: 0.1 },
            },
          ],
        },
      ],
    });
  });
});
