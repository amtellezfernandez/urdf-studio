import type { RecordedFrame } from "@/features/dataset/episodes";
import type { JointLimits } from "@/features/urdf/parsing/parseJointLimits";
import { getJointLimits } from "@/features/urdf/parsing/parseJointLimits";
import type { JointLimitMode } from "@/shared/types/feature";

export const JOINT_LIMIT_TOLERANCE = 1e-5;

export type JointLimitViolation = {
  frameIndex: number;
  jointName: string;
  value: number;
  lower: number;
  upper: number;
};

export type JointLimitCorrectionSummary = {
  jointName: string;
  mode: JointLimitMode;
  violations: number;
  clamped: number;
  shiftOffset: number | null;
};

export type JointLimitCorrectionReport = {
  totalViolations: number;
  totalClamped: number;
  joints: JointLimitCorrectionSummary[];
};

const resolveFiniteLimits = (
  jointLimits: JointLimits,
  jointName: string
): { lower: number; upper: number } | null => {
  const { lower, upper } = getJointLimits(jointLimits, jointName);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    return null;
  }
  return { lower, upper };
};

export const computeJointLimitViolations = (
  frames: RecordedFrame[],
  jointLimits: JointLimits,
  tolerance = JOINT_LIMIT_TOLERANCE
): JointLimitViolation[] => {
  if (!frames.length) return [];
  const violations: JointLimitViolation[] = [];
  const jointNames = Object.keys(jointLimits);

  frames.forEach((frame, frameIndex) => {
    jointNames.forEach((jointName) => {
      const limits = resolveFiniteLimits(jointLimits, jointName);
      if (!limits) return;
      const value = frame.jointPositions[jointName];
      if (!Number.isFinite(value)) return;
      if (value < limits.lower - tolerance || value > limits.upper + tolerance) {
        violations.push({
          frameIndex,
          jointName,
          value,
          lower: limits.lower,
          upper: limits.upper,
        });
      }
    });
  });

  return violations;
};

const computeJointRanges = (frames: RecordedFrame[]) => {
  const ranges = new Map<string, { min: number; max: number }>();
  frames.forEach((frame) => {
    Object.entries(frame.jointPositions).forEach(([jointName, value]) => {
      if (!Number.isFinite(value)) return;
      const range = ranges.get(jointName);
      if (!range) {
        ranges.set(jointName, { min: value, max: value });
      } else {
        range.min = Math.min(range.min, value);
        range.max = Math.max(range.max, value);
      }
    });
  });
  return ranges;
};

export const applyJointLimitCorrectionsToFrames = (
  frames: RecordedFrame[],
  jointLimits: JointLimits,
  modeByJoint: Record<string, JointLimitMode | undefined> = {},
  tolerance = JOINT_LIMIT_TOLERANCE
): {
  frames: RecordedFrame[];
  summaries: JointLimitCorrectionSummary[];
  violations: JointLimitViolation[];
} => {
  if (!frames.length) {
    return { frames, summaries: [], violations: [] };
  }

  const jointNames = Object.keys(jointLimits);
  if (jointNames.length === 0) {
    return { frames, summaries: [], violations: [] };
  }

  const ranges = computeJointRanges(frames);
  const shiftOffsets = new Map<string, number>();
  const summaries = new Map<string, JointLimitCorrectionSummary>();

  jointNames.forEach((jointName) => {
    const mode = modeByJoint[jointName] ?? "report";
    const limits = resolveFiniteLimits(jointLimits, jointName);
    if (!limits) return;
    if (mode !== "shift") return;
    const range = ranges.get(jointName);
    if (!range) return;
    const limitSpan = limits.upper - limits.lower;
    const rangeSpan = range.max - range.min;
    if (!Number.isFinite(limitSpan) || limitSpan <= 0) return;
    if (rangeSpan > limitSpan + tolerance) {
      shiftOffsets.set(jointName, 0);
      summaries.set(jointName, {
        jointName,
        mode,
        violations: 0,
        clamped: 0,
        shiftOffset: 0,
      });
      return;
    }
    let offset = 0;
    if (range.min < limits.lower - tolerance) {
      offset = limits.lower - range.min;
    } else if (range.max > limits.upper + tolerance) {
      offset = limits.upper - range.max;
    }
    if (Math.abs(offset) > tolerance) {
      shiftOffsets.set(jointName, offset);
    }
  });

  const violations: JointLimitViolation[] = [];
  let hasCorrections = false;

  const nextFrames = frames.map((frame, frameIndex) => {
    let nextPositions: Record<string, number> | null = null;
    jointNames.forEach((jointName) => {
      const mode = modeByJoint[jointName] ?? "report";
      const limits = resolveFiniteLimits(jointLimits, jointName);
      if (!limits) return;
      const value = frame.jointPositions[jointName];
      if (!Number.isFinite(value)) return;

      let nextValue = value;
      const wasOutOfRange =
        value < limits.lower - tolerance || value > limits.upper + tolerance;
      const shiftOffset = shiftOffsets.get(jointName) ?? 0;
      if (mode === "shift" && Math.abs(shiftOffset) > tolerance) {
        nextValue = value + shiftOffset;
      }
      if (mode === "clamp") {
        nextValue = Math.min(limits.upper, Math.max(limits.lower, nextValue));
      }

      const outOfRange =
        nextValue < limits.lower - tolerance || nextValue > limits.upper + tolerance;
      if (wasOutOfRange || outOfRange) {
        violations.push({
          frameIndex,
          jointName,
          value,
          lower: limits.lower,
          upper: limits.upper,
        });
      }

      if (nextValue !== value) {
        hasCorrections = true;
        if (!nextPositions) {
          nextPositions = { ...frame.jointPositions };
        }
        nextPositions[jointName] = nextValue;
        const summary =
          summaries.get(jointName) ?? {
            jointName,
            mode,
            violations: 0,
            clamped: 0,
            shiftOffset: shiftOffsets.get(jointName) ?? null,
          };
        if (mode === "clamp") {
          summary.clamped += 1;
        }
        summaries.set(jointName, summary);
      }

      if (wasOutOfRange || outOfRange) {
        const summary =
          summaries.get(jointName) ?? {
            jointName,
            mode,
            violations: 0,
            clamped: 0,
            shiftOffset: shiftOffsets.get(jointName) ?? null,
          };
        summary.violations += 1;
        summaries.set(jointName, summary);
      }
    });

    if (!nextPositions) {
      return frame;
    }

    return {
      ...frame,
      jointPositions: nextPositions,
    };
  });

  return {
    frames: hasCorrections ? nextFrames : frames,
    summaries: Array.from(summaries.values()),
    violations,
  };
};

export const summarizeJointLimitCorrections = (
  summaries: JointLimitCorrectionSummary[],
  violations: JointLimitViolation[]
): JointLimitCorrectionReport => ({
  totalViolations: violations.length,
  totalClamped: summaries.reduce((total, summary) => total + summary.clamped, 0),
  joints: summaries,
});
