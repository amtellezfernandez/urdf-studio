import {
  readBrowserStorageItem,
  writeBrowserStorageItem,
} from "@/shared/lib/browserStorage";

export type TrajectoryJointSpec = {
  jointName: string;
  startValue: number;
  targetValue: number;
  maxVelocity: number;
  maxAcceleration: number;
};

export type AdaptiveTrajectoryProfile = {
  speedScale: number;
  accelerationScale: number;
  episodes: number;
  updatedAtMs: number;
};

const DEFAULT_ADAPTIVE_TRAJECTORY_PROFILE: Readonly<AdaptiveTrajectoryProfile> = {
  speedScale: 1,
  accelerationScale: 1,
  episodes: 0,
  updatedAtMs: 0,
};

export type AdaptiveTrajectoryRepository = {
  load: (contextKey: string) => AdaptiveTrajectoryProfile | null;
  save: (contextKey: string, profile: AdaptiveTrajectoryProfile) => void;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const computeQuinticEaseInOut = (t: number): number =>
  t * t * t * (t * (t * 6 - 15) + 10);

const resolveMotionDirection = (startValue: number, targetValue: number): number => {
  if (targetValue > startValue) return 1;
  if (targetValue < startValue) return -1;
  return 0;
};

const clampMonotonicProgress = (
  nextValue: number,
  lastCommandedValue: number,
  targetValue: number,
  direction: number
): number => {
  if (!Number.isFinite(nextValue)) return lastCommandedValue;
  if (direction > 0) {
    return Math.min(targetValue, Math.max(nextValue, lastCommandedValue));
  }
  if (direction < 0) {
    return Math.max(targetValue, Math.min(nextValue, lastCommandedValue));
  }
  return targetValue;
};

const sanitizeProfile = (
  profile: AdaptiveTrajectoryProfile | null | undefined
): AdaptiveTrajectoryProfile => {
  if (!profile) return { ...DEFAULT_ADAPTIVE_TRAJECTORY_PROFILE };
  return {
    speedScale: clamp(
      Number.isFinite(profile.speedScale) ? profile.speedScale : 1,
      0.8,
      1.5
    ),
    accelerationScale: clamp(
      Number.isFinite(profile.accelerationScale) ? profile.accelerationScale : 1,
      0.8,
      1.8
    ),
    episodes: Math.max(0, Math.trunc(profile.episodes ?? 0)),
    updatedAtMs: Number.isFinite(profile.updatedAtMs) ? profile.updatedAtMs : 0,
  };
};

export const createLocalStorageAdaptiveTrajectoryRepository = (
  storageKey = "urdf-studio-adaptive-trajectory-profiles"
): AdaptiveTrajectoryRepository => {
  const readAll = (): Record<string, AdaptiveTrajectoryProfile> => {
    if (typeof window === "undefined") return {};
    try {
      const raw = readBrowserStorageItem(storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, AdaptiveTrajectoryProfile>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  const writeAll = (entries: Record<string, AdaptiveTrajectoryProfile>) => {
    if (typeof window === "undefined") return;
    try {
      writeBrowserStorageItem(storageKey, JSON.stringify(entries));
    } catch {
      // Ignore storage failures; runtime still works without persistence.
    }
  };

  return {
    load: (contextKey: string) => {
      const all = readAll();
      const profile = all[contextKey];
      return profile ? sanitizeProfile(profile) : null;
    },
    save: (contextKey: string, profile: AdaptiveTrajectoryProfile) => {
      const all = readAll();
      all[contextKey] = sanitizeProfile(profile);
      writeAll(all);
    },
  };
};

export const createInMemoryAdaptiveTrajectoryRepository = (
  seed: Record<string, AdaptiveTrajectoryProfile> = {}
): AdaptiveTrajectoryRepository => {
  const map = new Map<string, AdaptiveTrajectoryProfile>();
  Object.entries(seed).forEach(([key, value]) => {
    map.set(key, sanitizeProfile(value));
  });
  return {
    load: (contextKey: string) => {
      const profile = map.get(contextKey);
      return profile ? { ...profile } : null;
    },
    save: (contextKey: string, profile: AdaptiveTrajectoryProfile) => {
      map.set(contextKey, sanitizeProfile(profile));
    },
  };
};

export type AdaptiveTrajectoryRuntimeConfig = {
  contextKey: string;
  jointSpecs: TrajectoryJointSpec[];
  durationSec: number;
  epsilon: number;
  completionTolerance: number;
  repository?: AdaptiveTrajectoryRepository | null;
};

export type AdaptiveTrajectoryStepResult = {
  desiredValues: Record<string, number>;
  unresolvedJoints: number;
  hasChange: boolean;
};

export type AdaptiveTrajectoryTelemetry = {
  frameCount: number;
  projectedFrameCount: number;
  maxVelocityJump: number;
  unresolvedJoints: number;
};

export class AdaptiveTrajectoryRuntime {
  private readonly profile: AdaptiveTrajectoryProfile;
  private readonly velocityState: Record<string, number> = {};
  private readonly motionDirection: Record<string, number> = {};
  private readonly lastCommanded: Record<string, number> = {};
  private frameCount = 0;
  private projectedFrameCount = 0;
  private maxVelocityJump = 0;
  private lastUnresolvedJoints = 0;

  constructor(private readonly config: AdaptiveTrajectoryRuntimeConfig) {
    const loaded = config.repository?.load(config.contextKey) ?? null;
    this.profile = sanitizeProfile(loaded);
    config.jointSpecs.forEach((spec) => {
      this.velocityState[spec.jointName] = 0;
      this.motionDirection[spec.jointName] = resolveMotionDirection(
        spec.startValue,
        spec.targetValue
      );
      this.lastCommanded[spec.jointName] = spec.startValue;
    });
  }

  getProfile(): AdaptiveTrajectoryProfile {
    return { ...this.profile };
  }

  step(currentValues: Record<string, number>, elapsedSec: number, dtSec: number): AdaptiveTrajectoryStepResult {
    this.frameCount += 1;
    const t = clamp(
      elapsedSec / Math.max(this.config.durationSec, 1e-6),
      0,
      1
    );
    const eased = computeQuinticEaseInOut(t);
    const desiredValues = { ...currentValues };
    let unresolvedJoints = 0;
    let hasChange = false;

    this.config.jointSpecs.forEach((spec) => {
      const measuredCurrent = Number.isFinite(currentValues[spec.jointName])
        ? currentValues[spec.jointName]
        : spec.startValue;
      const lastCommandedValue = Number.isFinite(this.lastCommanded[spec.jointName])
        ? this.lastCommanded[spec.jointName]
        : measuredCurrent;
      const commandBase = lastCommandedValue;
      const desiredPosition =
        spec.startValue + (spec.targetValue - spec.startValue) * eased;
      const deltaToDesired = desiredPosition - commandBase;
      const maxVelocity = Math.max(
        0.01,
        spec.maxVelocity * this.profile.speedScale
      );
      const maxAcceleration = Math.max(
        0.1,
        spec.maxAcceleration * this.profile.accelerationScale
      );
      const desiredVelocity = Math.sign(deltaToDesired || 1) * Math.min(
        maxVelocity,
        Math.abs(deltaToDesired) / Math.max(dtSec, 1e-6)
      );
      const prevVelocity = this.velocityState[spec.jointName] ?? 0;
      const velocityDelta = desiredVelocity - prevVelocity;
      const maxVelocityDelta = maxAcceleration * dtSec;
      const nextVelocity =
        Math.abs(velocityDelta) > maxVelocityDelta
          ? prevVelocity + Math.sign(velocityDelta || 1) * maxVelocityDelta
          : desiredVelocity;

      const velocityJump = Math.abs(nextVelocity - prevVelocity);
      if (velocityJump > this.maxVelocityJump) {
        this.maxVelocityJump = velocityJump;
      }

      let nextValue = commandBase + nextVelocity * dtSec;
      if (Math.abs(nextValue - desiredPosition) > Math.abs(deltaToDesired)) {
        nextValue = desiredPosition;
      }
      nextValue = clampMonotonicProgress(
        nextValue,
        commandBase,
        spec.targetValue,
        this.motionDirection[spec.jointName] ?? 0
      );
      if (Math.abs(spec.targetValue - nextValue) <= this.config.epsilon) {
        nextValue = spec.targetValue;
        this.velocityState[spec.jointName] = 0;
      } else {
        this.velocityState[spec.jointName] = nextVelocity;
      }
      this.lastCommanded[spec.jointName] = nextValue;

      desiredValues[spec.jointName] = nextValue;
      if (Math.abs(spec.targetValue - nextValue) > this.config.completionTolerance) {
        unresolvedJoints += 1;
      }
      if (Math.abs(nextValue - measuredCurrent) > 1e-9) {
        hasChange = true;
      }
    });

    this.lastUnresolvedJoints = unresolvedJoints;
    return {
      desiredValues,
      unresolvedJoints,
      hasChange,
    };
  }

  reconcileApplied(
    previousValues: Record<string, number>,
    appliedValues: Record<string, number>,
    dtSec: number
  ) {
    this.config.jointSpecs.forEach((spec) => {
      const prev = Number.isFinite(previousValues[spec.jointName])
        ? previousValues[spec.jointName]
        : spec.startValue;
      const applied = Number.isFinite(appliedValues[spec.jointName])
        ? appliedValues[spec.jointName]
        : prev;
      const velocity = (applied - prev) / Math.max(dtSec, 1e-6);
      const maxVelocity = Math.max(
        0.01,
        spec.maxVelocity * this.profile.speedScale
      );
      this.velocityState[spec.jointName] = clamp(velocity, -maxVelocity, maxVelocity);
      this.lastCommanded[spec.jointName] = applied;
      if (Math.abs(spec.targetValue - applied) <= this.config.epsilon) {
        this.velocityState[spec.jointName] = 0;
      }
    });
  }

  markSafetyProjection() {
    this.projectedFrameCount += 1;
  }

  getTelemetry(): AdaptiveTrajectoryTelemetry {
    return {
      frameCount: this.frameCount,
      projectedFrameCount: this.projectedFrameCount,
      maxVelocityJump: this.maxVelocityJump,
      unresolvedJoints: this.lastUnresolvedJoints,
    };
  }

  finalize(converged: boolean, runtimeMs: number): AdaptiveTrajectoryProfile {
    const projectedRate =
      this.frameCount > 0 ? this.projectedFrameCount / this.frameCount : 0;
    const rapidAndClean =
      converged &&
      projectedRate < 0.06 &&
      runtimeMs <= this.config.durationSec * 1000 * 1.35;

    if (projectedRate > 0.24) {
      this.profile.speedScale = clamp(this.profile.speedScale * 0.96, 0.8, 1.5);
      this.profile.accelerationScale = clamp(
        this.profile.accelerationScale * 0.95,
        0.8,
        1.8
      );
    } else if (rapidAndClean) {
      this.profile.speedScale = clamp(this.profile.speedScale * 1.03, 0.8, 1.5);
      this.profile.accelerationScale = clamp(
        this.profile.accelerationScale * 1.015,
        0.8,
        1.8
      );
    }

    if (this.maxVelocityJump > 2.2) {
      this.profile.accelerationScale = clamp(
        this.profile.accelerationScale * 0.96,
        0.8,
        1.8
      );
    }

    this.profile.episodes += 1;
    this.profile.updatedAtMs = Date.now();
    this.config.repository?.save(this.config.contextKey, this.profile);
    return this.getProfile();
  }
}
