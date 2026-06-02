import type {
  MotionControllerCommand,
  MotionKernel,
  MotionKernelApplyInput,
  MotionKernelApplyResult,
  MotionKernelRejectedTarget,
  MotionPartitions,
} from "./types";

const sortByPriority = (commands: MotionControllerCommand[]): MotionControllerCommand[] =>
  [...commands].sort((lhs, rhs) => lhs.priority - rhs.priority);

const safeDecodeEndEffectorLink = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const resolveEndEffectorCandidates = (endEffectorLink: string): string[] => {
  const normalized = endEffectorLink.trim();
  if (!normalized) return [];
  const decoded = safeDecodeEndEffectorLink(normalized).trim();
  if (!decoded || decoded === normalized) {
    return [normalized];
  }
  return [normalized, decoded];
};

const createOwnerJointSet = (partitions: MotionPartitions): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>();
  partitions.manipulators.forEach((partition) => {
    map.set(partition.id, new Set(partition.ownedJointNames));
  });
  map.set("base:wheel-drive", new Set(partitions.baseJointNames));
  map.set("gripper:aux", new Set(partitions.gripperJointNames));
  return map;
};

const resolveManipulatorOwner = (
  partitions: MotionPartitions,
  options?: { endEffectorLink?: string | null; ownerId?: string | null }
): string | null => {
  const ownerId = options?.ownerId?.trim();
  if (ownerId) return ownerId;
  const endEffectorLink = options?.endEffectorLink?.trim();
  if (!endEffectorLink) return null;
  const candidates = resolveEndEffectorCandidates(endEffectorLink);
  for (const candidate of candidates) {
    const resolved = partitions.manipulatorByEndEffector[candidate];
    if (resolved) {
      return resolved;
    }
  }
  return null;
};

const filterOwnedTargets = (
  solution: Record<string, number>,
  allowed: Set<string>,
  wheelDriveEnabled: boolean,
  baseJointSet: Set<string>
): Record<string, number> => {
  const filtered: Record<string, number> = {};
  Object.entries(solution).forEach(([jointName, value]) => {
    if (!Number.isFinite(value)) return;
    if (!allowed.has(jointName)) return;
    if (!wheelDriveEnabled && baseJointSet.has(jointName)) return;
    filtered[jointName] = value;
  });
  return filtered;
};

const applyCommands = (
  partitions: MotionPartitions,
  ownerJoints: Map<string, Set<string>>,
  input: MotionKernelApplyInput
): MotionKernelApplyResult => {
  const nextJointValues = { ...input.currentJointValues };
  const rejected: MotionKernelRejectedTarget[] = [];
  const claimedByJoint = new Map<string, string>();
  const baseJointSet = new Set(partitions.baseJointNames);
  let appliedCount = 0;

  sortByPriority(input.commands).forEach((command) => {
    const allowed = ownerJoints.get(command.ownerId);
    if (!allowed) {
      Object.keys(command.jointTargets).forEach((jointName) => {
        rejected.push({
          jointName,
          ownerId: command.ownerId,
          reason: "unknown-owner",
        });
      });
      return;
    }

    Object.entries(command.jointTargets).forEach(([jointName, value]) => {
      if (!Number.isFinite(value)) {
        rejected.push({
          jointName,
          ownerId: command.ownerId,
          reason: "non-finite",
        });
        return;
      }
      if (!partitions.manipulatorJointOwners[jointName]) {
        rejected.push({
          jointName,
          ownerId: command.ownerId,
          reason: "unowned-joint",
        });
        return;
      }
      if (!allowed.has(jointName)) {
        rejected.push({
          jointName,
          ownerId: command.ownerId,
          reason: "owner-mismatch",
        });
        return;
      }
      if (!input.wheelDriveEnabled && baseJointSet.has(jointName)) {
        rejected.push({
          jointName,
          ownerId: command.ownerId,
          reason: "wheel-drive-disabled",
        });
        return;
      }
      const priorOwner = claimedByJoint.get(jointName);
      if (priorOwner && priorOwner !== command.ownerId) {
        rejected.push({
          jointName,
          ownerId: command.ownerId,
          reason: "priority-conflict",
        });
        return;
      }

      nextJointValues[jointName] = value;
      claimedByJoint.set(jointName, command.ownerId);
      appliedCount += 1;
    });
  });

  return {
    jointValues: nextJointValues,
    diagnostics: {
      appliedCount,
      rejected,
    },
  };
};

export const createMotionKernel = (partitions: MotionPartitions): MotionKernel => {
  const ownerJoints = createOwnerJointSet(partitions);
  const baseJointSet = new Set(partitions.baseJointNames);

  return {
    partitions,
    sanitizeManipulatorTargets: (solution, options) => {
      const ownerId = resolveManipulatorOwner(partitions, options);
      if (!ownerId) {
        return {};
      }
      const allowed = ownerJoints.get(ownerId);
      if (!allowed) {
        return {};
      }
      return filterOwnedTargets(solution, allowed, options?.wheelDriveEnabled ?? true, baseJointSet);
    },
    apply: (input) => applyCommands(partitions, ownerJoints, input),
  };
};
