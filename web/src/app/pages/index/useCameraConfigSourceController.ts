import { useCallback, useState, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";

import { parseCameraConfig } from "@/features/camera";
import type { CameraConfig } from "@/shared/types/camera";
import {
  addRecentValue,
  CORE_FOLDER_UPLOAD_SCREEN_PARAMS,
  deriveSourceLabel,
  fileListToArray,
  readStoredJsonArray,
  readStoredString,
  removeRecentValue,
  writeStoredString,
} from "@/app/pages/index/coreFolderUploadScreenState";

type UseCameraConfigSourceControllerParams = {
  fetchImplementation?: typeof fetch;
  loadCameras: (cameraConfig: CameraConfig) => void;
};

export const useCameraConfigSourceController = ({
  fetchImplementation = fetch,
  loadCameras,
}: UseCameraConfigSourceControllerParams) => {
  const [cameraConfigUrl, setCameraConfigUrl] = useState("");
  const [cameraSourceDropActive, setCameraSourceDropActive] = useState(false);
  const [isLoadingCameraConfig, setIsLoadingCameraConfig] = useState(false);
  const [lastLocalCameraConfig, setLastLocalCameraConfig] = useState<string | null>(() =>
    readStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalCameraConfigStorageKey)
  );
  const [recentCameraConfigs, setRecentCameraConfigs] = useState<string[]>(() =>
    readStoredJsonArray(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentCameraConfigsStorageKey)
  );

  const applyCameraConfig = useCallback(
    (cameraConfig: CameraConfig, sourceLabel: string): void => {
      loadCameras(cameraConfig);
      toast.success(`Loaded ${cameraConfig.cameras.length} camera(s) from ${sourceLabel}.`);
    },
    [loadCameras]
  );

  const loadCameraConfigFromUrl = useCallback(
    async (inputUrl: string): Promise<void> => {
      const normalizedUrl = inputUrl.trim();
      if (!normalizedUrl) {
        toast.error("Please enter a camera config URL.");
        return;
      }
      setIsLoadingCameraConfig(true);
      try {
        const response = await fetchImplementation(normalizedUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch camera config (${response.status}).`);
        }
        const content = await response.text();
        const filename = deriveSourceLabel(normalizedUrl, "camera-config.json");
        applyCameraConfig(parseCameraConfig(content, filename), normalizedUrl);
        setRecentCameraConfigs(
          addRecentValue(
            CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentCameraConfigsStorageKey,
            normalizedUrl
          )
        );
        setCameraConfigUrl(normalizedUrl);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to import camera configuration.";
        toast.error(message);
      } finally {
        setIsLoadingCameraConfig(false);
      }
    },
    [applyCameraConfig, fetchImplementation]
  );

  const processCameraConfigFile = useCallback(
    async (file: File): Promise<void> => {
      setIsLoadingCameraConfig(true);
      try {
        const content = await file.text();
        applyCameraConfig(parseCameraConfig(content, file.name), file.name);
        setLastLocalCameraConfig(file.name);
        writeStoredString(
          CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalCameraConfigStorageKey,
          file.name
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to import camera configuration.";
        toast.error(message);
      } finally {
        setIsLoadingCameraConfig(false);
      }
    },
    [applyCameraConfig]
  );

  const handleCameraConfigFileSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const file = event.currentTarget.files?.[0];
      if (file) void processCameraConfigFile(file);
      event.currentTarget.value = "";
    },
    [processCameraConfigFile]
  );

  const handleCameraSourceDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      setCameraSourceDropActive(false);
      const file = fileListToArray(event.dataTransfer.files)[0];
      if (!file) {
        toast.error("No local file was dropped.");
        return;
      }
      void processCameraConfigFile(file);
    },
    [processCameraConfigFile]
  );

  const clearLastLocalCameraConfig = useCallback(() => {
    setLastLocalCameraConfig(null);
    writeStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalCameraConfigStorageKey, null);
  }, []);

  const removeRecentCameraConfig = useCallback((url: string): void => {
    setRecentCameraConfigs(
      removeRecentValue(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentCameraConfigsStorageKey, url)
    );
  }, []);

  return {
    cameraConfigUrl,
    cameraSourceDropActive,
    clearLastLocalCameraConfig,
    handleCameraConfigFileSelect,
    handleCameraSourceDrop,
    isLoadingCameraConfig,
    lastLocalCameraConfig,
    loadCameraConfigFromUrl,
    processCameraConfigFile,
    recentCameraConfigs,
    removeRecentCameraConfig,
    setCameraConfigUrl,
    setCameraSourceDropActive,
  };
};
