import type { AnimationFrame } from "@/features/viewer/viewer-types";
import {
  clampTimestampToFrameRange,
  resolveFrameIndexAtOrBeforeTimestamp,
} from "@/features/viewer/playbackSampling";

export type PlaybackFrameSelection = {
  frameTime: number;
  frameIndex: number;
};

export const resolvePlaybackFrameSelection = (
  frames: AnimationFrame[],
  timestamp: number
): PlaybackFrameSelection => {
  const clampedTime = clampTimestampToFrameRange(frames, timestamp);
  return {
    frameTime: clampedTime,
    frameIndex: resolveFrameIndexAtOrBeforeTimestamp(frames, clampedTime),
  };
};

export const resolveFrozenPlaybackFrameSelection = (
  frames: AnimationFrame[],
  fallbackFrameIndex: number
): PlaybackFrameSelection => {
  const clampedIndex = Math.max(0, Math.min(fallbackFrameIndex, frames.length - 1));
  const firstTimestamp = frames[0]?.timestamp ?? 0;
  const frameTime = frames[clampedIndex]?.timestamp ?? firstTimestamp;
  return {
    frameTime,
    frameIndex: clampedIndex,
  };
};
