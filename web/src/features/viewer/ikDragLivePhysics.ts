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
import { buildMjlabRolloutObjectPoseMap } from "@/features/teleop/recording/operatorTeleopMjlabRolloutPlayback";
import { applyPlaybackObjectPoses } from "@/features/viewer/playback/objectPoseTracks";

export type IkDragLivePhysicsTargetPose = {
  endEffectorLink: string;
  positionXyz: [number, number, number];
  quatWxyz: [number, number, number, number];
  timestampMs: number;
};

export const IK_DRAG_LIVE_PHYSICS_FRAME_MAP = "studio-y-up-to-z-up";
export const IK_DRAG_LIVE_PHYSICS_STEP_MS = 5;
export const IK_DRAG_LIVE_PHYSICS_THROTTLE_MS = 25;
export const IK_DRAG_LIVE_PHYSICS_START_GRIPPER_OPENING_M = 0.09;
export const IK_DRAG_LIVE_PHYSICS_GRIPPER_OPENING_M = 0.035;

const LIVE_PHYSICS_OBJECT_TYPES = new Set<CreatedObject["type"]>([
  "cube",
  "sphere",
  "cylinder",
]);

const toFinite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const toVectorTuple = (value: THREE.Vector3): [number, number, number] => [
  toFinite(value.x, 0),
  toFinite(value.y, 0),
  toFinite(value.z, 0),
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

export const buildIkDragLivePhysicsWorldLayout = (
  objects: readonly CreatedObject[],
  name = "ik-drag-live-physics"
): Record<string, unknown> | null => {
  const liveObjects = objects
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

  if (liveObjects.length === 0) {
    return null;
  }

  return {
    world_layout: {
      name,
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
  gripperOpeningM,
});

export const applyIkDragLivePhysicsFrame = (
  frame: OperatorTeleopMjlabRolloutFrame,
  frameMap: OperatorTeleopMjlabRolloutResult["frameMap"]
): void => {
  applyPlaybackObjectPoses(buildMjlabRolloutObjectPoseMap(frame, frameMap));
};

export const useIkDragLivePhysicsBridge = (
  objects: readonly CreatedObject[]
): {
  begin: () => void;
  stop: () => void;
  handleTargetPose: (pose: IkDragLivePhysicsTargetPose) => void;
} => {
  const objectsRef = useRef(objects);
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
  const activeRef = useRef(false);
  const generationRef = useRef(0);
  const lastErrorToastRef = useRef(0);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  const notifyError = useCallback((error: unknown) => {
    console.warn("[MJLab] Live IK drag physics unavailable:", error);
    const now = performance.now();
    if (now - lastErrorToastRef.current < 5_000) {
      return;
    }
    lastErrorToastRef.current = now;
    toast.error("MJLab live physics did not start for this IK drag.");
  }, []);

  const begin = useCallback(() => {
    activeRef.current = true;
    generationRef.current += 1;
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
      const worldLayout = buildIkDragLivePhysicsWorldLayout(objectsRef.current);
      if (!worldLayout) {
        return;
      }
      const startPromise = startTeleopMjlabLiveSession({
        worldLayout,
        initialEndEffectorSample: buildIkDragLivePhysicsSample(
          pose,
          0,
          IK_DRAG_LIVE_PHYSICS_START_GRIPPER_OPENING_M
        ),
        frameMap: IK_DRAG_LIVE_PHYSICS_FRAME_MAP,
        includeMjcf: false,
        acceleratedDrive: true,
        stepMs: IK_DRAG_LIVE_PHYSICS_STEP_MS,
      })
        .then((result) => {
          if (!result.success || !result.sessionId) {
            throw new Error(
              result.issues[0]?.reason ||
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
            pendingPose: null,
          };
          if (result.frame) {
            applyIkDragLivePhysicsFrame(result.frame, result.frameMap);
          }
        })
        .catch((error) => {
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
          result.issues[0]?.reason || "MJLab live physics step failed."
        );
      }
      if (generationRef.current !== generation || sessionRef.current !== session) {
        return;
      }
      session.sampleIndex = nextSampleIndex;
      session.lastStepAtMs = performance.now();
      if (result.frame) {
        applyIkDragLivePhysicsFrame(result.frame, session.frameMap);
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
