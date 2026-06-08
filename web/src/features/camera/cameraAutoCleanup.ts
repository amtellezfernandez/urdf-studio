import type { Camera } from "@/shared/types/camera";
import { FALLBACK_DEMO_CAMERA_NAME_SET } from "./cameraAutoGenerationParams";

type CameraPartitionResult = {
  retainedCameras: Camera[];
  cameraIdsToRemove: string[];
};

export const partitionFallbackDemoCameras = (cameras: Camera[]): CameraPartitionResult => {
  const retainedCameras: Camera[] = [];
  const cameraIdsToRemove: string[] = [];

  cameras.forEach((camera) => {
    if (FALLBACK_DEMO_CAMERA_NAME_SET.has(camera.name)) {
      cameraIdsToRemove.push(camera.id);
      return;
    }
    retainedCameras.push(camera);
  });

  return { retainedCameras, cameraIdsToRemove };
};
