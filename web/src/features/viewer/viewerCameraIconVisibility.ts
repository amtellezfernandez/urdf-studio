import type { Camera as RobotCamera } from "@/shared/types/camera";

export const filterVisibleCameraIconConfigs = (
  cameras: readonly RobotCamera[],
  hiddenCameraIds: ReadonlySet<string>,
): RobotCamera[] => {
  if (hiddenCameraIds.size === 0) {
    return [...cameras];
  }
  return cameras.filter((camera) => !hiddenCameraIds.has(camera.id));
};
