import { describe, expect, it } from "vitest";

import type { EpisodeMetadata } from "@/features/dataset/io/episodeTypes";
import {
  EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_INSIDE,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_OUTSIDE,
  EPISODE_RECORDED_VIDEO_SYNC_REASON_RETIME,
  EPISODE_RECORDED_VIDEO_SYNC_STATUS_CLIP_ALIGNED,
  EPISODE_RECORDED_VIDEO_SYNC_STATUS_REFERENCE_ONLY,
  markEpisodeRecordedVideoReferenceOnly,
  markEpisodeRecordedVideoSyncAligned,
  resolveEpisodeRecordedVideoSyncInfo,
  resolveEpisodeRecordedVideoSyncMessage,
} from "@/features/dataset/episodeVideoSync";

const VIDEO_METADATA: EpisodeMetadata = {
  videos: {
    front: {
      path: "videos/front.mp4",
    },
  },
};

describe("episodeVideoSync", () => {
  it("defaults recorded episodes to aligned auto-sync when no explicit status is stored", () => {
    const info = resolveEpisodeRecordedVideoSyncInfo(VIDEO_METADATA);

    expect(info.hasRecordedVideo).toBe(true);
    expect(info.status).toBe("aligned");
    expect(info.autoSyncEnabled).toBe(true);
  });

  it("marks trimmed clips as clip-aligned", () => {
    const metadata = markEpisodeRecordedVideoSyncAligned(VIDEO_METADATA, {
      status: EPISODE_RECORDED_VIDEO_SYNC_STATUS_CLIP_ALIGNED,
      reason: EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_OUTSIDE,
    });
    const info = resolveEpisodeRecordedVideoSyncInfo(metadata);

    expect(info.status).toBe(EPISODE_RECORDED_VIDEO_SYNC_STATUS_CLIP_ALIGNED);
    expect(info.reason).toBe(EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_OUTSIDE);
    expect(info.autoSyncEnabled).toBe(true);
    expect(resolveEpisodeRecordedVideoSyncMessage(info)).toContain("trimmed clip");
  });

  it("marks destructive edits as reference-only and disables auto-sync", () => {
    const metadata = markEpisodeRecordedVideoReferenceOnly(VIDEO_METADATA, {
      reason: EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_INSIDE,
    });
    const info = resolveEpisodeRecordedVideoSyncInfo(metadata);

    expect(info.status).toBe(EPISODE_RECORDED_VIDEO_SYNC_STATUS_REFERENCE_ONLY);
    expect(info.reason).toBe(EPISODE_RECORDED_VIDEO_SYNC_REASON_DELETE_INSIDE);
    expect(info.autoSyncEnabled).toBe(false);
    expect(resolveEpisodeRecordedVideoSyncMessage(info)).toContain("reference only");
  });

  it("preserves explicit reference-only notes for reviewer-facing messaging", () => {
    const NOTE = "Source video preserved only for manual review after retime.";
    const metadata = markEpisodeRecordedVideoReferenceOnly(VIDEO_METADATA, {
      reason: EPISODE_RECORDED_VIDEO_SYNC_REASON_RETIME,
      note: NOTE,
    });
    const info = resolveEpisodeRecordedVideoSyncInfo(metadata);

    expect(info.note).toBe(NOTE);
    expect(resolveEpisodeRecordedVideoSyncMessage(info)).toBe(NOTE);
  });

  it("does not add sync metadata when the episode has no recorded videos", () => {
    const metadata = markEpisodeRecordedVideoReferenceOnly(
      {
        additional: {},
      },
      {
        reason: EPISODE_RECORDED_VIDEO_SYNC_REASON_RETIME,
      }
    );

    expect(metadata).toEqual({ additional: {} });
    expect(resolveEpisodeRecordedVideoSyncInfo(metadata).hasRecordedVideo).toBe(false);
  });
});
