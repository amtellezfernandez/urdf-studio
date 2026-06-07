import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { toast } from "sonner";

import type { CreatedObject } from "@/features/objects";
import type {
  OperatorTeleopMjlabEndEffectorSample,
  OperatorTeleopMjlabRolloutFrame,
  OperatorTeleopMjlabRolloutResult,
} from "@/features/teleop/recording/operatorTeleopReplayApi";
import {
  startTeleopMjlabLiveSession,
  stepTeleopMjlabLiveSession,
  stopTeleopMjlabLiveSession,
} from "@/features/teleop/recording/operatorTeleopReplayApi";
import {
  buildMjlabRolloutObjectPoseByObjectIdMap,
  buildMjlabRolloutObjectPoseMap,
} from "@/features/teleop/recording/operatorTeleopMjlabRolloutPlayback";
import { applyPlaybackObjectPoses } from "@/features/viewer/playback/objectPoseTracks";
import type { ViewerObjectFramePose } from "@/shared/types/feature";

export type IkDragLivePhysicsTargetPose = {
  endEffectorLink: string;
  positionXyz: [number, number, number];
  quatWxyz: [number, number, number, number];
  timestampMs: number;
  gripperOpeningM?: number;
};

export type IkDragLivePhysicsBodyType = "static" | "dynamic";

export type IkDragLivePhysicsBodyPhysics = {
  bodyType?: IkDragLivePhysicsBodyType;
  massKg?: number;
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
};

export type IkDragLivePhysicsMeshProxy = {
  id: string;
  sourceElementId: string;
  name: string;
  positionXyz: [number, number, number];
  rotationRpyRad: [number, number, number];
  sizeXyz: [number, number, number];
  visualOriginToPhysicsCenterLocalXyz?: [number, number, number];
  color?: string;
  physics?: IkDragLivePhysicsBodyPhysics;
};

export type IkDragLivePhysicsBridgeOptions = {
  objects: readonly CreatedObject[];
  meshProxies?: readonly IkDragLivePhysicsMeshProxy[];
  onMeshProxyPose?: (
    proxy: IkDragLivePhysicsMeshProxy,
    pose: ViewerObjectFramePose
  ) => void;
};

export const IK_DRAG_LIVE_PHYSICS_FRAME_MAP = "identity";
export const IK_DRAG_LIVE_PHYSICS_STEP_MS = 5;
export const IK_DRAG_LIVE_PHYSICS_THROTTLE_MS = 25;
export const IK_DRAG_LIVE_PHYSICS_START_GRIPPER_OPENING_M = 0.09;
export const IK_DRAG_LIVE_PHYSICS_GRIPPER_OPENING_M = 0.035;
export const IK_DRAG_LIVE_PHYSICS_SCENE_READY_RETRY_MS = 75;
export const IK_DRAG_LIVE_PHYSICS_SCENE_READY_WAIT_MS = 1_500;
export const IK_DRAG_LIVE_PHYSICS_START_FAILURE_COOLDOWN_MS = 2_500;
export const IK_DRAG_LIVE_PHYSICS_ERROR_TOAST_COOLDOWN_MS = 5_000;

const LIVE_PHYSICS_OBJECT_TYPES = new Set<CreatedObject["type"]>([
  "cube",
  "sphere",
  "cylinder",
]);
const EMPTY_MESH_PROXIES: readonly IkDragLivePhysicsMeshProxy[] = [];

const isBridgeOptions = (
  value: readonly CreatedObject[] | IkDragLivePhysicsBridgeOptions
): value is IkDragLivePhysicsBridgeOptions => !Array.isArray(value);

const toFinite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const toVectorTuple = (value: THREE.Vector3): [number, number, number] => [
  toFinite(value.x, 0),
  toFinite(value.y, 0),
  toFinite(value.z, 0),
];

const toFiniteTuple = (
  value: [number, number, number],
  fallback: [number, number, number]
): [number, number, number] => [
  toFinite(value[0], fallback[0]),
  toFinite(value[1], fallback[1]),
  toFinite(value[2], fallback[2]),
];

const toRotationTuple = (
  rotation: THREE.Euler | undefined
): [number, number, number] => {
  const normalized = rotation ?? new THREE.Euler(0, 0, 0, "XYZ");
  return [
    toFinite(normalized.x, 0),
    toFinite(normalized.y, 0),
    toFinite(normalized.z, 0),
  ];
};

const resolveDynamicMassKg = (object: CreatedObject): number => {
  const volumeM3 = Math.max(
    object.size.x * object.size.y * object.size.z,
    1e-5
  );
  return Math.max(0.04, Math.min(0.8, volumeM3 * 80));
};

const resolveMeshProxyMassKg = (proxy: IkDragLivePhysicsMeshProxy): number => {
  if (proxy.physics?.massKg !== undefined) {
    return Math.max(0.001, proxy.physics.massKg);
  }
  const volumeM3 = Math.max(
    proxy.sizeXyz[0] * proxy.sizeXyz[1] * proxy.sizeXyz[2],
    1e-5
  );
  return Math.max(0.04, Math.min(8, volumeM3 * 120));
};

const resolveIssueReason = (
  issues: readonly { reason?: unknown }[] | undefined
): string | null => {
  const reason = issues
    ?.map((issue) => (typeof issue.reason === "string" ? issue.reason.trim() : ""))
    .find((candidate) => candidate.length > 0);
  return reason ?? null;
};

export const resolveIkDragLivePhysicsErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  return "MJLab live physics did not start for this IK drag.";
};

const buildMeshProxyWorldLayoutObject = (
  proxy: IkDragLivePhysicsMeshProxy
): Record<string, unknown> | null => {
  const sizeXyz = toFiniteTuple(proxy.sizeXyz, [0.01, 0.01, 0.01]);
  if (sizeXyz.some((component) => component <= 0)) return null;
  const bodyType = proxy.physics?.bodyType ?? "dynamic";
  return {
    id: proxy.id,
    name: proxy.name.trim() || proxy.sourceElementId || proxy.id,
    type: "cube",
    position_xyz: toFiniteTuple(proxy.positionXyz, [0, 0, 0]),
    rotation_rpy_rad: toFiniteTuple(proxy.rotationRpyRad, [0, 0, 0]),
    size_xyz: sizeXyz,
    color: proxy.color ?? "#ef4444",
    physics: {
      body_type: bodyType,
      ...(bodyType === "dynamic"
        ? { mass_kg: resolveMeshProxyMassKg(proxy) }
        : {}),
      friction: proxy.physics?.friction ?? 2.5,
      restitution: proxy.physics?.restitution ?? 0,
      linear_damping: proxy.physics?.linearDamping ?? 0.8,
      angular_damping: proxy.physics?.angularDamping ?? 0.8,
    },
  };
};

export const buildIkDragLivePhysicsWorldLayout = (
  objects: readonly CreatedObject[],
  meshProxiesOrName: readonly IkDragLivePhysicsMeshProxy[] | string = [],
  name = "ik-drag-live-physics"
): Record<string, unknown> | null => {
  const meshProxies =
    typeof meshProxiesOrName === "string" ? [] : meshProxiesOrName;
  const layoutName =
    typeof meshProxiesOrName === "string" ? meshProxiesOrName : name;
  const primitiveObjects = objects
    .filter((object) => object.isHidden !== true)
    .filter((object) => LIVE_PHYSICS_OBJECT_TYPES.has(object.type))
    .map((object) => ({
      id: object.id,
      name: object.label?.trim() || object.id,
      type: object.type,
      position_xyz: toVectorTuple(object.position),
      rotation_rpy_rad: toRotationTuple(object.rotation),
      size_xyz: toVectorTuple(object.size),
      color: object.color,
      physics: {
        body_type: "dynamic",
        mass_kg: resolveDynamicMassKg(object),
        friction: 2.5,
        restitution: 0,
        linear_damping: 0.08,
        angular_damping: 0.08,
      },
    }));
  const meshProxyObjects = meshProxies.flatMap((proxy) => {
    const worldObject = buildMeshProxyWorldLayoutObject(proxy);
    return worldObject ? [worldObject] : [];
  });
  const liveObjects = [...primitiveObjects, ...meshProxyObjects];

  if (
    liveObjects.length === 0 ||
    !liveObjects.some((object) => {
      const physics = object.physics;
      return (
        typeof physics === "object" &&
        physics !== null &&
        (physics as { body_type?: unknown }).body_type === "dynamic"
      );
    })
  ) {
    return null;
  }

  return {
    world_layout: {
      name: layoutName,
      scenario_time_ms: 0,
      scenario_duration_ms: 0,
      objects: liveObjects,
    },
  };
};

export const buildIkDragLivePhysicsSample = (
  pose: IkDragLivePhysicsTargetPose,
  sampleIndex: number,
  gripperOpeningM = IK_DRAG_LIVE_PHYSICS_GRIPPER_OPENING_M
): OperatorTeleopMjlabEndEffectorSample => ({
  sampleIndex,
  timestampMs: Math.max(0, pose.timestampMs),
  positionXyz: pose.positionXyz,
  quatWxyz: pose.quatWxyz,
  gripperOpeningM: Math.max(0, pose.gripperOpeningM ?? gripperOpeningM),
});

export const applyIkDragLivePhysicsFrame = (
  frame: OperatorTeleopMjlabRolloutFrame,
  frameMap: OperatorTeleopMjlabRolloutResult["frameMap"],
  options: {
    meshProxies?: readonly IkDragLivePhysicsMeshProxy[];
    onMeshProxyPose?: (
      proxy: IkDragLivePhysicsMeshProxy,
      pose: ViewerObjectFramePose
    ) => void;
  } = {}
): void => {
  const meshProxyById = new Map(
    (options.meshProxies ?? []).map((proxy) => [proxy.id, proxy])
  );
  const objectStoreFrame =
    meshProxyById.size === 0
      ? frame
      : {
          ...frame,
          objectPoses: frame.objectPoses.filter(
            (pose) => !meshProxyById.has(pose.objectId)
          ),
        };
  applyPlaybackObjectPoses(
    buildMjlabRolloutObjectPoseMap(objectStoreFrame, frameMap)
  );
  if (!options.onMeshProxyPose || meshProxyById.size === 0) {
    return;
  }
  const posesByObjectId = buildMjlabRolloutObjectPoseByObjectIdMap(frame, frameMap);
  Object.entries(posesByObjectId).forEach(([proxyId, pose]) => {
    const proxy = meshProxyById.get(proxyId);
    if (!proxy) return;
    options.onMeshProxyPose?.(proxy, pose);
  });
};

export const useIkDragLivePhysicsBridge = (
  optionsOrObjects: readonly CreatedObject[] | IkDragLivePhysicsBridgeOptions
): {
  begin: () => void;
  stop: () => void;
  handleTargetPose: (pose: IkDragLivePhysicsTargetPose) => void;
} => {
  const hasOptions = isBridgeOptions(optionsOrObjects);
  const objects = hasOptions ? optionsOrObjects.objects : optionsOrObjects;
  const meshProxies = hasOptions
    ? optionsOrObjects.meshProxies ?? EMPTY_MESH_PROXIES
    : EMPTY_MESH_PROXIES;
  const onMeshProxyPose = hasOptions
    ? optionsOrObjects.onMeshProxyPose
    : undefined;
  const objectsRef = useRef(objects);
  const meshProxiesRef = useRef(meshProxies);
  const onMeshProxyPoseRef = useRef(onMeshProxyPose);
  const sessionRef = useRef<{
    sessionId: string;
    frameMap: OperatorTeleopMjlabRolloutResult["frameMap"];
    sampleIndex: number;
    lastStepAtMs: number;
    inFlight: boolean;
    pendingPose: IkDragLivePhysicsTargetPose | null;
  } | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const drainTimerRef = useRef<number | null>(null);
  const startRetryTimerRef = useRef<number | null>(null);
  const pendingStartPoseRef = useRef<IkDragLivePhysicsTargetPose | null>(null);
  const sceneReadyWaitStartedAtMsRef = useRef<number | null>(null);
  const startFailureCooldownUntilMsRef = useRef(0);
  const activeRef = useRef(false);
  const generationRef = useRef(0);
  const lastErrorToastRef = useRef(0);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  useEffect(() => {
    meshProxiesRef.current = meshProxies;
  }, [meshProxies]);

  useEffect(() => {
    onMeshProxyPoseRef.current = onMeshProxyPose;
  }, [onMeshProxyPose]);

  const notifyError = useCallback((error: unknown) => {
    const message = resolveIkDragLivePhysicsErrorMessage(error);
    console.warn("[MJLab] Live IK drag physics unavailable:", message, error);
    const now = performance.now();
    if (now - lastErrorToastRef.current < IK_DRAG_LIVE_PHYSICS_ERROR_TOAST_COOLDOWN_MS) {
      return;
    }
    lastErrorToastRef.current = now;
    toast.error(`MJLab live physics unavailable: ${message}`);
  }, []);

  const begin = useCallback(() => {
    activeRef.current = true;
    generationRef.current += 1;
    pendingStartPoseRef.current = null;
    sceneReadyWaitStartedAtMsRef.current = null;
    if (startRetryTimerRef.current !== null) {
      window.clearTimeout(startRetryTimerRef.current);
      startRetryTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    generationRef.current += 1;
    const session = sessionRef.current;
    sessionRef.current = null;
    startPromiseRef.current = null;
    if (drainTimerRef.current !== null) {
      window.clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    if (startRetryTimerRef.current !== null) {
      window.clearTimeout(startRetryTimerRef.current);
      startRetryTimerRef.current = null;
    }
    pendingStartPoseRef.current = null;
    sceneReadyWaitStartedAtMsRef.current = null;
    if (!session) {
      return;
    }
    void stopTeleopMjlabLiveSession(session.sessionId).catch((error) => {
      console.warn("[MJLab] Failed to stop live IK drag physics session:", error);
    });
  }, []);

  const ensureSession = useCallback(
    async (pose: IkDragLivePhysicsTargetPose) => {
      if (sessionRef.current) {
        return;
      }
      if (startPromiseRef.current) {
        await startPromiseRef.current;
        return;
      }
      const generation = generationRef.current;
      const now = performance.now();
      if (now < startFailureCooldownUntilMsRef.current) {
        return;
      }
      const worldLayout = buildIkDragLivePhysicsWorldLayout(
        objectsRef.current,
        meshProxiesRef.current
      );
      if (!worldLayout) {
        if (sceneReadyWaitStartedAtMsRef.current === null) {
          sceneReadyWaitStartedAtMsRef.current = now;
        }
        if (
          now - sceneReadyWaitStartedAtMsRef.current <
            IK_DRAG_LIVE_PHYSICS_SCENE_READY_WAIT_MS &&
          startRetryTimerRef.current === null
        ) {
          startRetryTimerRef.current = window.setTimeout(() => {
            startRetryTimerRef.current = null;
            const latestPose = pendingStartPoseRef.current;
            if (
              !latestPose ||
              !activeRef.current ||
              generationRef.current !== generation ||
              sessionRef.current ||
              startPromiseRef.current
            ) {
              return;
            }
            void ensureSession(latestPose);
          }, IK_DRAG_LIVE_PHYSICS_SCENE_READY_RETRY_MS);
        }
        return;
      }
      sceneReadyWaitStartedAtMsRef.current = null;
      const startPromise = startTeleopMjlabLiveSession({
        worldLayout,
        initialEndEffectorSample: buildIkDragLivePhysicsSample(
          pose,
          0,
          IK_DRAG_LIVE_PHYSICS_START_GRIPPER_OPENING_M
        ),
        frameMap: IK_DRAG_LIVE_PHYSICS_FRAME_MAP,
        includeMjcf: false,
        stepMs: IK_DRAG_LIVE_PHYSICS_STEP_MS,
      })
        .then((result) => {
          if (!result.success || !result.sessionId) {
            throw new Error(
              resolveIssueReason(result.issues) ||
                "MJLab live physics session failed to start."
            );
          }
          if (!activeRef.current || generationRef.current !== generation) {
            void stopTeleopMjlabLiveSession(result.sessionId);
            return;
          }
          sessionRef.current = {
            sessionId: result.sessionId,
            frameMap: result.frameMap,
            sampleIndex: 0,
            lastStepAtMs: performance.now(),
            inFlight: false,
            pendingPose: pendingStartPoseRef.current,
          };
          pendingStartPoseRef.current = null;
          if (result.frame) {
            applyIkDragLivePhysicsFrame(result.frame, result.frameMap, {
              meshProxies: meshProxiesRef.current,
              onMeshProxyPose: onMeshProxyPoseRef.current,
            });
          }
        })
        .catch((error) => {
          startFailureCooldownUntilMsRef.current =
            performance.now() + IK_DRAG_LIVE_PHYSICS_START_FAILURE_COOLDOWN_MS;
          notifyError(error);
        })
        .finally(() => {
          if (startPromiseRef.current === startPromise) {
            startPromiseRef.current = null;
          }
        });
      startPromiseRef.current = startPromise;
      await startPromise;
    },
    [notifyError]
  );

  const drainStep = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || session.inFlight || !session.pendingPose) {
      return;
    }
    const pose = session.pendingPose;
    const now = performance.now();
    if (now - session.lastStepAtMs < IK_DRAG_LIVE_PHYSICS_THROTTLE_MS) {
      if (drainTimerRef.current === null) {
        const delayMs = Math.max(
          1,
          IK_DRAG_LIVE_PHYSICS_THROTTLE_MS - (now - session.lastStepAtMs)
        );
        drainTimerRef.current = window.setTimeout(() => {
          drainTimerRef.current = null;
          void drainStep();
        }, delayMs);
      }
      return;
    }
    if (drainTimerRef.current !== null) {
      window.clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    session.pendingPose = null;
    session.inFlight = true;
    const nextSampleIndex = session.sampleIndex + 1;
    const generation = generationRef.current;
    try {
      const result = await stepTeleopMjlabLiveSession({
        sessionId: session.sessionId,
        endEffectorSample: buildIkDragLivePhysicsSample(pose, nextSampleIndex),
      });
      if (!result.success) {
        throw new Error(
          resolveIssueReason(result.issues) || "MJLab live physics step failed."
        );
      }
      if (generationRef.current !== generation || sessionRef.current !== session) {
        return;
      }
      session.sampleIndex = nextSampleIndex;
      session.lastStepAtMs = performance.now();
      if (result.frame) {
        applyIkDragLivePhysicsFrame(result.frame, session.frameMap, {
          meshProxies: meshProxiesRef.current,
          onMeshProxyPose: onMeshProxyPoseRef.current,
        });
      }
    } catch (error) {
      notifyError(error);
      if (sessionRef.current === session) {
        sessionRef.current = null;
      }
      void stopTeleopMjlabLiveSession(session.sessionId).catch(() => undefined);
    } finally {
      session.inFlight = false;
      if (sessionRef.current === session && session.pendingPose) {
        void drainStep();
      }
    }
  }, [notifyError]);

  const handleTargetPose = useCallback(
    (pose: IkDragLivePhysicsTargetPose) => {
      if (!activeRef.current) {
        return;
      }
      const session = sessionRef.current;
      if (!session) {
        pendingStartPoseRef.current = pose;
        void ensureSession(pose);
        return;
      }
      session.pendingPose = pose;
      void drainStep();
    },
    [drainStep, ensureSession]
  );

  useEffect(() => stop, [stop]);

  return {
    begin,
    stop,
    handleTargetPose,
  };
};
