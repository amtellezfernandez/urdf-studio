import { describe, expect, it } from "vitest";

import { PLAYBACK_JOINT_STORE_SYNC_INTERVAL_MS } from "@/features/viewer/playback/playbackParams";
import { shouldSyncPlaybackJointStore } from "@/features/viewer/playback/jointStoreSyncPolicy";

describe("shouldSyncPlaybackJointStore", () => {
  it("syncs immediately when playback is paused and frame joints changed", () => {
    expect(
      shouldSyncPlaybackJointStore({
        frameLockedJoints: { shoulder: 1 },
        storeJointValues: { shoulder: 0 },
        isPlaying: false,
        reachedPlaybackEnd: false,
        nowMs: 100,
        lastSyncTimeMs: 50,
      })
    ).toBe(true);
  });

  it("syncs final playback frame even if cadence window has not elapsed", () => {
    expect(
      shouldSyncPlaybackJointStore({
        frameLockedJoints: { shoulder: 1 },
        storeJointValues: { shoulder: 0 },
        isPlaying: true,
        reachedPlaybackEnd: true,
        nowMs: 100,
        lastSyncTimeMs: 90,
      })
    ).toBe(true);
  });

  it("throttles playback store updates while frames are advancing", () => {
    expect(
      shouldSyncPlaybackJointStore({
        frameLockedJoints: { shoulder: 1 },
        storeJointValues: { shoulder: 0 },
        isPlaying: true,
        reachedPlaybackEnd: false,
        nowMs: 100,
        lastSyncTimeMs: 100 - PLAYBACK_JOINT_STORE_SYNC_INTERVAL_MS + 1,
      })
    ).toBe(false);
  });

  it("allows playback store updates once the cadence interval elapses", () => {
    expect(
      shouldSyncPlaybackJointStore({
        frameLockedJoints: { shoulder: 1 },
        storeJointValues: { shoulder: 0 },
        isPlaying: true,
        reachedPlaybackEnd: false,
        nowMs: 100,
        lastSyncTimeMs: 100 - PLAYBACK_JOINT_STORE_SYNC_INTERVAL_MS,
      })
    ).toBe(true);
  });

  it("skips sync when playback joints already match the store", () => {
    expect(
      shouldSyncPlaybackJointStore({
        frameLockedJoints: { shoulder: 1 },
        storeJointValues: { shoulder: 1, elbow: 2 },
        isPlaying: true,
        reachedPlaybackEnd: false,
        nowMs: 100,
        lastSyncTimeMs: null,
      })
    ).toBe(false);
  });
});
