import { resolveFrozenPlaybackFrameSelection } from "@/features/viewer/playback/frameSelection";
import type { AnimationFrame } from "@/features/viewer/viewer-types";

export const clampPlaybackWallClockStepMs = (
  stepMs: number,
  maxStepMs: number
) => {
  if (!Number.isFinite(stepMs) || stepMs <= 0) {
    return 0;
  }
  return Math.min(stepMs, maxStepMs);
};

export const resolvePlaybackAnchorTime = (
  frames: AnimationFrame[],
  fallbackFrameIndex: number
) => resolveFrozenPlaybackFrameSelection(frames, fallbackFrameIndex).frameTime;

export const advancePlaybackClockTime = ({
  currentPlaybackTime,
  frames,
  maxStepMs,
  nowMs,
  playbackSpeed,
  previousNowMs,
}: {
  currentPlaybackTime: number | null;
  frames: AnimationFrame[];
  maxStepMs: number;
  nowMs: number;
  playbackSpeed: number;
  previousNowMs: number | null;
}) => {
  const firstTimestamp = frames[0]?.timestamp ?? 0;
  const lastTimestamp = frames[frames.length - 1]?.timestamp ?? firstTimestamp;
  const basePlaybackTime = currentPlaybackTime ?? firstTimestamp;
  if (previousNowMs === null) {
    return {
      playbackTime: basePlaybackTime,
      previousNowMs: nowMs,
    };
  }

  const wallClockStepMs = clampPlaybackWallClockStepMs(nowMs - previousNowMs, maxStepMs);
  return {
    playbackTime: Math.min(
      lastTimestamp,
      basePlaybackTime + wallClockStepMs * playbackSpeed
    ),
    previousNowMs: nowMs,
  };
};
