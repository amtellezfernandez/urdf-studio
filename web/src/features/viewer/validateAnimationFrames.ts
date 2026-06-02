import type { AnimationFrame } from "@/features/viewer/viewer-types";
import { isFiniteRobotBasePose } from "@/shared/lib/robotBasePose";

type AnimationFrameValidation = {
  ok: boolean;
  issues: string[];
  warnings: string[];
};

export const validateAnimationFrames = (
  frames: AnimationFrame[] | null | undefined
): AnimationFrameValidation => {
  if (!frames || frames.length === 0) {
    return {
      ok: false,
      issues: ["no frames provided"],
      warnings: [],
    };
  }

  let nonFiniteTimestampCount = 0;
  let negativeDeltaCount = 0;
  let zeroDeltaCount = 0;
  let nonFiniteJointCount = 0;
  let nonFiniteBasePoseCount = 0;
  let emptyJointCount = 0;
  let missingJointKeyCount = 0;
  let jointKeyReference: Set<string> | null = null;

  let prevTimestamp = frames[0]?.timestamp ?? 0;
  if (!Number.isFinite(prevTimestamp)) {
    nonFiniteTimestampCount += 1;
  }

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    const timestamp = frame?.timestamp ?? prevTimestamp;
    if (!Number.isFinite(timestamp)) {
      nonFiniteTimestampCount += 1;
    }

    if (i > 0) {
      const delta = timestamp - prevTimestamp;
      if (!Number.isFinite(delta)) {
        nonFiniteTimestampCount += 1;
      } else if (delta < 0) {
        negativeDeltaCount += 1;
      } else if (delta === 0) {
        zeroDeltaCount += 1;
      }
    }
    prevTimestamp = timestamp;

    const joints = frame?.joints ?? {};
    const jointKeys = Object.keys(joints);
    if (jointKeys.length === 0) {
      emptyJointCount += 1;
    }
    if (!jointKeyReference && jointKeys.length > 0) {
      jointKeyReference = new Set(jointKeys);
    } else if (jointKeyReference && jointKeys.length > 0) {
      const missing = Array.from(jointKeyReference).some((key) => !(key in joints));
      if (missing) {
        missingJointKeyCount += 1;
      }
    }
    for (const value of Object.values(joints)) {
      if (!Number.isFinite(value)) {
        nonFiniteJointCount += 1;
      }
    }
    if (frame?.basePose && !isFiniteRobotBasePose(frame.basePose)) {
      nonFiniteBasePoseCount += 1;
    }
  }

  const issues: string[] = [];
  if (nonFiniteTimestampCount > 0) {
    issues.push(`non-finite timestamps (${nonFiniteTimestampCount})`);
  }
  if (negativeDeltaCount > 0) {
    issues.push(`non-monotonic timestamps (${negativeDeltaCount})`);
  }
  if (nonFiniteJointCount > 0) {
    issues.push(`non-finite joint values (${nonFiniteJointCount})`);
  }
  if (nonFiniteBasePoseCount > 0) {
    issues.push(`non-finite base poses (${nonFiniteBasePoseCount})`);
  }
  if (emptyJointCount > 0) {
    issues.push(`frames with no joints (${emptyJointCount})`);
  }

  const warnings: string[] = [];
  if (zeroDeltaCount > 0) {
    warnings.push(`zero-delta timestamps (${zeroDeltaCount})`);
  }
  if (missingJointKeyCount > 0) {
    warnings.push(`frames missing joint keys (${missingJointKeyCount})`);
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
  };
};
