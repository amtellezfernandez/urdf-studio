import type { RecordedKeyframe } from "@/features/scenarios/waypointRecording";
import { MOTION_LIBRARY_PARAMS } from "@/features/scenarios/motionLibraryParams";

export type MotionClip = {
  id: string;
  name: string;
  createdAt: string;
  keyframes: RecordedKeyframe[];
};

const cloneKeyframes = (keyframes: RecordedKeyframe[]): RecordedKeyframe[] =>
  keyframes.map((keyframe) => ({ ...keyframe, joints: { ...keyframe.joints } }));

const isRecordedKeyframe = (value: unknown): value is RecordedKeyframe => {
  if (!value || typeof value !== "object") return false;
  const keyframe = value as { time_s?: unknown; joints?: unknown };
  return (
    typeof keyframe.time_s === "number" &&
    Number.isFinite(keyframe.time_s) &&
    Boolean(keyframe.joints) &&
    typeof keyframe.joints === "object"
  );
};

export const readMotionLibrary = (storage: Storage = window.localStorage): MotionClip[] => {
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(MOTION_LIBRARY_PARAMS.storageKey) ?? "[]"
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((clip): clip is MotionClip =>
        Boolean(clip) &&
        typeof clip === "object" &&
        typeof (clip as MotionClip).id === "string" &&
        typeof (clip as MotionClip).name === "string" &&
        Array.isArray((clip as MotionClip).keyframes) &&
        (clip as MotionClip).keyframes.every(isRecordedKeyframe)
      )
      .map((clip) => ({ ...clip, keyframes: cloneKeyframes(clip.keyframes) }));
  } catch {
    return [];
  }
};

export const writeMotionLibrary = (
  clips: MotionClip[],
  storage: Storage = window.localStorage
): void => storage.setItem(MOTION_LIBRARY_PARAMS.storageKey, JSON.stringify(clips));

export const createMotionClip = (name: string, keyframes: RecordedKeyframe[]): MotionClip => ({
  id: crypto.randomUUID(),
  name: name.trim(),
  createdAt: new Date().toISOString(),
  keyframes: cloneKeyframes(keyframes),
});
