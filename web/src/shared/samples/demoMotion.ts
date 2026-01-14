import type { JointLimits } from "@/features/urdf";
import { createEpisode, type Episode } from "@/features/dataset/episodes";

const DEFAULT_FPS = 30;
const DEFAULT_DURATION_MS = 4000;

const clamp = (value: number, lower?: number | null, upper?: number | null) => {
  if (lower !== null && lower !== undefined) {
    value = Math.max(lower, value);
  }
  if (upper !== null && upper !== undefined) {
    value = Math.min(upper, value);
  }
  return value;
};

const resolveJointRange = (
  jointName: string,
  jointLimits?: JointLimits
): { center: number; amplitude: number } => {
  const limit = jointLimits?.[jointName];
  if (!limit) {
    return { center: 0, amplitude: 0.6 };
  }

  if (limit.type === "fixed") {
    return { center: 0, amplitude: 0 };
  }

  if (limit.lower === null || limit.upper === null) {
    return { center: 0, amplitude: 0.8 };
  }

  const center = (limit.lower + limit.upper) / 2;
  const amplitude = Math.max(0.1, Math.abs(limit.upper - limit.lower) * 0.45);
  return { center, amplitude };
};

export const createDemoEpisode = ({
  jointNames,
  jointLimits,
  fps = DEFAULT_FPS,
  durationMs = DEFAULT_DURATION_MS,
}: {
  jointNames: string[];
  jointLimits?: JointLimits;
  fps?: number;
  durationMs?: number;
}): Episode => {
  const frameInterval = 1000 / fps;
  const totalFrames = Math.max(2, Math.floor(durationMs / frameInterval));
  const ranges = jointNames.map((name) => resolveJointRange(name, jointLimits));

  const frames = Array.from({ length: totalFrames }, (_, index) => {
    const t = index / (totalFrames - 1);
    const timestamp = Math.round(index * frameInterval);
    const jointPositions: Record<string, number> = {};

    jointNames.forEach((name, jointIndex) => {
      const { center, amplitude } = ranges[jointIndex];
      const phase = jointIndex * 0.6;
      const wave = Math.sin(2 * Math.PI * (0.75 + jointIndex * 0.15) * t + phase);
      const rawValue = center + amplitude * wave;
      const limit = jointLimits?.[name];
      jointPositions[name] = clamp(rawValue, limit?.lower, limit?.upper);
    });

    return { timestamp, jointPositions };
  });

  return createEpisode(`demo-${Date.now()}`, 1, frames, {
    joint_names: jointNames,
    source: "demo",
    createdAt: Date.now(),
    num_frames: frames.length,
  });
};
