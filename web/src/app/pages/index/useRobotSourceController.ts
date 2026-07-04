import { useCallback, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { toast } from "sonner";

import {
  CORE_FOLDER_UPLOAD_SCREEN_PARAMS,
  deriveLocalSourceLabel,
  deriveSourceLabel,
  fileListToArray,
  readStoredString,
  writeStoredString,
} from "@/app/pages/index/coreFolderUploadScreenState";
import type { SourceEntryActions } from "@/app/pages/index/sourceEntryTypes";

type StagedRobotSource = {
  label: string;
  kind: "local" | "github" | "url";
  load: () => Promise<void>;
};

type UseRobotSourceControllerParams = {
  onFolderSelected: SourceEntryActions["onFolderSelected"];
  onGitHubSelected: SourceEntryActions["onGitHubSelected"];
  onUrlSelected: SourceEntryActions["onUrlSelected"];
  shouldPreserveCameras: () => boolean;
};

const isUsableRobotFile = (file: File): boolean =>
  file.size > 0 || /\.(urdf|xacro)$/i.test(file.name);

export const useRobotSourceController = ({
  onFolderSelected,
  onGitHubSelected,
  onUrlSelected,
  shouldPreserveCameras,
}: UseRobotSourceControllerParams) => {
  const stagedRobotRef = useRef<StagedRobotSource | null>(null);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubUrdfPath, setGithubUrdfPath] = useState("");
  const [urlSource, setUrlSource] = useState("");
  const [robotSourceDropActive, setRobotSourceDropActive] = useState(false);
  const [isLoadingGithub, setIsLoadingGithub] = useState(false);
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [loadedRobotName, setLoadedRobotName] = useState<string | null>(null);
  const [stagedRobot, setStagedRobot] = useState<StagedRobotSource | null>(null);
  const [lastLocalFolder, setLastLocalFolder] = useState<string | null>(() =>
    readStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalRobotSourceStorageKey)
  );

  const stageRobot = useCallback((source: StagedRobotSource): void => {
    stagedRobotRef.current = source;
    setStagedRobot(source);
    setLoadedRobotName(null);
    toast.success(`Selected ${source.label} for setup.`);
  }, []);

  const loadRobotFiles = useCallback(
    async (files: File[], label: string): Promise<void> => {
      if (files.length === 0) {
        toast.error("No robot files were selected.");
        return;
      }
      await onFolderSelected(files, { preserveCameras: shouldPreserveCameras() });
      setLoadedRobotName(label);
    },
    [onFolderSelected, shouldPreserveCameras]
  );

  const stageLocalRobotFiles = useCallback(
    (files: File[]): void => {
      const usableFiles = files.filter(isUsableRobotFile);
      if (usableFiles.length === 0) {
        toast.error("No robot files were selected.");
        return;
      }
      const label = deriveLocalSourceLabel(usableFiles);
      setLastLocalFolder(label);
      writeStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalRobotSourceStorageKey, label);
      stageRobot({
        label,
        kind: "local",
        load: async () => loadRobotFiles(usableFiles, label),
      });
    },
    [loadRobotFiles, stageRobot]
  );

  const handleFolderSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      stageLocalRobotFiles(fileListToArray(event.currentTarget.files));
      event.currentTarget.value = "";
    },
    [stageLocalRobotFiles]
  );

  const handleRobotSourceDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      setRobotSourceDropActive(false);
      stageLocalRobotFiles(fileListToArray(event.dataTransfer.files));
    },
    [stageLocalRobotFiles]
  );

  const stageGithubRobot = useCallback(
    (event?: FormEvent<HTMLFormElement>): void => {
      event?.preventDefault();
      const repoUrl = githubUrl.trim();
      if (!repoUrl) {
        toast.error("Paste a GitHub repository link first.");
        return;
      }
      const urdfPath = githubUrdfPath.trim();
      const label = deriveSourceLabel(urdfPath || repoUrl, "GitHub robot");
      stageRobot({
        label,
        kind: "github",
        load: async () => {
          setIsLoadingGithub(true);
          try {
            await onGitHubSelected({ repoUrl, urdfPath: urdfPath || undefined });
            setLoadedRobotName(label);
          } finally {
            setIsLoadingGithub(false);
          }
        },
      });
    },
    [githubUrl, githubUrdfPath, onGitHubSelected, stageRobot]
  );

  const stageUrlRobot = useCallback(
    (event?: FormEvent<HTMLFormElement>): void => {
      event?.preventDefault();
      const url = urlSource.trim();
      if (!url) {
        toast.error("Paste a URDF, Xacro, Hugging Face, or raw URL first.");
        return;
      }
      const label = deriveSourceLabel(url, "Remote robot");
      stageRobot({
        label,
        kind: "url",
        load: async () => {
          setIsLoadingUrl(true);
          try {
            await onUrlSelected(url);
            setLoadedRobotName(label);
          } finally {
            setIsLoadingUrl(false);
          }
        },
      });
    },
    [onUrlSelected, stageRobot, urlSource]
  );

  const clearLastLocalFolder = useCallback((): void => {
    setLastLocalFolder(null);
    writeStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalRobotSourceStorageKey, null);
  }, []);

  const loadStagedRobot = useCallback(async (): Promise<boolean> => {
    const robotSource = stagedRobotRef.current;
    if (!robotSource) {
      return false;
    }
    await robotSource.load();
    setStagedRobot(null);
    stagedRobotRef.current = null;
    return true;
  }, []);

  return {
    clearLastLocalFolder,
    githubUrl,
    githubUrdfPath,
    handleFolderSelect,
    handleRobotSourceDrop,
    isLoadingGithub,
    isLoadingUrl,
    lastLocalFolder,
    loadedRobotName,
    loadStagedRobot,
    robotSourceDropActive,
    setGithubUrl,
    setGithubUrdfPath,
    setRobotSourceDropActive,
    setUrlSource,
    stageGithubRobot,
    stageLocalRobotFiles,
    stageUrlRobot,
    stagedRobot,
    urlSource,
  };
};
