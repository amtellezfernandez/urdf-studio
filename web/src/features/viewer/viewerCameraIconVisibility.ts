import type { Camera as RobotCamera } from "@/shared/types/camera";

const RUNTIME_HIDDEN_CAMERA_PATTERN = /(wrist|gripper|hand|tool|end[_-]?effector|ee)/i;

export const shouldHideCameraInReadOnlyRuntime = (camera: RobotCamera) => {
  const name = `${camera.name} ${camera.parent_joint}`.toLowerCase();
  return RUNTIME_HIDDEN_CAMERA_PATTERN.test(name);
};

export const buildVisibleViewerCameraConfigs = (
  cameras: readonly RobotCamera[],
  hiddenCameraIds: ReadonlySet<string>,
  readOnlyMode: boolean
): RobotCamera[] => {
  const cameraConfigsByKey = new Map<string, RobotCamera>();

  for (const camera of cameras) {
    if (hiddenCameraIds.has(camera.id)) {
      continue;
    }
    const duplicateCamera = cameraConfigsByKey.get(camera.id) ?? cameraConfigsByKey.get(camera.name);
    if (duplicateCamera) {
      continue;
    }
    cameraConfigsByKey.set(camera.id, camera);
    cameraConfigsByKey.set(camera.name, camera);
  }

  const visibleCameras = [...new Set(cameraConfigsByKey.values())];
  return readOnlyMode
    ? visibleCameras.filter((camera) => !shouldHideCameraInReadOnlyRuntime(camera))
    : visibleCameras;
};

export const filterVisibleCameraIconConfigs = (
  cameras: readonly RobotCamera[],
  hiddenCameraIds: ReadonlySet<string>,
): RobotCamera[] => {
  if (hiddenCameraIds.size === 0) {
    return [...cameras];
  }
  return cameras.filter((camera) => !hiddenCameraIds.has(camera.id));
};
