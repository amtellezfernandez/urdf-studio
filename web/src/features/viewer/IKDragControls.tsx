import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import * as THREE from "three";
import { useThree, useFrame, ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { toast } from "sonner";
import type { URDFRobot } from "urdf-loader";
import { API_BASE_URL } from "@/shared/config/api";
import {
  buildIkOrientationPayload,
  normalizeIkTargetPoseForRobotBase,
} from "@/features/viewer/viewer-helpers";
import { IK_ARM_REACH_CONFIG, IK_DRAG_HANDLE_CONFIG } from "@/features/viewer/config";
import { computeStableDragHandleAnchorWorld } from "@/features/viewer/ikDragAnchor";
import {
  resolveIkDragHandleColor,
  resolveIkDragHandleOpacity,
} from "@/features/viewer/ikDragHandleVisuals";
import {
  cancelIk,
  isIkFailure,
  solveIk as solveIkRequest,
} from "@/features/ik/ikClient";
import { syncVisibleIkDragHandlePosition } from "@/features/viewer/ikDragHandlePosition";
import { useIkDebugStore } from "@/features/ik/useIkDebugStore";
import { useIkSolverStore } from "@/features/ik/useIkSolverStore";
import { useIkParamsStore } from "@/features/ik/useIkParamsStore";
import type { OrientationMode } from "@/features/ik/registry";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import {
  buildChainJointNamesFromAnalysis,
  createDragSchedulerState,
  createEmptyDragRuntimeCache,
  enqueueLatestDragTarget,
  isDragSolveResultStale,
  markDragSolveComplete,
  popNextDragSolveTicket,
  refreshRobotFrameCache,
  resolveReachRadiusFromAnalysis,
  robotToWorldPosition,
  robotToWorldQuaternion,
  safeDecodeURIComponent,
  worldToRobotPosition,
  worldToRobotQuaternion,
} from "@/features/viewer/drag-runtime";
import { cloneIkDragReferenceCamera } from "@/features/viewer/ikDragCamera";

const NON_ARM_JOINT_PATTERN = /(wheel|caster|drive|tire)/i;

type DisabledNativeTelemetry = {
  sequence_applied?: number;
  stale_target?: boolean;
  q_rad?: Record<string, number>;
};

interface IKDragControlsProps {
  robot: URDFRobot | null; // URDFRobot
  endEffectorLink: string;
  urdfContent: string;
  urdfAnalysis: UrdfAnalysis | null;
  currentJointValues: Record<string, number>;
  onIkSolved: (solution: Record<string, number>, endEffectorLink: string) => void;
  enabled: boolean;
  wheelDriveEnabled?: boolean;
  allowedJointNames?: string[];
  mode?: "translate" | "rotate";
  onDragStateChange?: (dragging: boolean) => void;
  handleIndex?: number;
  handleCount?: number;
}

export const IKDragControls = ({
  robot,
  endEffectorLink,
  urdfContent,
  urdfAnalysis,
  currentJointValues,
  onIkSolved,
  enabled,
  allowedJointNames,
  mode = "translate",
  onDragStateChange,
  handleIndex = 0,
  handleCount = 1,
}: IKDragControlsProps) => {
  const targetMeshRef = useRef<THREE.Mesh>(null);
  const { camera, gl, raycaster, pointer } = useThree();
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const nativeSequenceRef = useRef(1);
  const lastIkCallRef = useRef<number>(0);
  const activeRequestIdRef = useRef<string | null>(null);
  const latestJointValuesRef = useRef<Record<string, number>>(currentJointValues);
  const lastIkErrorRef = useRef<string | null>(null);
  const lastNativeModelErrorRef = useRef<string | null>(null);
  const pendingTargetLocalRef = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>(null);
  const lastNativeAppliedSequenceRef = useRef(-1);
  const isSolvingRef = useRef(false);
  const dragSessionRef = useRef(0);
  const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane());
  const dragReferenceCameraRef = useRef<THREE.Camera | null>(null);
  const dragOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const targetPositionRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const targetQuaternionRef = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const targetScaleRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const activePointerIdRef = useRef<number | null>(null);
  const intersectionRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const lastSolvedTargetRef = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>(null);
  const desiredTargetRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const hasDesiredTargetRef = useRef(false);
  const hasDesiredTargetLocalRef = useRef(false);
  const desiredTargetLocalRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const lastSubmittedTargetRef = useRef<THREE.Vector3 | null>(null);
  const runtimeCacheRef = useRef(createEmptyDragRuntimeCache());
  const schedulerRef = useRef(createDragSchedulerState(60));
  const clampedRef = useRef(false);
  const inFlightSequenceIdRef = useRef<number | null>(null);
  const [hasEndEffector, setHasEndEffector] = useState(false);
  const setIkDebugState = useIkDebugStore((s) => s.setState);
  const selectedSolverId = useIkSolverStore((s) => s.selectedSolverId);
  const dragOrientation = useIkParamsStore((s) => s.dragOrientation);
  const dragTimeoutMs = useIkParamsStore((s) => s.dragTimeoutMs);
  const dragConfig = useIkParamsStore((s) => s.dragConfig);
  const studioIkAffectsFollowerHardware = false;
  const lastDebugUpdateRef = useRef(0);
  const nativeTargetLink = (() => {
    return safeDecodeURIComponent(endEffectorLink);
  })();
  const debugTargetName = `ee-${handleIndex + 1}:${nativeTargetLink}`;
  const nativeIkRuntime = {
    error: null as string | null,
    lastTelemetry: null as DisabledNativeTelemetry | null,
  };
  const nativeEnabled = false;
  const nativeConnected = false;
  const nativeModelReady = false;
  const ensureNativeModel = useCallback(async (_model: unknown) => false, []);
  const sendNativeTargetLatest = useCallback((_target: unknown) => false, []);

  const {
    minSolveDistance,
    ikThrottleMs,
    maxLinkTraversal,
  } = dragConfig;
  const effectiveIkThrottleMs =
    nativeEnabled
      ? Math.min(ikThrottleMs, 16)
      : selectedSolverId === "ik-js"
        ? Math.min(ikThrottleMs, 22)
        : Math.min(ikThrottleMs, 34);
  const {
    radiusMeters: dragHandleRadiusMeters,
    anchorSurfacePadMeters,
    anchorMinOffsetMeters,
    anchorMaxOffsetMeters,
  } = IK_DRAG_HANDLE_CONFIG;
  const dragHandleColor = resolveIkDragHandleColor({
    affectsHardware: studioIkAffectsFollowerHardware,
    isClamped,
    isDragging,
    isHovered,
  });
  const dragHandleOpacity = resolveIkDragHandleOpacity({
    affectsHardware: studioIkAffectsFollowerHardware,
    isClamped,
    isDragging,
    isHovered,
  });
  const hasHandleAnchorOffsetRef = useRef(false);
  const handleAnchorLocalOffsetRef = useRef(new THREE.Vector3());
  const tmpEePositionRef = useRef(new THREE.Vector3());
  const tmpEeQuaternionRef = useRef(new THREE.Quaternion());
  const tmpAnchorOffsetWorldRef = useRef(new THREE.Vector3());
  const tmpSolveTargetWorldRef = useRef(new THREE.Vector3());
  const tmpWorldPositionRef = useRef(new THREE.Vector3());
  const tmpWorldQuaternionRef = useRef(new THREE.Quaternion());
  const tmpLocalQuaternionRef = useRef(new THREE.Quaternion());
  const allowedJointNamesSet = useMemo(
    () =>
      new Set(
        (allowedJointNames ?? [])
          .map((jointName) => jointName.trim())
          .filter(Boolean)
      ),
    [allowedJointNames]
  );

  const filterJointValuesToActiveArmChain = useCallback(
    (jointValues: Record<string, number>): Record<string, number> => {
      if (allowedJointNamesSet.size > 0) {
        const strictFiltered: Record<string, number> = {};
        allowedJointNamesSet.forEach((jointName) => {
          const value = jointValues[jointName];
          if (typeof value === "number" && Number.isFinite(value)) {
            strictFiltered[jointName] = value;
          }
        });
        if (Object.keys(strictFiltered).length > 0) {
          return strictFiltered;
        }
      }

      const chainJointNames = runtimeCacheRef.current.chainJointNames;
      const filtered: Record<string, number> = {};

      if (chainJointNames && chainJointNames.size > 0) {
        chainJointNames.forEach((jointName) => {
          const value = jointValues[jointName];
          if (typeof value === "number" && Number.isFinite(value)) {
            filtered[jointName] = value;
          }
        });
        if (Object.keys(filtered).length > 0) {
          return filtered;
        }
      }

      Object.entries(jointValues).forEach(([jointName, value]) => {
        if (!Number.isFinite(value)) return;
        if (NON_ARM_JOINT_PATTERN.test(jointName)) return;
        filtered[jointName] = value;
      });

      return Object.keys(filtered).length > 0 ? filtered : jointValues;
    },
    [allowedJointNamesSet]
  );

  const processIkSolutionForApply = useCallback(
    (rawSolution: Record<string, number>): Record<string, number> => {
      return filterJointValuesToActiveArmChain(rawSolution);
    },
    [filterJointValuesToActiveArmChain]
  );

  // Find the end effector link in the robot
  const endEffectorObject = useRef<THREE.Object3D | null>(null);

  // Keep the latest joint seed values available for IK solves while dragging
  useEffect(() => {
    latestJointValuesRef.current = currentJointValues;
  }, [currentJointValues]);

  useEffect(() => {
    if (!robot || !endEffectorLink) {
      endEffectorObject.current = null;
      hasHandleAnchorOffsetRef.current = false;
      handleAnchorLocalOffsetRef.current.set(0, 0, 0);
      setHasEndEffector(false);
      return;
    }

    const robotAny = robot;
    const link =
      robotAny?.links?.[endEffectorLink] ??
      robotAny?.getObjectByName?.(endEffectorLink) ??
      robotAny?.getObjectByName?.(safeDecodeURIComponent(endEffectorLink));

    endEffectorObject.current = link;
    setHasEndEffector(Boolean(link));
  }, [robot, endEffectorLink]);

  useEffect(() => {
    const runtimeCache = runtimeCacheRef.current;
    runtimeCache.chainJointNames = buildChainJointNamesFromAnalysis(
      urdfAnalysis,
      endEffectorLink,
      maxLinkTraversal
    );
    const reach = resolveReachRadiusFromAnalysis({
      urdfAnalysis,
      endEffectorLink,
      robot,
      maxLinkTraversal,
      reachMargin: IK_ARM_REACH_CONFIG.margin,
      minReachMargin: IK_ARM_REACH_CONFIG.minMargin,
      reachSlackMeters: IK_ARM_REACH_CONFIG.slackMeters,
      dynamicHeadroomMeters: IK_ARM_REACH_CONFIG.dynamicHeadroomMeters,
    });
    runtimeCache.baseLinkName = reach.baseLinkName;
    runtimeCache.reachRadius = reach.reachRadius;
  }, [
    endEffectorLink,
    maxLinkTraversal,
    robot,
    urdfAnalysis,
    urdfContent,
  ]);

  useEffect(() => {
    if (!nativeEnabled || !isDragging || !nativeIkRuntime.lastTelemetry) {
      return;
    }
    const telemetry = nativeIkRuntime.lastTelemetry;
    const sequenceApplied = telemetry.sequence_applied;
    if (telemetry.stale_target || typeof sequenceApplied !== "number") {
      return;
    }
    if (sequenceApplied <= lastNativeAppliedSequenceRef.current) {
      return;
    }
    lastNativeAppliedSequenceRef.current = sequenceApplied;

    const jointAnglesRad = telemetry.q_rad;
    if (jointAnglesRad && Object.keys(jointAnglesRad).length > 0) {
      const processed = processIkSolutionForApply(jointAnglesRad);
      onIkSolved(processed, endEffectorLink);
    }
  }, [
    endEffectorLink,
    nativeEnabled,
    isDragging,
    nativeIkRuntime.lastTelemetry,
    onIkSolved,
    processIkSolutionForApply,
    robot,
  ]);

  useEffect(() => {
    if (!nativeEnabled || !nativeIkRuntime.error) {
      return;
    }
    setIkDebugState({
      status: "error",
      error: nativeIkRuntime.error,
    });
  }, [nativeEnabled, nativeIkRuntime.error, setIkDebugState]);

  useEffect(() => {
    if (!nativeEnabled || !nativeConnected) {
      return;
    }
    if (!urdfContent || !nativeTargetLink) {
      return;
    }

    let cancelled = false;
    void ensureNativeModel({
        urdfXml: urdfContent,
        targetLink: nativeTargetLink,
        seedJointValues: filterJointValuesToActiveArmChain(latestJointValuesRef.current),
      })
      .then(() => {
        if (cancelled) return;
        lastNativeModelErrorRef.current = null;
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Native IKD model load failed";
        if (lastNativeModelErrorRef.current !== message) {
          lastNativeModelErrorRef.current = message;
          console.warn("[IKD] Model preload failed:", message);
          toast.error(message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    nativeEnabled,
    nativeConnected,
    ensureNativeModel,
    urdfContent,
    nativeTargetLink,
    filterJointValuesToActiveArmChain,
  ]);

  useEffect(() => {
    if (runtimeCacheRef.current.reachRadius === null) {
      clampedRef.current = false;
      setIsClamped(false);
    }
  }, [endEffectorLink, urdfAnalysis, urdfContent]);

  const syncTargetToEndEffector = useCallback(() => {
    if (!endEffectorObject.current || !targetMeshRef.current) return;

    refreshRobotFrameCache(runtimeCacheRef.current, robot);
    const link = endEffectorObject.current;
    robot?.updateMatrixWorld?.(true);
    if (typeof link.updateWorldMatrix === "function") {
      link.updateWorldMatrix(true, false);
    } else {
      link.updateMatrixWorld(true);
    }

    link.matrixWorld.decompose(
      targetPositionRef.current,
      targetQuaternionRef.current,
      targetScaleRef.current
    );

    tmpSolveTargetWorldRef.current.copy(targetPositionRef.current);
    const anchorWorld = computeStableDragHandleAnchorWorld({
      linkObject: link,
      surfacePadMeters: anchorSurfacePadMeters,
      out: tmpSolveTargetWorldRef.current,
    });
    if (anchorWorld) {
      const anchorOffsetDistance = anchorWorld.distanceTo(targetPositionRef.current);
      if (
        anchorOffsetDistance >= anchorMinOffsetMeters &&
        anchorOffsetDistance <= anchorMaxOffsetMeters
      ) {
        tmpAnchorOffsetWorldRef.current.copy(anchorWorld).sub(targetPositionRef.current);
        handleAnchorLocalOffsetRef.current
          .copy(tmpAnchorOffsetWorldRef.current)
          .applyQuaternion(tmpEeQuaternionRef.current.copy(targetQuaternionRef.current).invert());
        hasHandleAnchorOffsetRef.current = true;
        tmpSolveTargetWorldRef.current.copy(anchorWorld);
      } else {
        hasHandleAnchorOffsetRef.current = false;
        handleAnchorLocalOffsetRef.current.set(0, 0, 0);
      }
    } else {
      hasHandleAnchorOffsetRef.current = false;
      handleAnchorLocalOffsetRef.current.set(0, 0, 0);
    }

    targetMeshRef.current.position.copy(tmpSolveTargetWorldRef.current);
    targetMeshRef.current.quaternion.copy(targetQuaternionRef.current);
    worldToRobotPosition(
      runtimeCacheRef.current,
      targetMeshRef.current.position,
      desiredTargetLocalRef.current
    );
    hasDesiredTargetLocalRef.current = false;
    lastSolvedTargetRef.current = {
      position: targetMeshRef.current.position.clone(),
      quaternion: targetQuaternionRef.current.clone(),
    };
    hasDesiredTargetRef.current = false;
    lastSubmittedTargetRef.current = null;
    if (clampedRef.current) {
      clampedRef.current = false;
      setIsClamped(false);
    }
  }, [
    anchorMaxOffsetMeters,
    anchorMinOffsetMeters,
    anchorSurfacePadMeters,
    robot,
  ]);

  useEffect(() => {
    if (!enabled || !hasEndEffector) return;
    syncTargetToEndEffector();
  }, [enabled, hasEndEffector, syncTargetToEndEffector]);

  // Keep the handle locked to the end-effector while idle.
  useEffect(() => {
    if (!enabled || !hasEndEffector || isDragging) return;
    syncTargetToEndEffector();
  }, [currentJointValues, enabled, hasEndEffector, isDragging, syncTargetToEndEffector]);

  // Solve IK when target is moved - uses current joint values as seed for fast convergence
  const runIkSolve = useCallback(
    async (
      targetPositionLocal: THREE.Vector3,
      targetQuaternionLocal: THREE.Quaternion,
      ticketSequenceId: number,
      solveSessionId: number
    ) => {
      const isStaleSession = () => solveSessionId !== dragSessionRef.current;
      if (isStaleSession()) {
        return;
      }
      if (isDragSolveResultStale(schedulerRef.current, ticketSequenceId)) {
        return;
      }
      refreshRobotFrameCache(runtimeCacheRef.current, robot);
      robotToWorldPosition(
        runtimeCacheRef.current,
        targetPositionLocal,
        tmpWorldPositionRef.current
      );
      robotToWorldQuaternion(
        runtimeCacheRef.current,
        targetQuaternionLocal,
        tmpWorldQuaternionRef.current
      );
      setIkDebugState({
        status: "running",
        error: null,
        targetName: debugTargetName,
        lastTargetPosition: [
          tmpWorldPositionRef.current.x,
          tmpWorldPositionRef.current.y,
          tmpWorldPositionRef.current.z,
        ],
        lastTargetQuaternion: [
          tmpWorldQuaternionRef.current.w,
          tmpWorldQuaternionRef.current.x,
          tmpWorldQuaternionRef.current.y,
          tmpWorldQuaternionRef.current.z,
        ],
        durationMs: null,
        diagnostics: null,
      });
      const start = performance.now();

      const orientationMode: OrientationMode =
        dragOrientation === "auto"
          ? selectedSolverId === "ik-js"
            ? "optional"
            : "prefer"
          : dragOrientation;

      if (nativeEnabled) {
        const normalizedTarget = normalizeIkTargetPoseForRobotBase(robot, {
          position: [
            tmpWorldPositionRef.current.x,
            tmpWorldPositionRef.current.y,
            tmpWorldPositionRef.current.z,
          ],
          quaternion: [
            tmpWorldQuaternionRef.current.w,
            tmpWorldQuaternionRef.current.x,
            tmpWorldQuaternionRef.current.y,
            tmpWorldQuaternionRef.current.z,
          ],
        });
        if (nativeConnected && nativeModelReady) {
          const sequence = nativeSequenceRef.current++;
          const accepted = sendNativeTargetLatest({
            schema_version: "1",
            sequence,
            source_ts_ns: Date.now() * 1_000_000,
            mode: "pose",
            target_link: nativeTargetLink,
            position_xyz_m: normalizedTarget.position,
            orientation_wxyz: normalizedTarget.quaternion,
            joint_targets_rad: null,
            orientation_policy: orientationMode,
            max_linear_speed_mps: null,
            max_angular_speed_rps: null,
          });
          if (accepted) {
            if (isStaleSession()) {
              return;
            }
            setIkDebugState({
              status: "success",
              error: null,
              durationMs: performance.now() - start,
            });
            lastSolvedTargetRef.current = {
              position: tmpWorldPositionRef.current.clone(),
              quaternion: tmpWorldQuaternionRef.current.clone(),
            };
            lastIkErrorRef.current = null;
            markDragSolveComplete(schedulerRef.current, ticketSequenceId);
            return;
          }
        }
      }

      if (isStaleSession()) {
        return;
      }
      if (activeRequestIdRef.current) {
        cancelIk(activeRequestIdRef.current);
      }
      const requestId = `drag-${Date.now()}-${Math.round(Math.random() * 100000)}`;
      activeRequestIdRef.current = requestId;

      try {
        const normalizedTarget = normalizeIkTargetPoseForRobotBase(robot, {
          position: [
            tmpWorldPositionRef.current.x,
            tmpWorldPositionRef.current.y,
            tmpWorldPositionRef.current.z,
          ],
          quaternion: [
            tmpWorldQuaternionRef.current.w,
            tmpWorldQuaternionRef.current.x,
            tmpWorldQuaternionRef.current.y,
            tmpWorldQuaternionRef.current.z,
          ],
        });
        const normalizedTargetQuaternion = new THREE.Quaternion(
          normalizedTarget.quaternion[1],
          normalizedTarget.quaternion[2],
          normalizedTarget.quaternion[3],
          normalizedTarget.quaternion[0]
        );
        const orientationPayload = buildIkOrientationPayload(normalizedTargetQuaternion);

        const result = await solveIkRequest({
          requestId,
          apiBaseUrl: API_BASE_URL,
          urdf: urdfContent,
          jointValues: filterJointValuesToActiveArmChain(latestJointValuesRef.current),
          targetLink: endEffectorLink,
          targetPosition: normalizedTarget.position,
          orientation: orientationPayload ?? null,
          orientationMode,
          timeoutMs: dragTimeoutMs,
          solverChain: [selectedSolverId],
        });

        if (activeRequestIdRef.current !== requestId) {
          return;
        }
        if (isStaleSession()) {
          activeRequestIdRef.current = null;
          return;
        }
        activeRequestIdRef.current = null;

        if (isIkFailure(result)) {
          if (result.status === "cancelled" || /abort/i.test(result.error || "")) {
            // Drag path cancels stale requests intentionally; do not surface as errors.
            return;
          }
          const lastError = result.error || "IK solve failed";
          if (lastIkErrorRef.current !== lastError) {
            lastIkErrorRef.current = lastError;
            console.warn("[IK] Drag handle solve failed:", lastError);
            toast.error(lastError);
          }
          setIkDebugState({
            status: "error",
            error: lastError,
            durationMs: performance.now() - start,
            diagnostics: null,
          });
          return;
        }

        if (!result.result?.solution) {
          const lastError = "IK solve returned no solution";
          if (lastIkErrorRef.current !== lastError) {
            lastIkErrorRef.current = lastError;
            console.warn("[IK] Drag handle solve failed:", lastError);
            toast.error(lastError);
          }
          setIkDebugState({
            status: "error",
            error: lastError,
            durationMs: performance.now() - start,
            diagnostics: null,
          });
          return;
        }

        if (isDragSolveResultStale(schedulerRef.current, ticketSequenceId)) {
          return;
        }

        const processed = processIkSolutionForApply(result.result.solution);

        if (isDragSolveResultStale(schedulerRef.current, ticketSequenceId)) {
          return;
        }

        onIkSolved(processed, endEffectorLink);
        markDragSolveComplete(schedulerRef.current, ticketSequenceId);
        setIkDebugState({
          status: "success",
          error: null,
          durationMs: performance.now() - start,
          diagnostics: result.result.diagnostics ?? null,
        });
        lastSolvedTargetRef.current = {
          position: tmpWorldPositionRef.current.clone(),
          quaternion: tmpWorldQuaternionRef.current.clone(),
        };
        lastIkErrorRef.current = null;
      } catch (error: unknown) {
        if (activeRequestIdRef.current === requestId) {
          activeRequestIdRef.current = null;
        }
        if (isStaleSession()) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error ?? "");
        if (/abort/i.test(message)) {
          // Abort is expected when a newer drag target supersedes the request.
          return;
        }
        console.error("[IK] Solve error:", error);
        toast.error("IK solve failed. Is the IK server running?");
        setIkDebugState({
          status: "error",
          error: error instanceof Error ? error.message : "IK solve failed",
          durationMs: null,
          diagnostics: null,
        });
      } finally {
        markDragSolveComplete(schedulerRef.current, ticketSequenceId);
        if (inFlightSequenceIdRef.current === ticketSequenceId) {
          inFlightSequenceIdRef.current = null;
        }
      }
    },
    [
      nativeEnabled,
      nativeConnected,
      nativeModelReady,
      sendNativeTargetLatest,
      dragOrientation,
      dragTimeoutMs,
      endEffectorLink,
      urdfContent,
      nativeTargetLink,
      onIkSolved,
      processIkSolutionForApply,
      filterJointValuesToActiveArmChain,
      robot,
      selectedSolverId,
      setIkDebugState,
      debugTargetName,
    ]
  );

  const updateDragTarget = useCallback(
    (clientX: number, clientY: number, applyOffset: boolean = true) => {
      if (!targetMeshRef.current) return false;

      refreshRobotFrameCache(runtimeCacheRef.current, robot);
      const rect = gl.domElement.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(
        new THREE.Vector2(x, y),
        dragReferenceCameraRef.current ?? camera
      );

      if (!raycaster.ray.intersectPlane(dragPlaneRef.current, intersectionRef.current)) {
        return false;
      }

      if (!applyOffset) {
        return true;
      }

      intersectionRef.current.add(dragOffsetRef.current);
      let clamped = false;
      const reachRadius = runtimeCacheRef.current.reachRadius;
      if (reachRadius && robot) {
        const baseLinkName = runtimeCacheRef.current.baseLinkName;
        const baseObject =
          (baseLinkName &&
            (robot.links?.[baseLinkName] ??
              robot.getObjectByName?.(baseLinkName))) ||
          robot;
        if (baseObject?.updateMatrixWorld && baseObject?.getWorldPosition) {
          const basePosition = new THREE.Vector3();
          const clampDirection = new THREE.Vector3();
          baseObject.updateMatrixWorld(true);
          baseObject.getWorldPosition(basePosition);
          clampDirection.copy(intersectionRef.current).sub(basePosition);
          const distance = clampDirection.length();
          if (
            distance >
              reachRadius + IK_ARM_REACH_CONFIG.clampEpsilonMeters &&
            distance > IK_ARM_REACH_CONFIG.clampEpsilonMeters
          ) {
            clampDirection.setLength(reachRadius);
            intersectionRef.current.copy(basePosition).add(clampDirection);
            clamped = true;
          }
        }
      }

      if (clampedRef.current !== clamped) {
        clampedRef.current = clamped;
        setIsClamped(clamped);
      }
      desiredTargetRef.current.copy(intersectionRef.current);
      hasDesiredTargetRef.current = true;
      worldToRobotPosition(
        runtimeCacheRef.current,
        intersectionRef.current,
        desiredTargetLocalRef.current
      );
      hasDesiredTargetLocalRef.current = true;
      return true;
    },
    [camera, gl, raycaster, robot]
  );

  const endDrag = useCallback(
    (pointerId?: number) => {
      if (pointerId !== undefined && activePointerIdRef.current !== null) {
        if (pointerId !== activePointerIdRef.current) return;
      }

      if (pointerId !== undefined) {
        const domElement = gl.domElement as Element & {
          releasePointerCapture?: (id: number) => void;
        };
        if (domElement?.releasePointerCapture) {
          try {
            domElement.releasePointerCapture(pointerId);
          } catch {
            // Ignore release failures for browsers that reject stale captures.
          }
        }
      }

      activePointerIdRef.current = null;
      dragReferenceCameraRef.current = null;
      dragSessionRef.current += 1;
      setIsDragging(false);
      onDragStateChange?.(false);
      if (activeRequestIdRef.current) {
        cancelIk(activeRequestIdRef.current);
        activeRequestIdRef.current = null;
      }
      pendingTargetLocalRef.current = null;
      schedulerRef.current.latestPendingTicket = null;
      schedulerRef.current.inFlightSequenceId = null;
      inFlightSequenceIdRef.current = null;
      isSolvingRef.current = false;
      hasDesiredTargetRef.current = false;
      hasDesiredTargetLocalRef.current = false;
      lastSubmittedTargetRef.current = null;
      if (clampedRef.current) {
        clampedRef.current = false;
        setIsClamped(false);
      }
    },
    [gl, onDragStateChange]
  );

  // Pointer event handlers for direct dragging
  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!enabled || !targetMeshRef.current) {
        return;
      }

      event.stopPropagation();
      dragSessionRef.current += 1;
      activePointerIdRef.current = event.pointerId;
      isSolvingRef.current = false;
      lastNativeAppliedSequenceRef.current =
        nativeIkRuntime.lastTelemetry?.sequence_applied ?? -1;
      if (activeRequestIdRef.current) {
        cancelIk(activeRequestIdRef.current);
        activeRequestIdRef.current = null;
      }
      const domElement = gl.domElement as Element & {
        setPointerCapture?: (id: number) => void;
      };
      if (domElement?.setPointerCapture) {
        try {
          domElement.setPointerCapture(event.pointerId);
        } catch {
          // Ignore capture failures; we'll still listen globally.
        }
      }

      setIsDragging(true);
      onDragStateChange?.(true);
      dragReferenceCameraRef.current = cloneIkDragReferenceCamera(camera);

      // Create a drag plane perpendicular to the camera view
      const cameraDirection = new THREE.Vector3();
      dragReferenceCameraRef.current.getWorldDirection(cameraDirection);
      dragPlaneRef.current.setFromNormalAndCoplanarPoint(
        cameraDirection,
        targetMeshRef.current.position
      );

      const hasIntersection = updateDragTarget(event.clientX, event.clientY, false);
      if (!hasIntersection) {
        return;
      }
      dragOffsetRef.current.subVectors(
        targetMeshRef.current.position,
        intersectionRef.current
      );
    },
    [
      enabled,
      camera,
      gl,
      nativeIkRuntime.lastTelemetry,
      onDragStateChange,
      updateDragTarget,
    ]
  );

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!isDragging || !targetMeshRef.current) return;

      event.stopPropagation();
      updateDragTarget(event.clientX, event.clientY);
    },
    [isDragging, updateDragTarget]
  );

  const handlePointerUp = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!isDragging) return;

      event.stopPropagation();
      endDrag(event.pointerId);
    },
    [isDragging, endDrag]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (
        activePointerIdRef.current !== null &&
        event.pointerId !== activePointerIdRef.current
      ) {
        return;
      }
      updateDragTarget(event.clientX, event.clientY);
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
      endDrag(event.pointerId);
    };

    const handleWindowPointerCancel = (event: PointerEvent) => {
      endDrag(event.pointerId);
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
    };
  }, [isDragging, endDrag, updateDragTarget]);

  // Use frame loop to throttle IK calls during dragging
  useFrame(() => {
    if (!targetMeshRef.current) return;
    refreshRobotFrameCache(runtimeCacheRef.current, robot);
    if (!isDragging) {
      if (enabled && hasEndEffector) {
        syncTargetToEndEffector();
      }
      return;
    }

    if (hasDesiredTargetLocalRef.current) {
      robotToWorldPosition(
        runtimeCacheRef.current,
        desiredTargetLocalRef.current,
        desiredTargetRef.current
      );
      hasDesiredTargetRef.current = true;
    }

    if (hasDesiredTargetRef.current) {
      const currentPosition = targetMeshRef.current.position;
      syncVisibleIkDragHandlePosition({
        currentPosition,
        desiredTargetWorld: desiredTargetRef.current,
      });

      const lastSubmitted = lastSubmittedTargetRef.current;
      const distanceSinceLast =
        lastSubmitted ? lastSubmitted.distanceTo(currentPosition) : Number.POSITIVE_INFINITY;
      if (distanceSinceLast >= minSolveDistance) {
        tmpSolveTargetWorldRef.current.copy(currentPosition);
        if (hasHandleAnchorOffsetRef.current) {
          tmpAnchorOffsetWorldRef.current
            .copy(handleAnchorLocalOffsetRef.current)
            .applyQuaternion(targetMeshRef.current.quaternion);
          tmpSolveTargetWorldRef.current.sub(tmpAnchorOffsetWorldRef.current);
        }
        const localPosition = worldToRobotPosition(
          runtimeCacheRef.current,
          tmpSolveTargetWorldRef.current,
          new THREE.Vector3()
        );
        const localQuaternion = worldToRobotQuaternion(
          runtimeCacheRef.current,
          targetMeshRef.current.quaternion,
          tmpLocalQuaternionRef.current
        ).clone();
        const localTarget = {
          position: localPosition.clone(),
          quaternion: localQuaternion,
        };
        pendingTargetLocalRef.current = localTarget;
        enqueueLatestDragTarget(
          schedulerRef.current,
          localTarget,
          typeof performance !== "undefined" ? performance.now() : Date.now()
        );
        if (!lastSubmittedTargetRef.current) {
          lastSubmittedTargetRef.current = new THREE.Vector3();
        }
        lastSubmittedTargetRef.current.copy(currentPosition);

        const now = performance.now();
        if (now - lastDebugUpdateRef.current > 50) {
          lastDebugUpdateRef.current = now;
          setIkDebugState({
            lastTargetPosition: [currentPosition.x, currentPosition.y, currentPosition.z],
            lastTargetQuaternion: [
              targetMeshRef.current.quaternion.w,
              targetMeshRef.current.quaternion.x,
              targetMeshRef.current.quaternion.y,
              targetMeshRef.current.quaternion.z,
            ],
          });
        }
      }
    }

    const now = performance.now();
    if (isSolvingRef.current || now - lastIkCallRef.current < effectiveIkThrottleMs) return;
    const nextTicket = popNextDragSolveTicket(schedulerRef.current, now);
    if (!nextTicket) return;
    const solveSessionId = dragSessionRef.current;
    isSolvingRef.current = true;
    inFlightSequenceIdRef.current = nextTicket.sequenceId;
    lastIkCallRef.current = now;
    runIkSolve(
      nextTicket.targetLocal.position.clone(),
      nextTicket.targetLocal.quaternion.clone(),
      nextTicket.sequenceId,
      solveSessionId
    )
      .catch(() => {
        /* errors handled inside solveIk */
      })
      .finally(() => {
        if (solveSessionId === dragSessionRef.current) {
          isSolvingRef.current = false;
        }
      });
  });

  // Cleanup outstanding IK requests on unmount
  useEffect(() => {
    return () => {
      if (activeRequestIdRef.current) {
        cancelIk(activeRequestIdRef.current);
      }
    };
  }, []);

  // If controls become disabled, ensure dragging flag is cleared
  useEffect(() => {
    if (!enabled) {
      if (activePointerIdRef.current !== null) {
        endDrag(activePointerIdRef.current);
      } else {
        setIsDragging(false);
        onDragStateChange?.(false);
      }
      setIsHovered(false);
      setIkDebugState({ targetName: null });
    }
  }, [enabled, endDrag, onDragStateChange, setIkDebugState]);

  if (!enabled || !hasEndEffector) {
    return null;
  }

  return (
    <mesh
      ref={targetMeshRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      renderOrder={999}
    >
      <sphereGeometry args={[dragHandleRadiusMeters]} />
      <meshBasicMaterial
        color={dragHandleColor}
        transparent
        opacity={dragHandleOpacity}
        depthTest={false}
      />
      {handleCount > 1 && (
        <Html
          position={[0, 0.065, 0]}
          center
          style={{ pointerEvents: "none" }}
        >
          <div className="rounded border border-border/70 bg-background/95 px-1 py-[1px] font-mono text-[9px] font-semibold leading-none text-foreground shadow-sm">
            {handleIndex + 1}
          </div>
        </Html>
      )}
    </mesh>
  );
};
