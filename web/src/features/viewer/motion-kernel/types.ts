export type MotionControllerDomain = "arm" | "base" | "gripper" | "playback" | "camera";

export interface ManipulatorPartition {
  id: string;
  endEffectorLink: string;
  ownedJointNames: string[];
  sharedJointNames: string[];
}

export interface MotionPartitions {
  manipulatorByEndEffector: Record<string, string>;
  manipulatorJointOwners: Record<string, string>;
  manipulators: ManipulatorPartition[];
  baseJointNames: string[];
  gripperJointNames: string[];
  unownedJointNames: string[];
}

export interface MotionControllerCommand {
  ownerId: string;
  domain: MotionControllerDomain;
  priority: number;
  jointTargets: Record<string, number>;
}

export interface MotionKernelApplyInput {
  commands: MotionControllerCommand[];
  currentJointValues: Record<string, number>;
  wheelDriveEnabled: boolean;
}

export interface MotionKernelRejectedTarget {
  jointName: string;
  ownerId: string;
  reason:
    | "unknown-owner"
    | "unowned-joint"
    | "owner-mismatch"
    | "priority-conflict"
    | "wheel-drive-disabled"
    | "non-finite";
}

export interface MotionKernelDiagnostics {
  appliedCount: number;
  rejected: MotionKernelRejectedTarget[];
}

export interface MotionKernelApplyResult {
  jointValues: Record<string, number>;
  diagnostics: MotionKernelDiagnostics;
}

export interface MotionKernel {
  partitions: MotionPartitions;
  sanitizeManipulatorTargets: (
    solution: Record<string, number>,
    options?: { endEffectorLink?: string | null; ownerId?: string | null; wheelDriveEnabled?: boolean }
  ) => Record<string, number>;
  apply: (input: MotionKernelApplyInput) => MotionKernelApplyResult;
}

