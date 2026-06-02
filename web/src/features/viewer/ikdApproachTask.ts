import * as THREE from "three";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { IKD_BASE_URL, IKD_RUNTIME_CONFIG } from "@/shared/config/runtime";
import type { CreatedObject } from "@/features/objects";
import type { IkOrbitDefaults } from "@/features/viewer/objectTargeting";
import { createLockedIkObjectSolveTask } from "@/features/viewer/ikObjectSolveTask";
import {
  IKD_APPROACH_SCHEMA_VERSION,
  type IkdApproachObjectType,
  type IkdApproachSceneObject,
  type IkdApproachTargetMode,
  type IkdApproachTaskEvent,
  type IkdApproachTaskSnapshot,
} from "@/features/viewer/ikdApproachTaskTypes";
import { useIkdApproachTaskStore } from "@/features/viewer/useIkdApproachTaskStore";

type IkdStartApproachTaskAck = {
  accepted: boolean;
  task: IkdApproachTaskSnapshot;
};

type IkdCancelApproachTaskAck = {
  accepted: boolean;
  task_id: number;
};

export type LockedIkdApproachTask = {
  taskId: number;
  lockedObject: CreatedObject;
  objectTargetPositionWorld: [number, number, number];
  isOrbitTarget: boolean;
};

const toLocalLockedApproachTask = (
  localTask: ReturnType<typeof createLockedIkObjectSolveTask>
): LockedIkdApproachTask => ({
  taskId: 0,
  lockedObject: localTask.object,
  objectTargetPositionWorld: localTask.objectTargetPositionWorld,
  isOrbitTarget: localTask.isOrbitTarget,
});

const toVector3Tuple = (value: THREE.Vector3): [number, number, number] => [
  value.x,
  value.y,
  value.z,
];

const toEulerTuple = (value: THREE.Euler | undefined): [number, number, number] | undefined =>
  value ? [value.x, value.y, value.z] : undefined;

const toSceneObject = (object: CreatedObject): IkdApproachSceneObject => ({
  id: object.id,
  object_type: object.type as IkdApproachObjectType,
  position_xyz_m: toVector3Tuple(object.position),
  rotation_rpy_rad: toEulerTuple(object.rotation),
  size_xyz_m: toVector3Tuple(object.size),
  is_hidden: object.isHidden === true,
  orbit_radius_m: object.orbitRadius,
  orbit_inclination_deg: object.orbitInclination,
  orbit_phase_deg: object.orbitPhase,
  orbit_secondary_offset_deg: object.orbitSecondaryOffset,
});

const toTargetMode = (object: CreatedObject): IkdApproachTargetMode =>
  object.ikTargetType !== "orbit"
    ? "punctual"
    : object.orbitTargetPoint === "secondary"
      ? "orbit_secondary"
      : object.orbitTargetPoint === "center"
        ? "orbit_center"
        : "orbit_primary";

const toLockedCreatedObject = (object: IkdApproachSceneObject): CreatedObject => ({
  id: object.id,
  type: object.object_type,
  position: new THREE.Vector3(
    object.position_xyz_m[0],
    object.position_xyz_m[1],
    object.position_xyz_m[2]
  ),
  rotation: object.rotation_rpy_rad
    ? new THREE.Euler(
        object.rotation_rpy_rad[0],
        object.rotation_rpy_rad[1],
        object.rotation_rpy_rad[2],
        "XYZ"
      )
    : new THREE.Euler(0, 0, 0, "XYZ"),
  size: new THREE.Vector3(object.size_xyz_m[0], object.size_xyz_m[1], object.size_xyz_m[2]),
  color: "#ffffff",
  isHidden: object.is_hidden,
  trackedJointName: null,
  isIkTarget: true,
  ikTargetType: toTargetModeFromTaskMode(object, "punctual"),
});

const toTargetModeFromTaskMode = (
  _object: IkdApproachSceneObject,
  taskMode: IkdApproachTargetMode
): CreatedObject["ikTargetType"] =>
  taskMode === "punctual" ? "punctual" : "orbit";

export const lockIkdApproachTask = async ({
  object,
  objects,
  orbitDefaults,
}: {
  object: CreatedObject;
  objects: CreatedObject[];
  orbitDefaults: IkOrbitDefaults;
}): Promise<LockedIkdApproachTask> => {
  const localTask = createLockedIkObjectSolveTask({
    object,
    orbitDefaults,
  });

  if (!IKD_RUNTIME_CONFIG.enabled) {
    return toLocalLockedApproachTask(localTask);
  }

  try {
    const sceneRevision = Date.now();
    await publishIkdApproachScene({
      sceneRevision,
      objects,
    });
    const startResponse = await guardedFetch(`${IKD_BASE_URL}/approach/task/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schema_version: IKD_APPROACH_SCHEMA_VERSION,
        scene_revision: sceneRevision,
        object_id: object.id,
        target_mode: toTargetMode(object),
      }),
    }, {
      requiredBackends: ["ikd"],
      context: "IKD approach task start",
    });
    if (!startResponse.ok) {
      return toLocalLockedApproachTask(localTask);
    }
    const ack = (await startResponse.json()) as IkdStartApproachTaskAck;
    useIkdApproachTaskStore.getState().applyEvent(toTaskStartedEvent(ack.task));
    return {
      taskId: ack.task.task_id,
      lockedObject: {
        ...toLockedCreatedObject(ack.task.object),
        ikTargetType: toTargetModeFromTaskMode(ack.task.object, ack.task.target_mode),
        orbitTargetPoint:
          ack.task.target_mode === "orbit_secondary"
            ? "secondary"
            : ack.task.target_mode === "orbit_center"
              ? "center"
              : ack.task.target_mode === "orbit_primary"
                ? "primary"
                : undefined,
      },
      objectTargetPositionWorld: ack.task.object_target_position_xyz_m,
      isOrbitTarget: ack.task.target_mode !== "punctual",
    };
  } catch {
    return toLocalLockedApproachTask(localTask);
  }
};

export const cancelIkdApproachTask = async (taskId: number): Promise<boolean> => {
  if (!IKD_RUNTIME_CONFIG.enabled || taskId <= 0) {
    return false;
  }

  try {
    const response = await guardedFetch(`${IKD_BASE_URL}/approach/task/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schema_version: IKD_APPROACH_SCHEMA_VERSION,
        task_id: taskId,
      }),
    }, {
      requiredBackends: ["ikd"],
      context: "IKD approach task cancel",
    });
    if (!response.ok) {
      return false;
    }
    const ack = (await response.json()) as IkdCancelApproachTaskAck;
    return ack.accepted === true && ack.task_id === taskId;
  } catch {
    return false;
  }
};

const publishIkdApproachScene = async ({
  sceneRevision,
  objects,
}: {
  sceneRevision: number;
  objects: CreatedObject[];
}) => {
  const response = await guardedFetch(`${IKD_BASE_URL}/approach/scene`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schema_version: IKD_APPROACH_SCHEMA_VERSION,
      scene_revision: sceneRevision,
      objects: objects.map(toSceneObject),
    }),
  }, {
    requiredBackends: ["ikd"],
    context: "IKD approach scene publish",
  });
  if (!response.ok) {
    throw new Error("IKD approach scene publish failed");
  }
};

const toTaskStartedEvent = (task: IkdApproachTaskSnapshot): IkdApproachTaskEvent => ({
  schema_version: IKD_APPROACH_SCHEMA_VERSION,
  event_kind: "task_started",
  scene_revision: task.scene_revision,
  object_count: null,
  task,
  emitted_at_ts_ns: task.updated_at_ts_ns,
});
