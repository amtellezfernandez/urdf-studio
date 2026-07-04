import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";

import {
  buildWorldLayoutFolderAssetMap,
  splitWorldLayoutFolderFiles,
} from "@/app/pages/index/worldLayoutFolderImport";
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
import type { SourceEntryActions } from "@/app/pages/index/sourceEntryTypes";

type UseWorldLayoutSourceControllerParams = {
  onImportWorldLayout: SourceEntryActions["onImportWorldLayout"];
};

export const useWorldLayoutSourceController = ({
  onImportWorldLayout,
}: UseWorldLayoutSourceControllerParams) => {
  const objectUrlsRef = useRef<string[]>([]);
  const [worldLayoutUrl, setWorldLayoutUrl] = useState("");
  const [worldSourceDropActive, setWorldSourceDropActive] = useState(false);
  const [isLoadingWorldLayout, setIsLoadingWorldLayout] = useState(false);
  const [loadedWorldLayoutName, setLoadedWorldLayoutName] = useState<string | null>(null);
  const [lastLocalWorldLayout, setLastLocalWorldLayout] = useState<string | null>(() =>
    readStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalWorldLayoutStorageKey)
  );
  const [recentWorldLayouts, setRecentWorldLayouts] = useState<string[]>(() =>
    readStoredJsonArray(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentWorldLayoutsStorageKey)
  );

  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
      objectUrlsRef.current = [];
    },
    []
  );

  const loadWorldLayoutFromUrl = useCallback(
    async (inputUrl: string): Promise<boolean> => {
      const normalizedUrl = inputUrl.trim();
      if (!normalizedUrl) {
        toast.error("Please enter a world layout link.");
        return false;
      }
      setIsLoadingWorldLayout(true);
      try {
        await onImportWorldLayout(normalizedUrl);
        setRecentWorldLayouts(
          addRecentValue(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentWorldLayoutsStorageKey, normalizedUrl)
        );
        setWorldLayoutUrl(normalizedUrl);
        setLoadedWorldLayoutName(deriveSourceLabel(normalizedUrl, "world-layout.json"));
        toast.success("Loaded world layout.");
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to import world layout.";
        toast.error(message);
        return false;
      } finally {
        setIsLoadingWorldLayout(false);
      }
    },
    [onImportWorldLayout]
  );

  const processWorldLayoutFiles = useCallback(
    async (files: File[]): Promise<void> => {
      const { assetFiles, layoutFile } = splitWorldLayoutFolderFiles(files);
      if (!layoutFile) {
        toast.error("Select a world layout JSON file.");
        return;
      }
      const layoutObjectUrl = URL.createObjectURL(layoutFile);
      objectUrlsRef.current.push(layoutObjectUrl);
      setIsLoadingWorldLayout(true);
      try {
        const assetMapResult = await buildWorldLayoutFolderAssetMap(assetFiles);
        objectUrlsRef.current.push(...assetMapResult.objectUrls);
        await onImportWorldLayout(layoutObjectUrl, {
          meshUriAssetMap: assetMapResult.assetMap,
        });
        setLastLocalWorldLayout(layoutFile.name);
        writeStoredString(
          CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalWorldLayoutStorageKey,
          layoutFile.name
        );
        setLoadedWorldLayoutName(layoutFile.name);
        toast.success(`Loaded world layout from ${layoutFile.name}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to import world layout.";
        toast.error(message);
      } finally {
        setIsLoadingWorldLayout(false);
      }
    },
    [onImportWorldLayout]
  );

  const handleWorldLayoutFileSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const files = fileListToArray(event.currentTarget.files);
      if (files.length > 0) void processWorldLayoutFiles(files);
      event.currentTarget.value = "";
    },
    [processWorldLayoutFiles]
  );

  const handleWorldSourceDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      setWorldSourceDropActive(false);
      const files = fileListToArray(event.dataTransfer.files);
      if (files.length === 0) {
        toast.error("No local file was dropped.");
        return;
      }
      void processWorldLayoutFiles(files);
    },
    [processWorldLayoutFiles]
  );

  const clearLastLocalWorldLayout = useCallback((): void => {
    setLastLocalWorldLayout(null);
    writeStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalWorldLayoutStorageKey, null);
  }, []);

  const removeRecentWorldLayout = useCallback((url: string): void => {
    setRecentWorldLayouts(
      removeRecentValue(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentWorldLayoutsStorageKey, url)
    );
  }, []);

  return {
    clearLastLocalWorldLayout,
    handleWorldLayoutFileSelect,
    handleWorldSourceDrop,
    isLoadingWorldLayout,
    lastLocalWorldLayout,
    loadWorldLayoutFromUrl,
    loadedWorldLayoutName,
    processWorldLayoutFiles,
    recentWorldLayouts,
    removeRecentWorldLayout,
    setWorldLayoutUrl,
    setWorldSourceDropActive,
    worldLayoutUrl,
    worldSourceDropActive,
  };
};
