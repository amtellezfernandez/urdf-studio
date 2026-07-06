import { getJointLimits, type JointLimits } from "@/shared/lib/urdfBrowser";

export type ClampedIkSolution = {
  solution: Record<string, number>;
  clampedJoints: string[];
};

const resolveFiniteJointLimits = (
  jointLimits: JointLimits,
  jointName: string,
  value: number
): { lower: number; upper: number } | null => {
  if (!Number.isFinite(value)) return null;
  const limits = getJointLimits(jointLimits, jointName);
  if (!Number.isFinite(limits.lower) || !Number.isFinite(limits.upper)) {
    return null;
  }
  return limits;
};

export const clampIkSolutionToJointLimits = ({
  solution,
  jointLimits,
}: {
  solution: Record<string, number>;
  jointLimits?: JointLimits | null;
}): ClampedIkSolution => {
  if (!jointLimits || Object.keys(jointLimits).length === 0) {
    return { solution, clampedJoints: [] };
  }
  const clamped: Record<string, number> = { ...solution };
  const clampedJoints: string[] = [];
  Object.entries(solution).forEach(([jointName, value]) => {
    const limits = resolveFiniteJointLimits(jointLimits, jointName, value);
    if (!limits) return;
    if (value < limits.lower || value > limits.upper) {
      clamped[jointName] = Math.min(limits.upper, Math.max(limits.lower, value));
      clampedJoints.push(jointName);
    }
  });

  return { solution: clamped, clampedJoints };
};

export const scoreIkSolutionPostureRisk = ({
  solution,
  jointLimits,
  referenceValues,
}: {
  solution: Record<string, number>;
  jointLimits?: JointLimits | null;
  referenceValues?: Record<string, number>;
}): number => {
  if (!jointLimits || Object.keys(jointLimits).length === 0) {
    return 0;
  }
  let edgePenalty = 0;
  let foldPenalty = 0;
  let deltaPenalty = 0;
  let samples = 0;

  Object.entries(solution).forEach(([jointName, value]) => {
    const limits = resolveFiniteJointLimits(jointLimits, jointName, value);
    if (!limits) return;
    const span = limits.upper - limits.lower;
    if (!Number.isFinite(span) || span <= 1e-6) return;

    const center = (limits.lower + limits.upper) * 0.5;
    const halfRange = span * 0.5;
    const centerNorm = Math.abs(value - center) / Math.max(halfRange, 1e-6);
    const edgeNorm = Math.max(0, (centerNorm - 0.72) / 0.28);
    edgePenalty += edgeNorm * edgeNorm;
    foldPenalty += centerNorm * centerNorm * centerNorm * centerNorm;

    const refValue = referenceValues?.[jointName];
    if (Number.isFinite(refValue)) {
      const deltaNorm = Math.abs(value - (refValue as number)) / Math.max(span, 1e-6);
      deltaPenalty += deltaNorm * deltaNorm;
    }
    samples += 1;
  });

  const denom = Math.max(1, samples);
  return (
    (edgePenalty / denom) * 8 +
    (foldPenalty / denom) * 3 +
    (deltaPenalty / denom) * 0.35
  );
};
