import type { JointLimits } from "@/shared/lib/urdfBrowser";
import { createEpisode, type Episode } from "@/features/dataset/episodes";

const DEFAULT_FPS = 60;
const DEFAULT_DURATION_MS = 4000;
const DEFAULT_DEMO_COUNT = 3;
const SO101_PICKUP_DURATION_MS = 5600;
const SO101_PICKUP_FPS = 60;
export const SO101_GRABBABLE_CONTAINER_TRACK_ID = "grabbable-container-f";
export const SO101_GRABBABLE_CONTAINER_OBJECT_ID = "grabbable-container-f";
export const SO101_GRABBABLE_CONTAINER_INITIAL_POSITION = {
  x: 0.02,
  y: 0.29,
  z: 0.041,
};
export const SO101_GRABBABLE_CONTAINER_FINAL_POSITION = {
  x: -0.28,
  y: 0.34,
  z: 0.041,
};
const SO101_GRABBABLE_CONTAINER_ROTATION = {
  x: Math.PI / 2,
  y: 0,
  z: 0.02,
};

const SO101_PICKUP_REQUIRED_JOINTS = [
  "shoulder_pan",
  "shoulder_lift",
  "elbow_flex",
  "wrist_flex",
  "wrist_roll",
  "gripper",
] as const;

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

type JointKeyframe = {
  t: number;
  joints: Record<(typeof SO101_PICKUP_REQUIRED_JOINTS)[number], number>;
};

type ObjectPoseKeyframe = {
  t: number;
  position: { x: number; y: number; z: number };
};

const easeInOut = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * t);

const hasSo101PickupJointSet = (jointNames: readonly string[]) => {
  const available = new Set(jointNames);
  return SO101_PICKUP_REQUIRED_JOINTS.every((jointName) => available.has(jointName));
};

const interpolateNumber = (from: number, to: number, t: number) =>
  from + (to - from) * easeInOut(t);

const resolveKeyframePair = <TKeyframe extends { t: number }>(
  keyframes: readonly TKeyframe[],
  t: number
): { from: TKeyframe; to: TKeyframe; alpha: number } => {
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (!first || !last) {
    throw new Error("SO101 pickup demo requires keyframes.");
  }
  if (t <= first.t) return { from: first, to: first, alpha: 0 };
  if (t >= last.t) return { from: last, to: last, alpha: 0 };
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const from = keyframes[index];
    const to = keyframes[index + 1];
    if (!from || !to) continue;
    if (t >= from.t && t <= to.t) {
      const duration = Math.max(to.t - from.t, 1e-6);
      return { from, to, alpha: (t - from.t) / duration };
    }
  }
  return { from: last, to: last, alpha: 0 };
};

const SO101_PICKUP_JOINT_KEYFRAMES: JointKeyframe[] = [
  {
    t: 0,
    joints: {
      shoulder_pan: 0,
      shoulder_lift: 0.32,
      elbow_flex: -0.62,
      wrist_flex: 0.52,
      wrist_roll: 0,
      gripper: 1.25,
    },
  },
  {
    t: 0.18,
    joints: {
      shoulder_pan: 0.08,
      shoulder_lift: 0.76,
      elbow_flex: -1.08,
      wrist_flex: 0.76,
      wrist_roll: 0.04,
      gripper: 1.25,
    },
  },
  {
    t: 0.32,
    joints: {
      shoulder_pan: 0.08,
      shoulder_lift: 0.98,
      elbow_flex: -1.34,
      wrist_flex: 1.02,
      wrist_roll: 0.04,
      gripper: 1.25,
    },
  },
  {
    t: 0.42,
    joints: {
      shoulder_pan: 0.08,
      shoulder_lift: 0.98,
      elbow_flex: -1.34,
      wrist_flex: 1.02,
      wrist_roll: 0.04,
      gripper: 0.08,
    },
  },
  {
    t: 0.56,
    joints: {
      shoulder_pan: 0.02,
      shoulder_lift: 0.58,
      elbow_flex: -0.98,
      wrist_flex: 0.68,
      wrist_roll: 0,
      gripper: 0.08,
    },
  },
  {
    t: 0.72,
    joints: {
      shoulder_pan: -0.48,
      shoulder_lift: 0.48,
      elbow_flex: -0.86,
      wrist_flex: 0.52,
      wrist_roll: -0.05,
      gripper: 0.08,
    },
  },
  {
    t: 0.84,
    joints: {
      shoulder_pan: -0.48,
      shoulder_lift: 0.78,
      elbow_flex: -1.1,
      wrist_flex: 0.78,
      wrist_roll: -0.05,
      gripper: 0.08,
    },
  },
  {
    t: 0.92,
    joints: {
      shoulder_pan: -0.48,
      shoulder_lift: 0.78,
      elbow_flex: -1.1,
      wrist_flex: 0.78,
      wrist_roll: -0.05,
      gripper: 1.25,
    },
  },
  {
    t: 1,
    joints: {
      shoulder_pan: -0.1,
      shoulder_lift: 0.28,
      elbow_flex: -0.58,
      wrist_flex: 0.46,
      wrist_roll: 0,
      gripper: 1.25,
    },
  },
];

const createSo101PickupJointPositions = ({
  t,
  jointNames,
  jointLimits,
}: {
  t: number;
  jointNames: readonly string[];
  jointLimits?: JointLimits;
}): Record<string, number> => {
  const { from, to, alpha } = resolveKeyframePair(SO101_PICKUP_JOINT_KEYFRAMES, t);
  const jointSet = new Set(jointNames);
  const jointPositions: Record<string, number> = {};
  SO101_PICKUP_REQUIRED_JOINTS.forEach((jointName) => {
    if (!jointSet.has(jointName)) return;
    const rawValue = interpolateNumber(from.joints[jointName], to.joints[jointName], alpha);
    const limit = jointLimits?.[jointName];
    jointPositions[jointName] = clamp(rawValue, limit?.lower, limit?.upper);
  });
  return jointPositions;
};

const SO101_CONTAINER_POSE_KEYFRAMES: ObjectPoseKeyframe[] = [
  { t: 0, position: SO101_GRABBABLE_CONTAINER_INITIAL_POSITION },
  { t: 0.42, position: SO101_GRABBABLE_CONTAINER_INITIAL_POSITION },
  {
    t: 0.56,
    position: {
      x: SO101_GRABBABLE_CONTAINER_INITIAL_POSITION.x,
      y: SO101_GRABBABLE_CONTAINER_INITIAL_POSITION.y,
      z: 0.13,
    },
  },
  {
    t: 0.72,
    position: {
      x: SO101_GRABBABLE_CONTAINER_FINAL_POSITION.x,
      y: SO101_GRABBABLE_CONTAINER_FINAL_POSITION.y,
      z: 0.13,
    },
  },
  { t: 0.84, position: SO101_GRABBABLE_CONTAINER_FINAL_POSITION },
  { t: 1, position: SO101_GRABBABLE_CONTAINER_FINAL_POSITION },
];

const createSo101ContainerPose = (t: number) => {
  const { from, to, alpha } = resolveKeyframePair(SO101_CONTAINER_POSE_KEYFRAMES, t);
  return {
    position: {
      x: interpolateNumber(from.position.x, to.position.x, alpha),
      y: interpolateNumber(from.position.y, to.position.y, alpha),
      z: interpolateNumber(from.position.z, to.position.z, alpha),
    },
    rotation: SO101_GRABBABLE_CONTAINER_ROTATION,
    isHidden: false,
  };
};

const createSo101ContainerPickupFrames = ({
  jointNames,
  jointLimits,
}: {
  jointNames: readonly string[];
  jointLimits?: JointLimits;
}) => {
  const frameInterval = 1000 / SO101_PICKUP_FPS;
  const totalFrames = Math.max(2, Math.floor(SO101_PICKUP_DURATION_MS / frameInterval));
  return Array.from({ length: totalFrames }, (_, index) => {
    const t = index / (totalFrames - 1);
    return {
      timestamp: Math.round(index * frameInterval),
      jointPositions: createSo101PickupJointPositions({ t, jointNames, jointLimits }),
      objectPoses: {
        [SO101_GRABBABLE_CONTAINER_TRACK_ID]: createSo101ContainerPose(t),
      },
    };
  });
};

const createSo101ContainerPickupEpisode = ({
  jointNames,
  jointLimits,
}: {
  jointNames: readonly string[];
  jointLimits?: JointLimits;
}): Episode => {
  const activeJointNames = SO101_PICKUP_REQUIRED_JOINTS.filter((jointName) =>
    jointNames.includes(jointName)
  );
  const frames = createSo101ContainerPickupFrames({ jointNames: activeJointNames, jointLimits });
  return createEpisode(`demo-so101-container-pickup-${Date.now()}`, 1, frames, {
    joint_names: activeJointNames,
    source: "demo",
    label: "Pick Container",
    createdAt: Date.now(),
    num_frames: frames.length,
    fps: SO101_PICKUP_FPS,
    robot_type: "so101",
    tasks: ["pick up the top grabbable shipping container and place it to the left"],
    additional: {
      demoType: "so101_container_pickup_prerecorded",
      physics_backend: "prebaked",
      physics_rollout_required: false,
      object_track_id: SO101_GRABBABLE_CONTAINER_TRACK_ID,
      world_object_id: SO101_GRABBABLE_CONTAINER_OBJECT_ID,
      object_initial_position_xyz: [
        SO101_GRABBABLE_CONTAINER_INITIAL_POSITION.x,
        SO101_GRABBABLE_CONTAINER_INITIAL_POSITION.y,
        SO101_GRABBABLE_CONTAINER_INITIAL_POSITION.z,
      ],
      object_final_position_xyz: [
        SO101_GRABBABLE_CONTAINER_FINAL_POSITION.x,
        SO101_GRABBABLE_CONTAINER_FINAL_POSITION.y,
        SO101_GRABBABLE_CONTAINER_FINAL_POSITION.z,
      ],
    },
  });
};

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

export const createDemoEpisodes = ({
  jointNames,
  jointLimits,
  profiles = DEMO_PROFILES,
}: {
  jointNames: string[];
  jointLimits?: JointLimits;
  profiles?: DemoProfile[];
}): Episode[] => {
  if (hasSo101PickupJointSet(jointNames)) {
    return [createSo101ContainerPickupEpisode({ jointNames, jointLimits })];
  }

  const baseId = Date.now();
  const safeProfiles = profiles.slice(0, DEFAULT_DEMO_COUNT);
  const activeProfiles = safeProfiles.length > 1 ? safeProfiles.slice(1) : safeProfiles;
  return activeProfiles.map((profile, index) => {
    const frames = createWaveFrames({
      jointNames,
      jointLimits,
      fps: profile.fps,
      durationMs: profile.durationMs,
      wave: profile.wave,
      amplitudeScale: profile.amplitudeScale,
    });
    return createEpisode(`demo-${profile.id}-${baseId}`, index + 1, frames, {
      joint_names: jointNames,
      source: "demo",
      label: profile.label,
      createdAt: Date.now(),
      num_frames: frames.length,
      fps: profile.fps,
      additional: {
        demoType: profile.id,
      },
    });
  });
};
