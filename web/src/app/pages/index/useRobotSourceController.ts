import { useCallback, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { toast } from "sonner";

import {
  addRecentRobotSource,
  CORE_FOLDER_UPLOAD_SCREEN_PARAMS,
  deriveLocalSourceLabel,
  deriveSourceLabel,
  fileListToArray,
  readRecentRobotSources,
  readStoredString,
  recentRobotSourceKey,
  removeRecentRobotSource as removeStoredRecentRobotSource,
  writeStoredString,
  type RecentRobotSource,
} from "@/app/pages/index/coreFolderUploadScreenState";
import type { SourceEntryActions } from "@/app/pages/index/sourceEntryTypes";
import type { NativeRobotFormat } from "@/features/layout/page/NativeRobotViewer";

type StagedRobotSource = {
  label: string;
  kind: "local" | "github" | "url";
  load: () => Promise<void>;
};

type UseRobotSourceControllerParams = {
  onFolderSelected: SourceEntryActions["onFolderSelected"];
  onGitHubSelected: SourceEntryActions["onGitHubSelected"];
  onUrlSelected: SourceEntryActions["onUrlSelected"];
  onOpenUsdSelected: SourceEntryActions["onOpenUsdSelected"];
  onNativeRobotSelected: SourceEntryActions["onNativeRobotSelected"];
  shouldPreserveCameras: () => boolean;
};

const isUsableRobotFile = (file: File): boolean =>
  file.size > 0 || /\.(urdf|xacro|xml|mjcf|usd|usda|usdc|usdz)$/i.test(file.name);

const filePath = (file: File): string =>
  (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

const detectNativeRobot = async (
  files: File[]
): Promise<{ format: NativeRobotFormat; primaryPath: string } | null> => {
  const usd = files.find((file) => /\.(usd|usda|usdc|usdz)$/i.test(file.name));
  if (usd) return { format: "USD", primaryPath: filePath(usd) };
  const xmlFiles = files.filter((file) => /\.(xml|mjcf)$/i.test(file.name));
  for (const file of xmlFiles) {
    const text = await file.text();
    if (/<mujoco(?:\s|>)/i.test(text)) return { format: "MJCF", primaryPath: filePath(file) };
  }
  return null;
};

export const useRobotSourceController = ({
  onFolderSelected,
  onGitHubSelected,
  onUrlSelected,
  onOpenUsdSelected,
  onNativeRobotSelected,
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
  const [recentRobotSources, setRecentRobotSources] = useState<RecentRobotSource[]>(() =>
    readRecentRobotSources(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentRobotSourcesStorageKey)
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
      const nativeRobot = await detectNativeRobot(files);
      if (nativeRobot) {
        await onNativeRobotSelected(files, nativeRobot.primaryPath, nativeRobot.format);
        setLoadedRobotName(label);
        return;
      }
      await onFolderSelected(files, { preserveCameras: shouldPreserveCameras() });
      setLoadedRobotName(label);
    },
    [onFolderSelected, onNativeRobotSelected, shouldPreserveCameras]
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

  const rememberRecentRobotSource = useCallback((source: RecentRobotSource): void => {
    setRecentRobotSources(
      addRecentRobotSource(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentRobotSourcesStorageKey, source)
    );
  }, []);

  const stageGithubRobotSource = useCallback(
    (repoUrl: string, urdfPath: string): void => {
      const label = deriveSourceLabel(urdfPath || repoUrl, "GitHub robot");
      stageRobot({
        label,
        kind: "github",
        load: async () => {
          setIsLoadingGithub(true);
          try {
            await onGitHubSelected({ repoUrl, urdfPath: urdfPath || undefined });
            setLoadedRobotName(label);
            rememberRecentRobotSource({
              kind: "github",
              repoUrl,
              urdfPath: urdfPath || undefined,
            });
          } finally {
            setIsLoadingGithub(false);
          }
        },
      });
    },
    [onGitHubSelected, rememberRecentRobotSource, stageRobot]
  );

  const stageGithubRobot = useCallback(
    (event?: FormEvent<HTMLFormElement>): void => {
      event?.preventDefault();
      const repoUrl = githubUrl.trim();
      if (!repoUrl) {
        toast.error("Paste a GitHub repository link first.");
        return;
      }
      stageGithubRobotSource(repoUrl, githubUrdfPath.trim());
    },
    [githubUrl, githubUrdfPath, stageGithubRobotSource]
  );

  const stageUrlRobotSource = useCallback(
    (url: string): void => {
      const label = deriveSourceLabel(url, "Remote robot");
      stageRobot({
        label,
        kind: "url",
        load: async () => {
          setIsLoadingUrl(true);
          try {
            const isOpenUsd = (() => {
              try {
                const parsed = new URL(url);
                return (
                  parsed.hostname.toLowerCase().endsWith("huggingface.co") &&
                  parsed.pathname.startsWith("/datasets/") &&
                  /\/(blob|tree|resolve)\//.test(parsed.pathname) &&
                  (/\.(usd|usda|usdc|usdz)$/i.test(parsed.pathname) ||
                    /\/tree\/[^/]+\/.+/.test(parsed.pathname))
                );
              } catch {
                return false;
              }
            })();
            if (isOpenUsd) {
              await onOpenUsdSelected(url);
            } else {
              await onUrlSelected(url);
            }
            setLoadedRobotName(label);
            rememberRecentRobotSource({ kind: "url", url });
          } finally {
            setIsLoadingUrl(false);
          }
        },
      });
    },
    [onOpenUsdSelected, onUrlSelected, rememberRecentRobotSource, stageRobot]
  );

  const stageUrlRobot = useCallback(
    (event?: FormEvent<HTMLFormElement>): void => {
      event?.preventDefault();
      const url = urlSource.trim();
      if (!url) {
        toast.error("Paste a URDF, Xacro, Hugging Face, or raw URL first.");
        return;
      }
      stageUrlRobotSource(url);
    },
    [stageUrlRobotSource, urlSource]
  );

  const stageRecentRobotSource = useCallback(
    (sourceKey: string): void => {
      const source = recentRobotSources.find(
        (candidate) => recentRobotSourceKey(candidate) === sourceKey
      );
      if (!source) return;
      if (source.kind === "github") {
        setGithubUrl(source.repoUrl);
        setGithubUrdfPath(source.urdfPath ?? "");
        stageGithubRobotSource(source.repoUrl, source.urdfPath ?? "");
        return;
      }
      setUrlSource(source.url);
      stageUrlRobotSource(source.url);
    },
    [recentRobotSources, stageGithubRobotSource, stageUrlRobotSource]
  );

  const removeRecentRobotSource = useCallback((sourceKey: string): void => {
    setRecentRobotSources(
      removeStoredRecentRobotSource(
        CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentRobotSourcesStorageKey,
        sourceKey
      )
    );
  }, []);

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
    recentRobotSources,
    removeRecentRobotSource,
    robotSourceDropActive,
    setGithubUrl,
    setGithubUrdfPath,
    setRobotSourceDropActive,
    setUrlSource,
    stageGithubRobot,
    stageLocalRobotFiles,
    stageRecentRobotSource,
    stageUrlRobot,
    stagedRobot,
    urlSource,
  };
};
