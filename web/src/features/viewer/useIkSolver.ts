import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { toast } from "sonner";
import type { URDFRobot } from "urdf-loader";
import { useObjectStore, type CreatedObject } from "@/features/objects";
import { useJointStore } from "@/shared/store/useJointStore";
import { applyJointValues } from "@/shared/lib/urdf-joints";
import { getJointLimits, type JointLimits } from "@/shared/lib/urdfBrowser";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import {
  buildIkOrientationPayload,
  extractLinkPose,
  getLiveRobotJoints,
  normalizeIkTargetPoseForRobotBase,
  type DragMode,
} from "@/features/viewer/viewer-helpers";
import type { IkResponsePayload } from "@/features/viewer/ik-types";
import { isIkFailure, solveIk } from "@/features/ik/ikClient";
import { useIkDebugStore } from "@/features/ik/useIkDebugStore";
import { useIkSolverStore } from "@/features/ik/useIkSolverStore";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import {
  useIkParamsStore,
  type IkOrientationSetting,
} from "@/features/ik/useIkParamsStore";
import type { OrientationMode } from "@/features/ik/registry";
import type { MotionKernel } from "@/features/viewer/motion-kernel";
import {
  clampWorldTargetToArmReach,
  resolveArmReachEnvelope,
} from "@/features/viewer/armReach";
import {
  shouldRunSurfaceTargetApproachRetry,
} from "@/features/viewer/ikSurfaceApproachPolicy";
import {
  resolveObjectOrbitPhaseWorldTarget,
} from "@/features/viewer/objectTargeting";
import {
  resolveIkObjectSolveTargetWorld,
} from "@/features/viewer/ikObjectTargetSelection";
import {
  cancelIkdApproachTask,
  lockIkdApproachTask,
} from "@/features/viewer/ikdApproachTask";
import { useIkdApproachTaskStream } from "@/features/viewer/useIkdApproachTaskStream";
import { useIkdApproachTaskStore } from "@/features/viewer/useIkdApproachTaskStore";
import { IKD_RUNTIME_CONFIG } from "@/shared/config/runtime";
import { beginIkObjectSolveSession } from "@/features/viewer/ikObjectSolveSession";
import {
  OPERATOR_TELEOP_INPUT_SOURCE_IK_APPLY,
  OPERATOR_TELEOP_INPUT_SOURCE_IK_DRAG,
} from "@/features/teleop/params/operatorTeleopParams";
import { queueGenesisJointCommand } from "@/features/world-share/useGenesisLiveSync";
import {
  createIkMotionSafetyState,
  limitIkJointTargetsToMotionSafety,
  resetIkMotionSafetyState,
} from "@/features/viewer/ikMotionSafety";
import {
  canRetryRememberedBlockedTarget,
  resolveIkPreSolveTerminalErrorMessage,
  shouldAbortIkSolveAfterPreSolve,
  shouldRememberBlockedTargetAfterPreSolve,
} from "@/features/viewer/ikObjectSolvePreSolvePolicy";
import { doesViewerDragModeUseIkHandles } from "@/features/viewer/viewerDragModePolicy";

export type IkAppliedMetadata = {
  inputSource:
    | typeof OPERATOR_TELEOP_INPUT_SOURCE_IK_APPLY
    | typeof OPERATOR_TELEOP_INPUT_SOURCE_IK_DRAG;
};

export type IkObjectPreSolveProgress = {
  phase?: "idle" | "rotate" | "translate" | "done";
  distanceToTargetM?: number | null;
  yawErrorDeg?: number | null;
};

export type IkObjectPreSolveResult = {
  status: "completed" | "skipped" | "timeout" | "cancelled" | "failed";
  reason?: string;
  durationMs?: number;
  finalDistanceToTargetM?: number | null;
  finalYawErrorDeg?: number | null;
};

export type IkObjectPreSolveContext = {
  object: CreatedObject;
  targetPositionWorld: [number, number, number];
  isOrbitTarget: boolean;
  targetKind?: "object-center" | "surface-point";
  isStaleSolve: () => boolean;
  reportProgress: (progress: IkObjectPreSolveProgress) => void;
};

type UseIkSolverParams = {
  apiBaseUrl: string;
  dragMode: DragMode;
  robot: URDFRobot | null;
  urdfContent: string | null;
  urdfAnalysis: UrdfAnalysis | null;
  endEffectorLink: string | null;
  jointLimits?: JointLimits;
  onIkApplied?: (values: Record<string, number>, metadata: IkAppliedMetadata) => void;
  onManualJointChange?: () => void;
  allowRemote?: boolean;
  enableIk?: boolean;
  motionKernel?: MotionKernel | null;
  wheelDriveEnabled?: boolean;
  onBeforeObjectIkSolve?: (
    context: IkObjectPreSolveContext
  ) => Promise<IkObjectPreSolveResult | void> | IkObjectPreSolveResult | void;
};

const safeDecodeEndEffectorLink = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const resolveEffectorWorldPose = (
  robot: URDFRobot,
  endEffectorLink: string
): { position: THREE.Vector3; quaternion: THREE.Quaternion } => {
  const robotAny = robot as URDFRobot & {
    links?: Record<string, THREE.Object3D>;
    getObjectByName?: (name: string) => THREE.Object3D | undefined;
  };
  const effObj =
    robotAny.links?.[endEffectorLink] ??
    robotAny.getObjectByName?.(endEffectorLink) ??
    robotAny.getObjectByName?.(safeDecodeEndEffectorLink(endEffectorLink));
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  if (!effObj) {
    quaternion.set(0, 0, 0, 1);
    return { position, quaternion };
  }
  effObj.updateMatrixWorld(true);
  const tmpScale = new THREE.Vector3();
  effObj.matrixWorld.decompose(position, quaternion, tmpScale);
  return { position, quaternion };
};

const isIkObjectPreSolveResult = (
  value: unknown
): value is IkObjectPreSolveResult =>
  Boolean(
    value &&
      typeof value === "object" &&
      "status" in (value as Record<string, unknown>)
  );

const normalizeIkObjectPreSolveResult = (
  value: IkObjectPreSolveResult | void
): IkObjectPreSolveResult =>
  isIkObjectPreSolveResult(value)
    ? value
    : {
        status: "skipped",
        reason: "not-required",
      };

export const useIkSolver = ({
  apiBaseUrl,
  dragMode,
  robot,
  urdfContent,
  urdfAnalysis,
  endEffectorLink,
  jointLimits,
  onIkApplied,
  onManualJointChange,
  allowRemote = true,
  enableIk = true,
  motionKernel = null,
  wheelDriveEnabled = true,
  onBeforeObjectIkSolve,
}: UseIkSolverParams) => {
  useIkdApproachTaskStream({ enabled: IKD_RUNTIME_CONFIG.enabled });
  const setStoreJointValues = useJointStore((s) => s.setJointValues);
  const storeJointValues = useJointStore((s) => s.jointValues);
  const worldObjects = useObjectStore((s) => s.objects);
  const [ikResult, setIkResult] = useState<IkResponsePayload | null>(null);
  const [ikError, setIkError] = useState<string | null>(null);
  const [ikDialogOpen, setIkDialogOpen] = useState(false);
  const [ikTargetName, setIkTargetName] = useState<string | null>(null);
  const [isIkRunning, setIsIkRunning] = useState(false);
  const [isIkHandleDragging, setIsIkHandleDragging] = useState(false);
  const [isFollowingOrbit, setIsFollowingOrbit] = useState(false);
  const [orbitFollowProgress, setOrbitFollowProgress] = useState(0);
  const [ikSolveDurationMs, setIkSolveDurationMs] = useState<number | null>(null);
  const orbitFollowAnimationRef = useRef<number | null>(null);
  const orbitFollowAbortRef = useRef<boolean>(false);
  const lastIkAppliedRef = useRef<Record<string, number> | null>(null);
  const lastIkApplyTimeRef = useRef<number | null>(null);
  const lerobotWarmupRef = useRef<{ key: string; inFlight: boolean }>({
    key: "",
    inFlight: false,
  });
  const ikMotionSafetyStateRef = useRef(createIkMotionSafetyState());
  const objectSolveTokenRef = useRef(0);
  const activeIkdApproachTaskIdRef = useRef(0);
  const rememberedBlockedTargetRef = useRef<CreatedObject | null>(null);
  const lastLimitToastRef = useRef(0);
  const lastKernelWarningRef = useRef<string | null>(null);
  const setIkDebugState = useIkDebugStore((s) => s.setState);
  const selectedSolverId = useIkSolverStore((s) => s.selectedSolverId);
  const clickOrientation = useIkParamsStore((s) => s.clickOrientation);
  const requestTimeoutMs = useIkParamsStore((s) => s.requestTimeoutMs);
  const orbitTimeoutMs = useIkParamsStore((s) => s.orbitTimeoutMs);
  const orbitDefaults = useIkParamsStore((s) => s.orbitDefaults);
  const dragConfig = useIkParamsStore((s) => s.dragConfig);
  const solverTuning = useIkParamsStore((s) => s.solverTuning);
  // Keyed by end-effector link so multiple simultaneous drags (multi-handle or
  // collaborative session) never corrupt each other's smooth state.
  const dragSmoothedJointsRef = useRef<Map<string, Record<string, number>>>(new Map());

  const resolveOrientationMode = (
    setting: IkOrientationSetting,
    fallback: OrientationMode
  ): OrientationMode => (setting === "auto" ? fallback : setting);
  const deriveComAlignedQuaternion = useCallback(
    (
      effWorldPos: THREE.Vector3,
      effWorldQuat: THREE.Quaternion,
      targetWorldPos: THREE.Vector3,
      preferredAxisLocal?: [number, number, number]
    ) => {
      const toTarget = targetWorldPos.clone().sub(effWorldPos);
      if (toTarget.lengthSq() < 1e-10) {
        return effWorldQuat.clone();
      }
      toTarget.normalize();

      const bestAxis = preferredAxisLocal
        ? new THREE.Vector3(
            preferredAxisLocal[0],
            preferredAxisLocal[1],
            preferredAxisLocal[2]
          )
        : new THREE.Vector3(1, 0, 0);
      const currentApproach = bestAxis.applyQuaternion(effWorldQuat).normalize();
      const bestDot = currentApproach.dot(toTarget);
      if (!Number.isFinite(bestDot)) {
        return effWorldQuat.clone();
      }

      if (bestDot >= 0.9995) {
        return effWorldQuat.clone();
      }

      const alignRotation = new THREE.Quaternion().setFromUnitVectors(
        currentApproach,
        toTarget
      );
      return alignRotation.multiply(effWorldQuat).normalize();
    },
    []
  );
  const resolveApproachAxisForEe = useCallback(
    (
      effWorldPos: THREE.Vector3,
      effWorldQuat: THREE.Quaternion,
      targetWorldPos: THREE.Vector3
    ): [number, number, number] => {
      const toTarget = targetWorldPos.clone().sub(effWorldPos);
      if (toTarget.lengthSq() < 1e-10) {
        return [1, 0, 0];
      }
      toTarget.normalize();

      const axisCandidates: Array<[number, number, number]> = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ];
      let best = axisCandidates[0];
      let bestDot = -Infinity;
      const axisWorld = new THREE.Vector3();
      for (const axis of axisCandidates) {
        axisWorld
          .set(axis[0], axis[1], axis[2])
          .applyQuaternion(effWorldQuat)
          .normalize();
        const dot = axisWorld.dot(toTarget);
        if (dot > bestDot) {
          bestDot = dot;
          best = axis;
        }
      }
      return best;
    },
    []
  );
  const clampSolutionToLimits = useCallback(
    (
      solution: Record<string, number>,
      options?: {
        suppressToast?: boolean;
      }
    ) => {
      if (!jointLimits || Object.keys(jointLimits).length === 0) {
        return { solution, clampedJoints: [] as string[] };
      }
      const clamped: Record<string, number> = { ...solution };
      const clampedJoints: string[] = [];
      Object.entries(solution).forEach(([jointName, value]) => {
        if (!Number.isFinite(value)) return;
        const limits = getJointLimits(jointLimits, jointName);
        if (!Number.isFinite(limits.lower) || !Number.isFinite(limits.upper)) {
          return;
        }
        if (value < limits.lower || value > limits.upper) {
          clamped[jointName] = Math.min(limits.upper, Math.max(limits.lower, value));
          clampedJoints.push(jointName);
        }
      });

      if (clampedJoints.length > 0 && !options?.suppressToast) {
        const now = Date.now();
        if (now - lastLimitToastRef.current > 2000) {
          toast.warning(
            `IK solution clamped to limits for ${clampedJoints.length} joint${
              clampedJoints.length === 1 ? "" : "s"
            }`
          );
          lastLimitToastRef.current = now;
        }
      }

      return { solution: clamped, clampedJoints };
    },
    [jointLimits]
  );
  const scoreSolutionPostureRisk = useCallback(
    (
      solution: Record<string, number>,
      referenceValues?: Record<string, number>
    ) => {
      if (!jointLimits || Object.keys(jointLimits).length === 0) {
        return 0;
      }
      let edgePenalty = 0;
      let foldPenalty = 0;
      let deltaPenalty = 0;
      let samples = 0;

      Object.entries(solution).forEach(([jointName, value]) => {
        if (!Number.isFinite(value)) return;
        const limits = getJointLimits(jointLimits, jointName);
        if (!Number.isFinite(limits.lower) || !Number.isFinite(limits.upper)) {
          return;
        }
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
    },
    [jointLimits]
  );

  const ikDragEnabled =
    enableIk &&
    doesViewerDragModeUseIkHandles(dragMode) &&
    !!robot &&
    !!urdfContent &&
    !!endEffectorLink;

  const applyArmTargetsWithKernel = useCallback(
    (
      solution: Record<string, number>,
      options?: {
        endEffectorLink?: string | null;
      }
    ): Record<string, number> => {
      const state = useJointStore.getState().jointValues;
      if (!motionKernel) {
        return {
          ...state,
          ...solution,
        };
      }

      const targetEndEffectorLink = options?.endEffectorLink ?? endEffectorLink;
      const resolvedEe = targetEndEffectorLink?.trim() ?? "";
      const decodedEe = safeDecodeEndEffectorLink(resolvedEe).trim();
      const ownerId =
        (resolvedEe &&
          motionKernel.partitions.manipulatorByEndEffector[resolvedEe]) ||
        (decodedEe &&
          motionKernel.partitions.manipulatorByEndEffector[decodedEe]) ||
        null;
      const sanitizedTargets = motionKernel.sanitizeManipulatorTargets(solution, {
        ownerId: ownerId ?? null,
        endEffectorLink: targetEndEffectorLink,
        wheelDriveEnabled,
      });
      const result = motionKernel.apply({
        currentJointValues: state,
        wheelDriveEnabled,
        commands: [
          {
            ownerId: ownerId ?? "arm:unscoped",
            domain: "arm",
            priority: 20,
            jointTargets: sanitizedTargets,
          },
        ],
      });
      if (result.diagnostics.rejected.length > 0) {
        const sampleReason = result.diagnostics.rejected[0]?.reason ?? "owner-mismatch";
        if (lastKernelWarningRef.current !== sampleReason) {
          console.warn("[motion-kernel] Rejected IK targets", result.diagnostics.rejected);
          lastKernelWarningRef.current = sampleReason;
        }
      } else {
        lastKernelWarningRef.current = null;
      }
      return result.jointValues;
    },
    [endEffectorLink, motionKernel, wheelDriveEnabled]
  );

  const clampTargetPositionToArmReach = useCallback(
    (targetPosition: [number, number, number]): [number, number, number] => {
      const envelope = resolveArmReachEnvelope({
        robot,
        urdfAnalysis,
        endEffectorLink,
        maxLinkTraversal: dragConfig.maxLinkTraversal,
      });
      const clamped = clampWorldTargetToArmReach(
        new THREE.Vector3(targetPosition[0], targetPosition[1], targetPosition[2]),
        envelope,
        new THREE.Vector3()
      );
      return [clamped.targetWorld.x, clamped.targetWorld.y, clamped.targetWorld.z];
    },
    [dragConfig.maxLinkTraversal, endEffectorLink, robot, urdfAnalysis]
  );

  const clearRememberedBlockedTarget = useCallback(() => {
    rememberedBlockedTargetRef.current = null;
  }, []);

  const applyIkMotionSafety = useCallback(
    (targetJointValues: Record<string, number>): Record<string, number> => {
      return limitIkJointTargetsToMotionSafety({
        currentJointValues: useJointStore.getState().jointValues,
        jointLimits,
        state: ikMotionSafetyStateRef.current,
        targetJointValues,
        timestampMs: performance.now(),
      }).jointValues;
    },
    [jointLimits]
  );

  const resolveRememberedBlockedTargetObject = useCallback(
    (rememberedTarget: CreatedObject): CreatedObject => {
      const currentTarget = useObjectStore
        .getState()
        .objects.find((object) => object.id === rememberedTarget.id);
      if (!currentTarget) {
        return rememberedTarget;
      }
      return {
        ...currentTarget,
        ikTargetType: rememberedTarget.ikTargetType,
        orbitTargetPoint: rememberedTarget.orbitTargetPoint,
        orbitRadius: rememberedTarget.orbitRadius,
        orbitInclination: rememberedTarget.orbitInclination,
        orbitPhase: rememberedTarget.orbitPhase,
        orbitSecondaryOffset: rememberedTarget.orbitSecondaryOffset,
      };
    },
    []
  );

  const liveIkSeedValues = useMemo(
    () => getLiveRobotJoints(robot, storeJointValues),
    [robot, storeJointValues]
  );

  // Reset IK smoothing state when the robot or drag mode changes
  useEffect(() => {
    lastIkAppliedRef.current = null;
    lastIkApplyTimeRef.current = null;
  }, [urdfContent, endEffectorLink, dragMode]);

  useEffect(() => {
    if (!allowRemote || !robot || !urdfContent || !endEffectorLink) return;
    if (selectedSolverId !== "lerobot-placo") return;

    const pose = extractLinkPose(robot, endEffectorLink);
    if (!pose) return;

    const warmupKey = `lerobot:${endEffectorLink}:${urdfContent.length}`;
    if (lerobotWarmupRef.current.key === warmupKey) {
      return;
    }
    lerobotWarmupRef.current = { key: warmupKey, inFlight: true };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const normalizedPose = normalizeIkTargetPoseForRobotBase(robot, {
      position: pose.position,
      quaternion: pose.quaternion,
    });
    const warmupJoints = getLiveRobotJoints(robot, useJointStore.getState().jointValues);

    guardedFetch(`${apiBaseUrl}/lerobot/ik`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urdf: urdfContent,
        joint_values: warmupJoints,
        target_link: endEffectorLink,
        target_position: normalizedPose.position,
        target_wxyz: normalizedPose.quaternion,
      }),
      signal: controller.signal,
    }, {
      requiredBackends: FEATURE_GATES.ikRemoteSolve.requiredBackends,
      context: "IK warmup (LeRobot)",
    })
      .catch(() => {
        // Best-effort warmup for Placo.
      })
      .finally(() => {
        clearTimeout(timeout);
        if (lerobotWarmupRef.current.key === warmupKey) {
          lerobotWarmupRef.current.inFlight = false;
        }
      });

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [apiBaseUrl, allowRemote, endEffectorLink, robot, selectedSolverId, urdfContent]);

  useEffect(() => {
    if (doesViewerDragModeUseIkHandles(dragMode)) {
      return;
    }
    const status = isIkRunning
      ? "running"
      : ikError
        ? "error"
        : ikResult
          ? "success"
          : "idle";

    setIkDebugState({
      status,
      error: ikError,
      targetName: ikTargetName,
      isFollowingOrbit,
      orbitFollowProgress,
      durationMs: ikSolveDurationMs,
      diagnostics: ikResult?.diagnostics ?? null,
    });
  }, [
    dragMode,
    ikError,
    ikResult,
    ikTargetName,
    isFollowingOrbit,
    isIkRunning,
    orbitFollowProgress,
    ikSolveDurationMs,
    setIkDebugState,
  ]);

  const solveIkForTarget = useCallback(
    async (
      obj: CreatedObject,
      options?: {
        preserveRememberedBlockedTarget?: boolean;
      }
    ) => {
      if (!options?.preserveRememberedBlockedTarget) {
        clearRememberedBlockedTarget();
      }
      if (!enableIk) {
        toast.info("IK is disabled.");
        return;
      }

      if (!robot || !urdfContent) {
        toast.error("Load a robot and URDF before solving IK.");
        return;
      }
      if (!endEffectorLink) {
        toast.error("Select an end-effector link to target.");
        return;
      }

      // Clicking a target always takes control immediately.
      // Stop any in-progress orbit follow before solving for the new target.
      if (isFollowingOrbit) {
        orbitFollowAbortRef.current = true;
        if (orbitFollowAnimationRef.current) {
          cancelAnimationFrame(orbitFollowAnimationRef.current);
          orbitFollowAnimationRef.current = null;
        }
        setIsFollowingOrbit(false);
        setOrbitFollowProgress(0);
      }

      const solveSession = beginIkObjectSolveSession(
        () => objectSolveTokenRef.current,
        (token) => {
          objectSolveTokenRef.current = token;
        }
      );

      const lockedApproachTask = await lockIkdApproachTask({
        object: obj,
        objects: worldObjects,
        orbitDefaults,
      });
      if (solveSession.isStale()) {
        void cancelIkdApproachTask(lockedApproachTask.taskId);
        return;
      }
      activeIkdApproachTaskIdRef.current = lockedApproachTask.taskId;
      const targetObj = lockedApproachTask.lockedObject;
      const objectTargetPosition = lockedApproachTask.objectTargetPositionWorld;
      const isOrbitTarget = lockedApproachTask.isOrbitTarget;
      const isBackendTaskInvalid = () => {
        if (lockedApproachTask.taskId <= 0) {
          return false;
        }
        const { connectionStatus, activeTask } = useIkdApproachTaskStore.getState();
        if (connectionStatus !== "connected" || activeTask === null) {
          return false;
        }
        return (
          activeTask.task_id !== lockedApproachTask.taskId || activeTask.state === "cancelled"
        );
      };
      const isStaleSolve = () => solveSession.isStale() || isBackendTaskInvalid();

      setIkDialogOpen(false);
      setIkResult(null);
      setIkError(null);
      setIkTargetName(targetObj.id);
      setIsIkRunning(true);
      setIkDebugState({
        roverApproachStatus: onBeforeObjectIkSolve ? "running" : "skipped",
        roverApproachPhase: "idle",
        roverApproachReason: null,
        roverApproachDistanceM: null,
        roverApproachYawErrorDeg: null,
        roverApproachDurationMs: null,
      });
      let ikSolveStartedAtMs: number | null = null;
      try {
        const runObjectPreSolve = async ({
          targetPositionWorld,
          isOrbitTarget,
          targetKind = "object-center",
          fallbackErrorMessage,
        }: {
          targetPositionWorld: [number, number, number];
          isOrbitTarget: boolean;
          targetKind?: "object-center" | "surface-point";
          fallbackErrorMessage: string;
        }): Promise<IkObjectPreSolveResult | null> => {
          if (!onBeforeObjectIkSolve) {
            return null;
          }
          const preSolveStartedAtMs = performance.now();
          try {
            const preSolveResult = await onBeforeObjectIkSolve({
              object: targetObj,
              targetPositionWorld,
              isOrbitTarget,
              targetKind,
              isStaleSolve,
              reportProgress: (progress) => {
                if (isStaleSolve()) return;
                setIkDebugState({
                  roverApproachStatus: "running",
                  roverApproachPhase: progress.phase ?? "idle",
                  roverApproachDistanceM: progress.distanceToTargetM ?? null,
                  roverApproachYawErrorDeg: progress.yawErrorDeg ?? null,
                });
              },
            });
            if (isStaleSolve()) {
              return null;
            }
            const normalizedPreSolveResult =
              normalizeIkObjectPreSolveResult(preSolveResult);
            if (shouldRememberBlockedTargetAfterPreSolve(normalizedPreSolveResult)) {
              rememberedBlockedTargetRef.current = targetObj;
            } else if (
              normalizedPreSolveResult.status === "failed" ||
              normalizedPreSolveResult.status === "timeout"
            ) {
              clearRememberedBlockedTarget();
            }
            setIkDebugState({
              roverApproachStatus: normalizedPreSolveResult.status,
              roverApproachPhase:
                normalizedPreSolveResult.status === "completed" ? "done" : "idle",
              roverApproachReason: normalizedPreSolveResult.reason ?? null,
              roverApproachDistanceM:
                normalizedPreSolveResult.finalDistanceToTargetM ?? null,
              roverApproachYawErrorDeg:
                normalizedPreSolveResult.finalYawErrorDeg ?? null,
              roverApproachDurationMs:
                normalizedPreSolveResult.durationMs ??
                performance.now() - preSolveStartedAtMs,
            });
            if (shouldAbortIkSolveAfterPreSolve(normalizedPreSolveResult)) {
              const message = resolveIkPreSolveTerminalErrorMessage(
                normalizedPreSolveResult
              );
              if (message) {
                setIkError(message);
                toast.error(message);
              }
              setIkResult(null);
            }
            return normalizedPreSolveResult;
          } catch (error) {
            if (isStaleSolve()) {
              return null;
            }
            const message =
              error instanceof Error ? error.message : fallbackErrorMessage;
            clearRememberedBlockedTarget();
            setIkDebugState({
              roverApproachStatus: "failed",
              roverApproachPhase: "idle",
              roverApproachReason: message,
              roverApproachDurationMs: performance.now() - preSolveStartedAtMs,
            });
            setIkError(message);
            toast.error(message);
            setIkResult(null);
            return {
              status: "failed",
              reason: message,
              durationMs: performance.now() - preSolveStartedAtMs,
            };
          }
        };
        let initialPreSolveResult: IkObjectPreSolveResult | null = null;
        if (onBeforeObjectIkSolve) {
          initialPreSolveResult = await runObjectPreSolve({
            targetPositionWorld: objectTargetPosition,
            isOrbitTarget,
            fallbackErrorMessage: "Rover approach failed",
          });
          if (isStaleSolve()) {
            return;
          }
          if (
            initialPreSolveResult &&
            shouldAbortIkSolveAfterPreSolve(initialPreSolveResult)
          ) {
            return;
          }
        }
        let jointValues = getLiveRobotJoints(robot, useJointStore.getState().jointValues);
        let { position: effPos, quaternion: effQuat } = resolveEffectorWorldPose(
          robot,
          endEffectorLink
        );

        let targetPosition = resolveIkObjectSolveTargetWorld({
          object: targetObj,
          objectTargetPositionWorld: objectTargetPosition,
          isOrbitTarget,
          effectorWorldPosition: effPos,
          clampTargetPositionToArmReach,
        });
        if (
          shouldRunSurfaceTargetApproachRetry({
            hasPreSolveHandler: Boolean(onBeforeObjectIkSolve),
            isOrbitTarget,
            wheelDriveEnabled,
            initialPreSolveStatus: initialPreSolveResult?.status ?? null,
            robot,
            urdfAnalysis,
            endEffectorLink,
            maxLinkTraversal: dragConfig.maxLinkTraversal,
            targetPosition,
          })
        ) {
          const surfacePreSolveResult = await runObjectPreSolve({
            targetPositionWorld: targetPosition,
            isOrbitTarget: false,
            targetKind: "surface-point",
            fallbackErrorMessage: "Rover surface approach failed",
          });
          if (isStaleSolve()) {
            return;
          }
          if (
            surfacePreSolveResult &&
            shouldAbortIkSolveAfterPreSolve(surfacePreSolveResult)
          ) {
            return;
          }
          if (surfacePreSolveResult) {
            ({ position: effPos, quaternion: effQuat } = resolveEffectorWorldPose(
              robot,
              endEffectorLink
            ));
            jointValues = getLiveRobotJoints(robot, useJointStore.getState().jointValues);
            // Re-resolve the final contact target from the settled post-approach pose.
            // This allows the solver to switch faces when the original side would force a collision.
            targetPosition = resolveIkObjectSolveTargetWorld({
              object: targetObj,
              objectTargetPositionWorld: objectTargetPosition,
              isOrbitTarget,
              effectorWorldPosition: effPos,
              clampTargetPositionToArmReach,
            });
          }
        }

        clearRememberedBlockedTarget();

        const targetWorldVec = new THREE.Vector3(
          targetPosition[0],
          targetPosition[1],
          targetPosition[2]
        );
        const approachAxisLocal = !isOrbitTarget
          ? resolveApproachAxisForEe(effPos, effQuat, targetWorldVec)
          : ([1, 0, 0] as [number, number, number]);
        const targetQuaternionWorld = !isOrbitTarget
          ? deriveComAlignedQuaternion(
              effPos,
              effQuat,
              targetWorldVec,
              approachAxisLocal
            )
          : effQuat.clone();
        const targetQuaternion: [number, number, number, number] = [
          targetQuaternionWorld.w,
          targetQuaternionWorld.x,
          targetQuaternionWorld.y,
          targetQuaternionWorld.z,
        ];
        const orientationMode: OrientationMode = isOrbitTarget
          ? resolveOrientationMode(clickOrientation, "optional")
          : clickOrientation === "ignore"
            ? "prefer"
            : resolveOrientationMode(clickOrientation, "prefer");
        const approachWorld = new THREE.Vector3(
          approachAxisLocal[0],
          approachAxisLocal[1],
          approachAxisLocal[2]
        )
          .applyQuaternion(effQuat)
          .normalize();
        const toTargetDir = targetWorldVec.clone().sub(effPos);
        const rearTargetDot =
          toTargetDir.lengthSq() > 1e-10
            ? approachWorld.dot(toTargetDir.normalize())
            : 1;
        const isRearTarget =
          !isOrbitTarget && Number.isFinite(rearTargetDot) && rearTargetDot < -0.12;
        const normalizedTarget = normalizeIkTargetPoseForRobotBase(robot, {
          position: targetPosition,
          quaternion: targetQuaternion,
        });
        const normalizedTargetQuaternion = new THREE.Quaternion(
          normalizedTarget.quaternion[1],
          normalizedTarget.quaternion[2],
          normalizedTarget.quaternion[3],
          normalizedTarget.quaternion[0]
        );
        const orientationPayload = buildIkOrientationPayload(normalizedTargetQuaternion);

        setIkDebugState({
          lastTargetPosition: targetPosition,
          lastTargetQuaternion: targetQuaternion,
        });

        ikSolveStartedAtMs = performance.now();
        try {
          let primarySeedValues = jointValues;

        if (isRearTarget) {
          const baseWorldPos = new THREE.Vector3();
          if (typeof robot.getWorldPosition === "function") {
            robot.getWorldPosition(baseWorldPos);
          } else {
            baseWorldPos.copy(robot.position);
          }
          const radial = new THREE.Vector3(
            targetWorldVec.x - baseWorldPos.x,
            targetWorldVec.y - baseWorldPos.y,
            0
          );
          if (radial.lengthSq() < 1e-10) {
            radial.set(effPos.x - baseWorldPos.x, effPos.y - baseWorldPos.y, 0);
          }
          if (radial.lengthSq() < 1e-10) {
            radial.set(1, 0, 0);
          }
          radial.normalize();
          const baseToTarget = Math.hypot(
            targetWorldVec.x - baseWorldPos.x,
            targetWorldVec.y - baseWorldPos.y
          );
          const transitRadius = Math.min(0.3, Math.max(0.12, baseToTarget * 0.42));
          const transitHeight =
            Math.max(effPos.z, targetWorldVec.z, baseWorldPos.z + 0.12) +
            Math.min(0.14, Math.max(0.06, baseToTarget * 0.18));
          const transitWorldTarget: [number, number, number] = [
            baseWorldPos.x + radial.x * transitRadius,
            baseWorldPos.y + radial.y * transitRadius,
            transitHeight,
          ];
          const normalizedTransitTarget = normalizeIkTargetPoseForRobotBase(robot, {
            position: transitWorldTarget,
            quaternion: targetQuaternion,
          });
          const transitQuat = new THREE.Quaternion(
            normalizedTransitTarget.quaternion[1],
            normalizedTransitTarget.quaternion[2],
            normalizedTransitTarget.quaternion[3],
            normalizedTransitTarget.quaternion[0]
          );
          const transitOrientationPayload = buildIkOrientationPayload(transitQuat);
          const transitSolve = await solveIk({
            apiBaseUrl,
            urdf: urdfContent,
            jointValues: primarySeedValues,
            targetLink: endEffectorLink,
            targetPosition: normalizedTransitTarget.position,
            orientation: transitOrientationPayload ?? null,
            orientationMode: "optional",
            timeoutMs: Math.min(requestTimeoutMs, 260),
            solverChain: [selectedSolverId],
          });
          if (isStaleSolve()) {
            return;
          }
          if (!isIkFailure(transitSolve) && transitSolve.result?.solution) {
            primarySeedValues = transitSolve.result.solution;
          }
        }

        const primarySolve = await solveIk({
          apiBaseUrl,
          urdf: urdfContent,
          jointValues: primarySeedValues,
          targetLink: endEffectorLink,
          targetPosition: normalizedTarget.position,
          orientation: orientationPayload ?? null,
          orientationMode,
          timeoutMs: requestTimeoutMs,
          solverChain: [selectedSolverId],
        });
        if (isStaleSolve()) {
          return;
        }

        if (isIkFailure(primarySolve)) {
          const message = primarySolve.error || "IK solve failed";
          setIkError(message);
          toast.error(message);
          setIkResult(null);
          return;
        }

        if (!primarySolve.result?.solution) {
          const message = "IK solve returned no solution";
          setIkError(message);
          toast.error(message);
          setIkResult(null);
          return;
        }

        let resolvedResult = primarySolve.result;
        let resolvedRisk = scoreSolutionPostureRisk(resolvedResult.solution, jointValues);
        if (!isOrbitTarget && selectedSolverId !== "ik-js" && resolvedRisk > 0.24) {
          const fallbackSolve = await solveIk({
            apiBaseUrl,
            urdf: urdfContent,
            jointValues: resolvedResult.solution,
            targetLink: endEffectorLink,
            targetPosition: normalizedTarget.position,
            orientation: orientationPayload ?? null,
            orientationMode,
            timeoutMs: Math.min(requestTimeoutMs, 260),
            solverChain: ["ik-js"],
          });
          if (isStaleSolve()) {
            return;
          }
          if (!isIkFailure(fallbackSolve) && fallbackSolve.result?.solution) {
            const fallbackRisk = scoreSolutionPostureRisk(
              fallbackSolve.result.solution,
              jointValues
            );
            const primaryCost = resolvedResult.diagnostics?.cost;
            const fallbackCost = fallbackSolve.result.diagnostics?.cost;
            const fallbackReachComparable =
              !Number.isFinite(primaryCost ?? NaN) ||
              !Number.isFinite(fallbackCost ?? NaN) ||
              (fallbackCost as number) <= (primaryCost as number) * 1.35 + 0.01;
            if (fallbackReachComparable && fallbackRisk + 0.05 < resolvedRisk) {
              resolvedResult = fallbackSolve.result;
              resolvedRisk = fallbackRisk;
            }
          }
        }

        if (isStaleSolve()) {
          return;
        }
        setIkError(null);
        setIkResult(resolvedResult);
        } catch (err) {
          if (isStaleSolve()) {
            return;
          }
          setIkError(err instanceof Error ? err.message : "Unknown IK error");
          setIkResult(null);
        } finally {
          if (!solveSession.isStale() && ikSolveStartedAtMs !== null) {
            setIkSolveDurationMs(performance.now() - ikSolveStartedAtMs);
          }
        }
      } finally {
        const solveStillCurrent = !solveSession.isStale();
        if (solveStillCurrent) {
          setIsIkRunning(false);
        }
        if (activeIkdApproachTaskIdRef.current === lockedApproachTask.taskId) {
          activeIkdApproachTaskIdRef.current = 0;
        }
        void cancelIkdApproachTask(lockedApproachTask.taskId);
      }
    },
    [
      apiBaseUrl,
      clickOrientation,
      endEffectorLink,
      enableIk,
      isFollowingOrbit,
      orbitDefaults,
      deriveComAlignedQuaternion,
      resolveApproachAxisForEe,
      onBeforeObjectIkSolve,
      requestTimeoutMs,
      robot,
      scoreSolutionPostureRisk,
      selectedSolverId,
      setIkDebugState,
      clampTargetPositionToArmReach,
      clearRememberedBlockedTarget,
      dragConfig.maxLinkTraversal,
      setIsIkRunning,
      urdfAnalysis,
      urdfContent,
      wheelDriveEnabled,
      worldObjects,
    ]
  );

  // Follow orbit incrementally using previous IK solution as seed
  const solveIkForObject = useCallback(
    async (obj: CreatedObject) => {
      await solveIkForTarget(obj);
    },
    [solveIkForTarget]
  );

  const retryRememberedBlockedObjectSolve = useCallback(() => {
    const rememberedTarget = rememberedBlockedTargetRef.current;
    if (
      !canRetryRememberedBlockedTarget({
        hasRememberedTarget: rememberedTarget !== null,
        isFollowingOrbit,
        isIkHandleDragging,
        isIkRunning,
      }) ||
      !rememberedTarget
    ) {
      return false;
    }
    void solveIkForTarget(resolveRememberedBlockedTargetObject(rememberedTarget), {
      preserveRememberedBlockedTarget: true,
    });
    return true;
  }, [
    isFollowingOrbit,
    isIkHandleDragging,
    isIkRunning,
    resolveRememberedBlockedTargetObject,
    solveIkForTarget,
  ]);

  const followOrbitIncremental = useCallback(
    async (targetObjectId: string) => {
      if (!enableIk) {
        toast.info("IK is disabled.");
        return;
      }
      const targetObj = useObjectStore.getState().objects.find((o) => o.id === targetObjectId);
      if (!targetObj || targetObj.ikTargetType !== "orbit") {
        toast.error("Target is not an orbit");
        return;
      }

      if (!robot || !urdfContent || !endEffectorLink) {
        toast.error("Missing robot, URDF, or end-effector link");
        return;
      }

      if (!ikResult) {
        toast.error("No IK solution to start from");
        return;
      }

      const normalizeDeg = (deg: number) => ((deg % 360) + 360) % 360;

      // Determine which point was clicked and calculate the arc to traverse
      const basePhase = targetObj.orbitPhase ?? orbitDefaults.phaseDeg;
      const secondaryOffset =
        targetObj.orbitSecondaryOffset ?? orbitDefaults.secondaryOffsetDeg;
      const clickedPoint = targetObj.orbitTargetPoint; // "primary", "secondary", or "center"

      if (clickedPoint === "center" || !clickedPoint) {
        toast.error("Please click on a primary or secondary orbit point first");
        return;
      }

      const primaryPhase = normalizeDeg(basePhase);
      const secondaryPhase = normalizeDeg(basePhase + secondaryOffset);
      const startPhase = clickedPoint === "primary" ? primaryPhase : secondaryPhase;
      const destinationPhase = clickedPoint === "primary" ? secondaryPhase : primaryPhase;

      // Choose the shortest arc between the two points (matches the solid segment in the visualization)
      const clockwiseDelta = normalizeDeg(destinationPhase - startPhase);
      const counterClockwiseDelta = clockwiseDelta === 0 ? 360 : 360 - clockwiseDelta;
      const useClockwise = clockwiseDelta <= counterClockwiseDelta;
      const arcLength = clockwiseDelta === 0 ? 360 : useClockwise ? clockwiseDelta : counterClockwiseDelta;
      const direction = useClockwise ? 1 : -1;

      // Stop any existing orbit following
      if (orbitFollowAnimationRef.current) {
        cancelAnimationFrame(orbitFollowAnimationRef.current);
      }
      orbitFollowAbortRef.current = false;
      resetIkMotionSafetyState(ikMotionSafetyStateRef.current);

      setIsFollowingOrbit(true);
      setOrbitFollowProgress(0);
      setIkDebugState({ lastTargetQuaternion: null });

      const totalSteps = Math.max(1, Math.round(arcLength)); // 1 degree per step
      const minStepIntervalMs = 45;

      let currentStep = 0;
      let currentJointValues = { ...ikResult.solution };
      let lastTimestamp = performance.now();

      const computeTargetPosition = (phaseDeg: number): [number, number, number] => {
        return clampTargetPositionToArmReach(
          resolveObjectOrbitPhaseWorldTarget({
            object: targetObj,
            orbitDefaults,
            phaseDeg,
          })
        );
      };

      const stepOrbit = async (timestamp: number) => {
        if (orbitFollowAbortRef.current) {
          setIsFollowingOrbit(false);
          orbitFollowAnimationRef.current = null;
          toast.info("Orbit following stopped");
          return;
        }

        // Throttle the IK calls to avoid hammering the backend
        if (timestamp - lastTimestamp < minStepIntervalMs && currentStep !== 0) {
          orbitFollowAnimationRef.current = requestAnimationFrame(stepOrbit);
          return;
        }
        lastTimestamp = timestamp;

        // Calculate current phase along the chosen arc
        const t = totalSteps <= 1 ? 1 : currentStep / (totalSteps - 1); // cover the full arc including the end point
        const currentPhase = normalizeDeg(startPhase + direction * arcLength * t);
        const targetPositionWorld = computeTargetPosition(currentPhase);
        setIkDebugState({ lastTargetPosition: targetPositionWorld });
        const normalizedTarget = normalizeIkTargetPoseForRobotBase(robot, {
          position: targetPositionWorld,
          quaternion: [1, 0, 0, 0],
        });

        try {
          const start = performance.now();
          const result = await solveIk({
            apiBaseUrl,
            urdf: urdfContent,
            jointValues: currentJointValues,
            targetLink: endEffectorLink,
            targetPosition: normalizedTarget.position,
            orientationMode: "ignore",
            timeoutMs: orbitTimeoutMs,
            solverChain: [selectedSolverId],
          });

          setIkSolveDurationMs(performance.now() - start);

          if (isIkFailure(result)) {
            console.error("IK failed at step", currentStep, result.error);
            return;
          }

          if (!result.result?.solution) {
            console.error("IK failed at step", currentStep, "No solution returned");
            return;
          }

          const { solution: clampedSolution } = clampSolutionToLimits(result.result.solution);
          const rawNextJointValues = applyArmTargetsWithKernel(clampedSolution, {
            endEffectorLink,
          });
          const nextJointValues = applyIkMotionSafety(rawNextJointValues);
          currentJointValues = nextJointValues;

          if (!orbitFollowAbortRef.current) {
            setStoreJointValues(nextJointValues);
            onIkApplied?.(nextJointValues, {
              inputSource: OPERATOR_TELEOP_INPUT_SOURCE_IK_APPLY,
            });
          }
        } catch (err) {
          console.error("Error during orbit following:", err);
          setIsFollowingOrbit(false);
          orbitFollowAnimationRef.current = null;
          toast.error("Orbit following failed");
          return;
        }

        currentStep++;
        setOrbitFollowProgress(Math.min(100, (currentStep / totalSteps) * 100));

        if (currentStep < totalSteps) {
          orbitFollowAnimationRef.current = requestAnimationFrame(stepOrbit);
        } else {
          setIsFollowingOrbit(false);
          orbitFollowAnimationRef.current = null;
        }
      };

      // Start the orbit following
      orbitFollowAnimationRef.current = requestAnimationFrame(stepOrbit);
    },
    [
      apiBaseUrl,
      clampSolutionToLimits,
      endEffectorLink,
      enableIk,
      ikResult,
      onIkApplied,
      orbitDefaults,
      orbitTimeoutMs,
      robot,
      selectedSolverId,
      setIkDebugState,
      setStoreJointValues,
      applyIkMotionSafety,
      applyArmTargetsWithKernel,
      clampTargetPositionToArmReach,
      urdfContent,
    ]
  );

  // Stop orbit following
  const stopOrbitFollow = useCallback(() => {
    orbitFollowAbortRef.current = true;
    if (orbitFollowAnimationRef.current) {
      cancelAnimationFrame(orbitFollowAnimationRef.current);
      orbitFollowAnimationRef.current = null;
    }
    setIsFollowingOrbit(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (orbitFollowAnimationRef.current) {
        cancelAnimationFrame(orbitFollowAnimationRef.current);
      }
    };
  }, []);

  const handleIkDragSolved = useCallback(
    (
      solution: Record<string, number>,
      options?: {
        endEffectorLink?: string | null;
      }
    ) => {
      const targetEndEffectorLink = options?.endEffectorLink ?? endEffectorLink;
      const { solution: clampedSolution } = clampSolutionToLimits(solution, {
        suppressToast: true,
      });
      const rawNextJointValues = applyArmTargetsWithKernel(clampedSolution, {
        endEffectorLink: targetEndEffectorLink,
      });
      const rawNextSafe = applyIkMotionSafety(rawNextJointValues);
      if (queueGenesisJointCommand(rawNextSafe)) {
        onManualJointChange?.();
        onIkApplied?.(rawNextSafe, {
          inputSource: OPERATOR_TELEOP_INPUT_SOURCE_IK_DRAG,
        });
        return;
      }

      // Visual drag smoothing — purely cosmetic, keeps the 3D robot from
      // snapping between IK throttle intervals.
      // Uses a fixed alpha independent of the solver's smoothAlpha (which is
      // for solve blending and is far too low for interactive drag feedback).
      // α=0.55 at ~30–60 Hz solves: reaches 95% of target in 4–5 ticks (~80ms).
      const DRAG_VISUAL_ALPHA = 0.55;
      const eeKey = targetEndEffectorLink ?? "";
      const prev = dragSmoothedJointsRef.current.get(eeKey) ?? {};
      const nextJointValues: Record<string, number> = {};
      for (const [joint, target] of Object.entries(rawNextSafe)) {
        const prevVal = prev[joint];
        nextJointValues[joint] =
          prevVal !== undefined ? prevVal + DRAG_VISUAL_ALPHA * (target - prevVal) : target;
      }
      dragSmoothedJointsRef.current.set(eeKey, nextJointValues);

      // Keep per-handle interaction independent and predictable.
      lastIkAppliedRef.current = null;
      lastIkApplyTimeRef.current = performance.now();

      onManualJointChange?.();
      const robotAny = robot;
      if (robotAny?.setJointValues || robotAny?.setJointValue) {
        // Visual: apply smoothed values so the 3D robot glides.
        applyJointValues(robotAny, nextJointValues, { filter: false });
      }
      // Store and recording get the raw (unsmoothed) solution — the user's true
      // intent. Smoothing is visual only; it must not lag or distort the dataset.
      setStoreJointValues(rawNextSafe);
      onIkApplied?.(rawNextSafe, {
        inputSource: OPERATOR_TELEOP_INPUT_SOURCE_IK_DRAG,
      });
    },
    [
      applyArmTargetsWithKernel,
      applyIkMotionSafety,
      clampSolutionToLimits,
      endEffectorLink,
      onIkApplied,
      onManualJointChange,
      robot,
      setStoreJointValues,
    ]
  );

  const handleIkDragStateChange = useCallback((
    dragging: boolean,
    endEffectorLink?: string
  ) => {
    setIsIkHandleDragging(dragging);
    resetIkMotionSafetyState(ikMotionSafetyStateRef.current);
    if (dragging) {
      onManualJointChange?.();
    } else {
      // Remove only this handle's smooth state so other simultaneously-active
      // handles are unaffected. Clear all if no specific handle is given.
      if (endEffectorLink != null) {
        dragSmoothedJointsRef.current.delete(endEffectorLink);
      } else {
        dragSmoothedJointsRef.current.clear();
      }
    }
  }, [onManualJointChange]);

  const cancelActiveObjectSolve = useCallback(() => {
    objectSolveTokenRef.current += 1;
    const activeIkdApproachTaskId = activeIkdApproachTaskIdRef.current;
    activeIkdApproachTaskIdRef.current = 0;
    if (orbitFollowAnimationRef.current) {
      cancelAnimationFrame(orbitFollowAnimationRef.current);
      orbitFollowAnimationRef.current = null;
    }
    orbitFollowAbortRef.current = true;
    setIsFollowingOrbit(false);
    setOrbitFollowProgress(0);
    setIsIkRunning(false);
    setIkResult(null);
    setIkError(null);
    setIkTargetName(null);
    setIkDialogOpen(false);
    setIkDebugState({
      roverApproachStatus: "cancelled",
      roverApproachPhase: "idle",
      roverApproachReason: "user-reset",
    });
    void cancelIkdApproachTask(activeIkdApproachTaskId);
  }, [setIkDebugState]);

  // Reset IK drag state when mode changes or handle is hidden
  useEffect(() => {
    if (!ikDragEnabled && isIkHandleDragging) {
      setIsIkHandleDragging(false);
    }
  }, [ikDragEnabled, isIkHandleDragging]);

  return {
    followOrbitIncremental,
    handleIkDragSolved,
    handleIkDragStateChange,
    ikDialogOpen,
    ikDragEnabled,
    ikError,
    ikResult,
    ikTargetName,
    isFollowingOrbit,
    isIkHandleDragging,
    isIkRunning,
    liveIkSeedValues,
    orbitFollowProgress,
    cancelActiveObjectSolve,
    retryRememberedBlockedObjectSolve,
    setIkDialogOpen,
    solveIkForObject,
    stopOrbitFollow,
  };
};
