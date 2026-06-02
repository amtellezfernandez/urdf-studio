import { describe, expect, it } from "vitest";

import {
  createEpisode,
  resolveActiveReplayEpisode,
  resolveEpisodeJointNames,
  resolveEpisodeSignalCatalogNames,
  resolvePersistedEpisodeIndex,
  toAnimationFrames,
} from "@/features/dataset/episodes";

const PLAYBACK_FIRST_FRAME_INDEX = 0;
const PLAYBACK_SECOND_FRAME_INDEX = 1;
const PLAYBACK_POSE_PRECISION_DECIMALS = 8;
const PLAYBACK_FIXTURE_FRAMES = [
  {
    timestamp: 0,
    jointPositions: { wheel_left_joint: 0.1 },
    basePose: {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    },
  },
  {
    timestamp: 20,
    jointPositions: { wheel_left_joint: 0.35 },
    basePose: {
      position: { x: 0.18, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0.08, w: 0.9968 },
    },
  },
] as const;

describe("createEpisode", () => {
  it("auto-derives embodiment_ref from non-unknown robot_type", () => {
    const episode = createEpisode(
      "episode-1",
      1,
      [
        {
          timestamp: 0,
          jointPositions: { shoulder: 0 },
        },
      ],
      {
        robot_type: "Franka Panda",
      }
    );

    expect(episode.metadata?.embodiment_ref?.embodiment_id).toBe(
      "urdfstudio:franka-panda:v1"
    );
  });

  it("does not auto-derive embodiment_ref for unknown robot_type", () => {
    const episode = createEpisode(
      "episode-2",
      1,
      [
        {
          timestamp: 0,
          jointPositions: { shoulder: 0 },
        },
      ],
      {
        robot_type: "unknown",
      }
    );

    expect(episode.metadata?.embodiment_ref).toBeUndefined();
  });
});

describe("toAnimationFrames", () => {
  it("preserves imported joint motion and base pose for viewer playback", () => {
    const episode = createEpisode(
      "episode-playback",
      1,
      PLAYBACK_FIXTURE_FRAMES.map((frame) => ({
        timestamp: frame.timestamp,
        jointPositions: { ...frame.jointPositions },
        basePose: {
          position: { ...frame.basePose.position },
          quaternion: { ...frame.basePose.quaternion },
        },
      })),
      undefined
    );

    const playbackFrames = toAnimationFrames(episode);
    const firstExpected = PLAYBACK_FIXTURE_FRAMES[PLAYBACK_FIRST_FRAME_INDEX];
    const secondExpected = PLAYBACK_FIXTURE_FRAMES[PLAYBACK_SECOND_FRAME_INDEX];

    expect(playbackFrames[PLAYBACK_FIRST_FRAME_INDEX]?.joints.wheel_left_joint).toBe(
      firstExpected.jointPositions.wheel_left_joint
    );
    expect(playbackFrames[PLAYBACK_SECOND_FRAME_INDEX]?.joints.wheel_left_joint).toBe(
      secondExpected.jointPositions.wheel_left_joint
    );
    expect(playbackFrames[PLAYBACK_SECOND_FRAME_INDEX]?.basePose?.position.x).toBeCloseTo(
      secondExpected.basePose.position.x,
      PLAYBACK_POSE_PRECISION_DECIMALS
    );
    expect(playbackFrames[PLAYBACK_SECOND_FRAME_INDEX]?.basePose?.quaternion.z).toBeCloseTo(
      secondExpected.basePose.quaternion.z,
      PLAYBACK_POSE_PRECISION_DECIMALS
    );
    expect(playbackFrames[PLAYBACK_SECOND_FRAME_INDEX]?.basePose).not.toBe(
      episode.frames[PLAYBACK_SECOND_FRAME_INDEX]?.basePose
    );
  });
});

describe("resolveEpisodeJointNames", () => {
  it("includes metadata names, frame joints, and derived base-pose signals", () => {
    const episode = createEpisode(
      "episode-3",
      1,
      [
        {
          timestamp: 0,
          jointPositions: { wheel_left_joint: 0 },
          basePose: {
            position: { x: 0.1, y: -0.2, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
      ],
      {
        joint_names: ["shoulder_pan"],
      }
    );

    expect(resolveEpisodeJointNames(episode)).toEqual([
      "shoulder_pan",
      "theta",
      "wheel_left_joint",
      "x_mm",
      "y_mm",
    ]);
  });
});

describe("resolveEpisodeSignalCatalogNames", () => {
  it("returns a stable union across episode catalogs", () => {
    const firstEpisode = createEpisode(
      "episode-4",
      1,
      [{ timestamp: 0, jointPositions: { shoulder_pan: 0 } }],
      undefined
    );
    const secondEpisode = createEpisode(
      "episode-5",
      2,
      [
        {
          timestamp: 0,
          jointPositions: { wheel_left_joint: 0 },
          basePose: {
            position: { x: 0, y: 0, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
      ],
      undefined
    );

    expect(
      resolveEpisodeSignalCatalogNames({
        activeEpisode: firstEpisode,
        allEpisodes: [firstEpisode, secondEpisode],
      })
    ).toEqual(["shoulder_pan", "theta", "wheel_left_joint", "x_mm", "y_mm"]);
  });
});

describe("resolvePersistedEpisodeIndex", () => {
  it("preserves the source episode index when metadata provides one", () => {
    expect(resolvePersistedEpisodeIndex({ episode_index: 42 }, 7)).toBe(42);
  });

  it("falls back to the provided index when metadata is missing or invalid", () => {
    expect(resolvePersistedEpisodeIndex(undefined, 7)).toBe(7);
    expect(
      resolvePersistedEpisodeIndex({ episode_index: Number.NaN }, 7)
    ).toBe(7);
  });
});

describe("resolveActiveReplayEpisode", () => {
  it("prefers the live playback draft when it matches the selected episode id", () => {
    const savedEpisode = createEpisode(
      "episode-6",
      1,
      [{ timestamp: 0, jointPositions: { wheel_left_joint: 0 } }],
      undefined
    );
    const liveDraft = {
      ...savedEpisode,
      metadata: {
        ...savedEpisode.metadata,
        label: "Unsaved draft",
      },
    };

    expect(
      resolveActiveReplayEpisode({
        episodes: [savedEpisode],
        currentPlayingEpisodeIndex: 0,
        playbackEpisode: liveDraft,
      })
    ).toBe(liveDraft);
  });

  it("ignores stale playback overrides for different episodes", () => {
    const firstEpisode = createEpisode(
      "episode-7",
      1,
      [{ timestamp: 0, jointPositions: { shoulder_pan: 0 } }],
      undefined
    );
    const secondEpisode = createEpisode(
      "episode-8",
      2,
      [{ timestamp: 0, jointPositions: { wheel_left_joint: 0 } }],
      undefined
    );

    expect(
      resolveActiveReplayEpisode({
        episodes: [firstEpisode, secondEpisode],
        currentPlayingEpisodeIndex: 0,
        playbackEpisode: secondEpisode,
      })
    ).toBe(firstEpisode);
  });
});
