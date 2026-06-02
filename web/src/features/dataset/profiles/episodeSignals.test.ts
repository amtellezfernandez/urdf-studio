import { describe, expect, it } from "vitest";

import type { Episode } from "@/features/dataset/episodes";
import {
  resolveEpisodeSignalMode,
  resolveEpisodeSignalModeLabel,
  resolveEpisodeWorldSnapshotWarning,
} from "@/features/dataset/profiles/episodeSignals";

const buildEpisode = (overrides?: Partial<Episode>): Episode => ({
  id: "episode-1",
  number: 1,
  createdAt: 0,
  frames: [
    {
      timestamp: 0,
      jointPositions: { joint_a: 0 },
    },
  ],
  metadata: {},
  ...overrides,
});

describe("episode signal helpers", () => {
  it("classifies joint-only episodes when base pose is absent", () => {
    const episode = buildEpisode();
    expect(resolveEpisodeSignalMode(episode)).toBe("joint-only");
    expect(resolveEpisodeSignalModeLabel(episode)).toBe("joint-only");
  });

  it("classifies base-pose when base pose exists and profile is lekiwi_client", () => {
    const episode = buildEpisode({
      frames: [
        {
          timestamp: 0,
          jointPositions: { joint_a: 0 },
          basePose: {
            position: { x: 0, y: 0, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
      ],
      metadata: { signal_profile_id: "lekiwi_client" },
    });
    expect(resolveEpisodeSignalMode(episode)).toBe("base-pose");
  });

  it("classifies base-pose when base pose exists but profile is not twist", () => {
    const episode = buildEpisode({
      frames: [
        {
          timestamp: 0,
          jointPositions: { joint_a: 0 },
          basePose: {
            position: { x: 0, y: 0, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
      ],
      metadata: { signal_profile_id: "urdf_native" },
    });
    expect(resolveEpisodeSignalMode(episode)).toBe("base-pose");
  });

  it("uses metadata signal base mode for lazy episodes without loaded frames", () => {
    const episode = buildEpisode({
      frames: [],
      metadata: {
        signal_profile_id: "lekiwi_client",
        signal_base_mode: "pose",
      },
    });
    expect(resolveEpisodeSignalMode(episode)).toBe("base-pose");
    expect(resolveEpisodeSignalModeLabel(episode)).toBe("base-pose");
  });

  it("returns no warning when active world snapshot is missing", () => {
    const episode = buildEpisode({
      metadata: {
        world_snapshot_ref: {
          package_id: "lekiwi-demo",
          version: "1.0.0",
        },
      },
    });
    expect(
      resolveEpisodeWorldSnapshotWarning({
        episode,
        activeWorldSnapshotRef: null,
      })
    ).toBeNull();
  });

  it("returns no warning when world ref matches active package", () => {
    const episode = buildEpisode({
      metadata: {
        world_snapshot_ref: {
          package_id: "lekiwi-demo",
          version: "1.0.0",
        },
      },
    });
    expect(
      resolveEpisodeWorldSnapshotWarning({
        episode,
        activeWorldSnapshotRef: {
          package_id: "lekiwi-demo",
          version: "1.0.0",
        },
      })
    ).toBeNull();
  });

  it("returns mismatch warning when world ref differs from active package", () => {
    const episode = buildEpisode({
      metadata: {
        world_snapshot_ref: {
          package_id: "lekiwi-demo",
          version: "1.0.0",
        },
      },
    });
    expect(
      resolveEpisodeWorldSnapshotWarning({
        episode,
        activeWorldSnapshotRef: {
          package_id: "other-world",
          version: "2.0.0",
        },
      })
    ).toBe("world mismatch: expected lekiwi-demo@1.0.0");
  });
});
