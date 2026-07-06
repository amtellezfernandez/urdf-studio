import { toFiniteNumberOrFallback } from "@/shared/lib/numeric";

export type WorldScenarioEvent = {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
};

export type WorldScenarioClock = {
  getTimeMs: () => number;
  seek: (timeMs: number) => number;
  advance: (deltaMs: number) => number;
};

type CreateWorldScenarioClockParams = {
  durationMs: number;
  loop?: boolean;
  initialTimeMs?: number;
};

export const clampToScenarioTime = (timeMs: number, durationMs: number) => {
  const safeDuration = Math.max(0, toFiniteNumberOrFallback(durationMs, 0));
  if (safeDuration <= 0) return 0;
  return Math.min(safeDuration, Math.max(0, toFiniteNumberOrFallback(timeMs, 0)));
};

export const normalizeScenarioTime = (timeMs: number, durationMs: number) => {
  const safeDuration = Math.max(0, toFiniteNumberOrFallback(durationMs, 0));
  if (safeDuration <= 0) return 0;
  const raw = toFiniteNumberOrFallback(timeMs, 0) % safeDuration;
  return raw < 0 ? raw + safeDuration : raw;
};

export const toScenarioTimeFromFrame = (
  frameIndex: number,
  totalFrames: number,
  durationMs: number
) => {
  const safeDuration = Math.max(0, toFiniteNumberOrFallback(durationMs, 0));
  if (safeDuration <= 0) return 0;
  const safeTotalFrames = Math.max(1, Math.floor(toFiniteNumberOrFallback(totalFrames, 1)));
  if (safeTotalFrames <= 1) return 0;
  const clampedFrame = Math.min(
    safeTotalFrames - 1,
    Math.max(0, Math.floor(toFiniteNumberOrFallback(frameIndex, 0)))
  );
  const alpha = clampedFrame / (safeTotalFrames - 1);
  return alpha * safeDuration;
};

export const createWorldScenarioClock = ({
  durationMs,
  loop = true,
  initialTimeMs = 0,
}: CreateWorldScenarioClockParams): WorldScenarioClock => {
  const safeDuration = Math.max(0, toFiniteNumberOrFallback(durationMs, 0));
  const normalize = loop ? normalizeScenarioTime : clampToScenarioTime;
  let currentMs = normalize(initialTimeMs, safeDuration);

  return {
    getTimeMs: () => currentMs,
    seek: (timeMs) => {
      currentMs = normalize(timeMs, safeDuration);
      return currentMs;
    },
    advance: (deltaMs) => {
      currentMs = normalize(currentMs + toFiniteNumberOrFallback(deltaMs, 0), safeDuration);
      return currentMs;
    },
  };
};
