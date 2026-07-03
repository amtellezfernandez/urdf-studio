import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { AnimationFrame } from "@/features/viewer/viewer-types";

const DEFAULT_FPS = 60;
const DEFAULT_DURATION_MS = 4000;
const DEFAULT_DEMO_COUNT = 3;

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

type DemoProfile = {
  id: string;
  label: string;
  durationMs: number;
  fps: number;
  amplitudeScale: number;
  wave: (t: number, jointIndex: number, phase: number) => number;
};

export type DemoMotionFrame = {
  timestamp: number;
  jointPositions: Record<string, number>;
};

export type DemoMotionSequence = {
  id: string;
  frames: DemoMotionFrame[];
  createdAt: number;
  metadata: {
    joint_names: string[];
    source: "demo";
    label: string;
    createdAt: number;
    num_frames: number;
    fps: number;
    additional: {
      demoType: string;
    };
  };
};

const easeInOut = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * t);

const createWaveFrames = ({
  jointNames,
  jointLimits,
  fps,
  durationMs,
  wave,
  amplitudeScale,
}: {
  jointNames: string[];
  jointLimits?: JointLimits;
  fps: number;
  durationMs: number;
  wave: (t: number, jointIndex: number, phase: number) => number;
  amplitudeScale: number;
}) => {
  const frameInterval = 1000 / fps;
  const totalFrames = Math.max(2, Math.floor(durationMs / frameInterval));
  const ranges = jointNames.map((name) => resolveJointRange(name, jointLimits));

  return Array.from({ length: totalFrames }, (_, index) => {
    const t = index / (totalFrames - 1);
    const timestamp = Math.round(index * frameInterval);
    const jointPositions: Record<string, number> = {};
    const ramp = easeInOut(Math.min(1, t / 0.12));

    jointNames.forEach((name, jointIndex) => {
      const { center, amplitude } = ranges[jointIndex];
      const phase = jointIndex * 0.6;
      const waveValue = wave(t, jointIndex, phase) * ramp;
      const rawValue = center + amplitude * amplitudeScale * waveValue;
      const limit = jointLimits?.[name];
      jointPositions[name] = clamp(rawValue, limit?.lower, limit?.upper);
    });

    return { timestamp, jointPositions };
  });
};

const DEMO_PROFILES: DemoProfile[] = [
  {
    id: "sweep",
    label: "Sweep",
    durationMs: DEFAULT_DURATION_MS,
    fps: DEFAULT_FPS,
    amplitudeScale: 1,
    wave: (t, jointIndex, phase) =>
      Math.sin(2 * Math.PI * (0.75 + jointIndex * 0.12) * t + phase),
  },
  {
    id: "pickup",
    label: "Pick & Place",
    durationMs: 5200,
    fps: DEFAULT_FPS,
    amplitudeScale: 0.85,
    wave: (t, jointIndex, phase) => {
      const holdStart = 0.35;
      const holdEnd = 0.65;
      let ramp = 0;
      if (t <= holdStart) {
        ramp = easeInOut(t / holdStart);
      } else if (t <= holdEnd) {
        ramp = 1;
      } else {
        ramp = 1 - easeInOut((t - holdEnd) / (1 - holdEnd));
      }
      const direction = jointIndex % 2 === 0 ? 1 : -1;
      const wiggle = Math.sin(2 * Math.PI * 1.1 * t + phase) * 0.15;
      return direction * ramp + wiggle;
    },
  },
  {
    id: "inspect",
    label: "Inspect",
    durationMs: 6400,
    fps: DEFAULT_FPS,
    amplitudeScale: 0.7,
    wave: (t, jointIndex, phase) => {
      const slow = Math.sin(2 * Math.PI * (0.35 + jointIndex * 0.04) * t + phase);
      const fast = Math.sin(2 * Math.PI * (1.1 + jointIndex * 0.05) * t + phase * 0.5);
      return slow * 0.7 + fast * 0.3;
    },
  },
];

export const createDemoMotionSequences = ({
  jointNames,
  jointLimits,
  profiles = DEMO_PROFILES,
}: {
  jointNames: string[];
  jointLimits?: JointLimits;
  profiles?: DemoProfile[];
}): DemoMotionSequence[] => {
  const baseId = Date.now();
  const safeProfiles = profiles.slice(0, DEFAULT_DEMO_COUNT);
  const activeProfiles = safeProfiles.length > 1 ? safeProfiles.slice(1) : safeProfiles;
  return activeProfiles.map((profile) => {
    const frames = createWaveFrames({
      jointNames,
      jointLimits,
      fps: profile.fps,
      durationMs: profile.durationMs,
      wave: profile.wave,
      amplitudeScale: profile.amplitudeScale,
    });
    const createdAt = Date.now();
    return {
      id: `demo-${profile.id}-${baseId}`,
      frames,
      createdAt,
      metadata: {
        joint_names: jointNames,
        source: "demo",
        label: profile.label,
        createdAt,
        num_frames: frames.length,
        fps: profile.fps,
        additional: {
          demoType: profile.id,
        },
      },
    };
  });
};

export const toDemoAnimationFrames = (sequence: DemoMotionSequence): AnimationFrame[] =>
  sequence.frames.map((frame) => ({
    timestamp: frame.timestamp,
    joints: frame.jointPositions,
  }));
