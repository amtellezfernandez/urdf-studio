import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  Bot,
  Camera,
  Check,
  FileUp,
  Folder,
  FolderOpen,
  Github,
  Globe,
  Info,
  Loader2,
  Play,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { parseCameraConfig } from "@/features/camera";
import { useGPUMode } from "@/shared/hooks/use-gpu-mode";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";

type UrdfFileInput = FileList | File[];

type CoreFolderUploadScreenProps = {
  onFolderSelected: (fileList: UrdfFileInput, options?: { preserveCameras?: boolean }) => Promise<void>;
  onGitHubSelected: (params: { repoUrl: string; urdfPath?: string; token?: string }) => Promise<void>;
  onUrlSelected: (url: string) => Promise<void>;
  onPlayDemoMotion: () => void | Promise<void>;
  onImportWorldLayout: (worldLayoutUrl: string) => Promise<void>;
};

type StagedRobotSource = {
  label: string;
  kind: "local" | "github" | "url";
  load: () => Promise<void>;
};

const SETUP_ENTRY_WIDE_CONTAINER_CLASS = "max-w-7xl space-y-6";
const SETUP_ENTRY_PRIMARY_GRID_CLASS =
  "grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] xl:items-start";
const SETUP_ENTRY_STACK_CLASS = "space-y-4";
const RECENT_CAMERA_CONFIGS_STORAGE_KEY = "urdfstudio:recent-camera-configs";
const RECENT_WORLD_LAYOUTS_STORAGE_KEY = "urdfstudio:recent-world-layouts";
const LAST_LOCAL_CAMERA_CONFIG_STORAGE_KEY = "urdfstudio:last-local-camera-config";
const LAST_LOCAL_ROBOT_SOURCE_STORAGE_KEY = "urdfstudio:last-local-robot-source";
const LAST_LOCAL_WORLD_LAYOUT_STORAGE_KEY = "urdfstudio:last-local-world-layout";

const readStoredJsonArray = (storageKey: string): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const value = window.localStorage.getItem(storageKey);
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

const writeStoredJsonArray = (storageKey: string, values: string[]): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(values));
};

const readStoredString = (storageKey: string): string | null => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(storageKey);
};

const writeStoredString = (storageKey: string, value: string | null): void => {
  if (typeof window === "undefined") return;
  if (value) {
    window.localStorage.setItem(storageKey, value);
    return;
  }
  window.localStorage.removeItem(storageKey);
};

const addRecentValue = (storageKey: string, value: string, maxItems = 3): string[] => {
  const trimmed = value.trim();
  if (!trimmed) return readStoredJsonArray(storageKey);
  const nextValues = [
    trimmed,
    ...readStoredJsonArray(storageKey).filter((item) => item !== trimmed),
  ].slice(0, maxItems);
  writeStoredJsonArray(storageKey, nextValues);
  return nextValues;
};

const removeRecentValue = (storageKey: string, value: string): string[] => {
  const nextValues = readStoredJsonArray(storageKey).filter((item) => item !== value);
  writeStoredJsonArray(storageKey, nextValues);
  return nextValues;
};

const deriveSourceLabel = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = new URL(trimmed);
    const segment = parsed.pathname.split("/").filter(Boolean).pop();
    return segment || parsed.hostname || fallback;
  } catch {
    const segment = trimmed.split("/").filter(Boolean).pop();
    return segment || fallback;
  }
};

const getFileRelativePath = (file: File): string =>
  ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(
    /\\/g,
    "/"
  );

const deriveLocalSourceLabel = (files: File[]): string => {
  const firstPath = files[0] ? getFileRelativePath(files[0]) : "";
  const firstSegment = firstPath.split("/").filter(Boolean)[0];
  if (firstSegment && firstSegment !== files[0]?.name) return firstSegment;
  if (files.length === 1 && files[0]) return files[0].name;
  return `${files.length} local files`;
};

const fileListToArray = (fileList: FileList | null): File[] =>
  fileList ? Array.from(fileList) : [];

const sourceButtonClass =
  "h-8 rounded-md border border-border bg-muted px-3 text-xs text-foreground hover:bg-muted/80";
const launcherActionButtonClass =
  "h-8 rounded-md border border-[#ff63d5]/30 bg-[#ff63d5]/[0.08] px-3 text-xs text-foreground hover:bg-[#ff63d5]/[0.14] disabled:border-border disabled:bg-muted/20 disabled:text-muted-foreground";

export const CoreFolderUploadScreen = ({
  onFolderSelected,
  onGitHubSelected,
  onUrlSelected,
  onPlayDemoMotion,
  onImportWorldLayout,
}: CoreFolderUploadScreenProps) => {
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const localFilesInputRef = useRef<HTMLInputElement | null>(null);
  const worldLayoutFileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraConfigFileInputRef = useRef<HTMLInputElement | null>(null);
  const stagedRobotRef = useRef<StagedRobotSource | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const { gpuMode, setGPUMode } = useGPUMode();
  const cameras = useCameraStore((state) => state.cameras);
  const loadCameras = useCameraStore((state) => state.loadCameras);
  const clearCameras = useCameraStore((state) => state.clearCameras);
  const removeCamera = useCameraStore((state) => state.removeCamera);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubUrdfPath, setGithubUrdfPath] = useState("");
  const [urlSource, setUrlSource] = useState("");
  const [worldLayoutUrl, setWorldLayoutUrl] = useState("");
  const [cameraConfigUrl, setCameraConfigUrl] = useState("");
  const [robotSourceDropActive, setRobotSourceDropActive] = useState(false);
  const [worldSourceDropActive, setWorldSourceDropActive] = useState(false);
  const [cameraSourceDropActive, setCameraSourceDropActive] = useState(false);
  const [isLoadingGithub, setIsLoadingGithub] = useState(false);
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [isLoadingWorldLayout, setIsLoadingWorldLayout] = useState(false);
  const [isLoadingCameraConfig, setIsLoadingCameraConfig] = useState(false);
  const [isLoadingSetup, setIsLoadingSetup] = useState(false);
  const [loadedRobotName, setLoadedRobotName] = useState<string | null>(null);
  const [loadedWorldLayoutName, setLoadedWorldLayoutName] = useState<string | null>(null);
  const [stagedRobot, setStagedRobot] = useState<StagedRobotSource | null>(null);
  const [lastLocalFolder, setLastLocalFolder] = useState<string | null>(() =>
    readStoredString(LAST_LOCAL_ROBOT_SOURCE_STORAGE_KEY)
  );
  const [lastLocalCameraConfig, setLastLocalCameraConfig] = useState<string | null>(() =>
    readStoredString(LAST_LOCAL_CAMERA_CONFIG_STORAGE_KEY)
  );
  const [lastLocalWorldLayout, setLastLocalWorldLayout] = useState<string | null>(() =>
    readStoredString(LAST_LOCAL_WORLD_LAYOUT_STORAGE_KEY)
  );
  const [recentCameraConfigs, setRecentCameraConfigs] = useState<string[]>(() =>
    readStoredJsonArray(RECENT_CAMERA_CONFIGS_STORAGE_KEY)
  );
  const [recentWorldLayouts, setRecentWorldLayouts] = useState<string[]>(() =>
    readStoredJsonArray(RECENT_WORLD_LAYOUTS_STORAGE_KEY)
  );

  const logoUrl = `${import.meta.env.BASE_URL}assets/urdf-studio-logo.png`;
  const entryLoadInteractionsDisabled = isLoadingSetup;
  const hasSetupSelection = Boolean(stagedRobot);
  const loadedCameraSummary = useMemo(
    () => (cameras.length === 1 ? "1 camera" : `${cameras.length} cameras`),
    [cameras.length]
  );

  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
      objectUrlsRef.current = [];
    },
    []
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
      await onFolderSelected(files, { preserveCameras: useCameraStore.getState().cameras.length > 0 });
      setLoadedRobotName(label);
    },
    [onFolderSelected]
  );

  const stageLocalRobotFiles = useCallback(
    (files: File[]): void => {
      const usableFiles = files.filter(
        (file) => file.size > 0 || /\.(urdf|xacro)$/i.test(file.name)
      );
      if (usableFiles.length === 0) {
        toast.error("No robot files were selected.");
        return;
      }
      const label = deriveLocalSourceLabel(usableFiles);
      setLastLocalFolder(label);
      writeStoredString(LAST_LOCAL_ROBOT_SOURCE_STORAGE_KEY, label);
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
        setRecentWorldLayouts(addRecentValue(RECENT_WORLD_LAYOUTS_STORAGE_KEY, normalizedUrl));
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

  const processWorldLayoutFile = useCallback(
    async (file: File): Promise<void> => {
      const objectUrl = URL.createObjectURL(file);
      objectUrlsRef.current.push(objectUrl);
      setIsLoadingWorldLayout(true);
      try {
        await onImportWorldLayout(objectUrl);
        setLastLocalWorldLayout(file.name);
        writeStoredString(LAST_LOCAL_WORLD_LAYOUT_STORAGE_KEY, file.name);
        setLoadedWorldLayoutName(file.name);
        toast.success(`Loaded world layout from ${file.name}.`);
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
      const file = event.currentTarget.files?.[0];
      if (file) void processWorldLayoutFile(file);
      event.currentTarget.value = "";
    },
    [processWorldLayoutFile]
  );

  const handleWorldSourceDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      setWorldSourceDropActive(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) {
        toast.error("No local file was dropped.");
        return;
      }
      void processWorldLayoutFile(file);
    },
    [processWorldLayoutFile]
  );

  const applyCameraConfig = useCallback(
    (cameraConfig: Parameters<typeof loadCameras>[0], sourceLabel: string): void => {
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
        const response = await fetch(normalizedUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch camera config (${response.status}).`);
        }
        const content = await response.text();
        const filename = deriveSourceLabel(normalizedUrl, "camera-config.json");
        applyCameraConfig(parseCameraConfig(content, filename), normalizedUrl);
        setRecentCameraConfigs(addRecentValue(RECENT_CAMERA_CONFIGS_STORAGE_KEY, normalizedUrl));
        setCameraConfigUrl(normalizedUrl);
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

  const processCameraConfigFile = useCallback(
    async (file: File): Promise<void> => {
      setIsLoadingCameraConfig(true);
      try {
        const content = await file.text();
        applyCameraConfig(parseCameraConfig(content, file.name), file.name);
        setLastLocalCameraConfig(file.name);
        writeStoredString(LAST_LOCAL_CAMERA_CONFIG_STORAGE_KEY, file.name);
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
      const file = event.dataTransfer.files?.[0];
      if (!file) {
        toast.error("No local file was dropped.");
        return;
      }
      void processCameraConfigFile(file);
    },
    [processCameraConfigFile]
  );

  const handleLoadSetup = useCallback(async (): Promise<void> => {
    const robotSource = stagedRobotRef.current;
    if (!robotSource) {
      toast.error("Select a robot source before loading setup.");
      return;
    }
    setIsLoadingSetup(true);
    try {
      await robotSource.load();
      if (worldLayoutUrl.trim() && !loadedWorldLayoutName) {
        await loadWorldLayoutFromUrl(worldLayoutUrl);
      }
      setStagedRobot(null);
      stagedRobotRef.current = null;
      toast.success("Setup loaded.");
    } finally {
      setIsLoadingSetup(false);
    }
  }, [loadWorldLayoutFromUrl, loadedWorldLayoutName, worldLayoutUrl]);

  const handlePlayDemoMotionClick = useCallback((): void => {
    void onPlayDemoMotion();
  }, [onPlayDemoMotion]);

  const handleGPUModeToggle = useCallback(
    (checked: boolean): void => {
      setGPUMode(checked ? "high" : "low");
    },
    [setGPUMode]
  );

  const renderRecentLinkPanel = ({
    title,
    emptyLabel,
    entries,
    onLoadUrl,
    onRemoveUrl,
    lastLocalLabel,
    onBrowseLocal,
    onClearLocal,
  }: {
    title: string;
    emptyLabel: string;
    entries: string[];
    onLoadUrl: (url: string) => void | Promise<void>;
    onRemoveUrl: (url: string) => void;
    lastLocalLabel?: string | null;
    onBrowseLocal: () => void;
    onClearLocal: () => void;
  }) => (
    <div className="space-y-2 rounded-md border border-border/70 bg-background/40 p-2.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Folder className="h-3.5 w-3.5" />
        <span>{title}</span>
      </div>
      {entries.length === 0 && !lastLocalLabel ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {entries.map((entry) => (
            <button
              key={entry}
              type="button"
              className="group inline-flex max-w-full items-center gap-1 rounded-md border border-border/30 bg-background/20 px-1.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:border-border/45 hover:bg-background/35 hover:text-foreground"
              title={entry}
              onClick={() => {
                void onLoadUrl(entry);
              }}
            >
              <span className="max-w-[170px] truncate">{deriveSourceLabel(entry, entry)}</span>
              <X
                className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveUrl(entry);
                }}
              />
            </button>
          ))}
          {lastLocalLabel ? (
            <button
              type="button"
              className="group inline-flex max-w-full items-center gap-1 rounded-md border border-border/30 bg-background/20 px-1.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:border-border/45 hover:bg-background/35 hover:text-foreground"
              title={`Browse ${lastLocalLabel} again`}
              onClick={onBrowseLocal}
            >
              <Folder className="h-3 w-3" />
              <span className="max-w-[170px] truncate">local · {lastLocalLabel}</span>
              <X
                className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  onClearLocal();
                }}
              />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );

  const renderCompactSourceIntake = ({
    isDropActive,
    isPreparing,
    localLabel,
    onBrowseLocal,
    inputPlaceholder,
    inputValue,
    onInputValueChange,
    onLoadRemote,
    loadDisabled,
    isLoading,
    loadIcon,
  }: {
    isDropActive: boolean;
    isPreparing: boolean;
    localLabel: string;
    onBrowseLocal: () => void;
    inputPlaceholder: string;
    inputValue: string;
    onInputValueChange: (value: string) => void;
    onLoadRemote: () => void | Promise<unknown>;
    loadDisabled: boolean;
    isLoading: boolean;
    loadIcon: "github" | "globe";
  }) => (
    <div className="flex w-full flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center">
      <div
        className={`flex w-full items-center gap-1.5 rounded-md border border-dashed px-3 py-2.5 transition-colors sm:w-auto sm:shrink-0 ${
          isDropActive
            ? "border-[#ff63d5]/60 bg-[#ff63d5]/[0.05] text-foreground"
            : "border-border/70 bg-background/35 text-muted-foreground"
        }`}
      >
        <div className="flex items-center gap-1.5">
          {isPreparing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FolderOpen className="h-3.5 w-3.5" />
          )}
          <span>{localLabel}</span>
          <button
            type="button"
            onClick={onBrowseLocal}
            className="text-[11px] font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
          >
            Browse Locally
          </button>
        </div>
      </div>
      <div className="flex w-full min-w-0 items-center gap-1.5 sm:flex-1">
        <Input
          type="text"
          placeholder={inputPlaceholder}
          value={inputValue}
          onChange={(event) => onInputValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !isLoading) {
              void onLoadRemote();
            }
          }}
          disabled={isLoading}
          className="min-w-0 flex-1 bg-background/80"
        />
        <Button
          type="button"
          onClick={() => {
            void onLoadRemote();
          }}
          disabled={loadDisabled}
          size="sm"
          className={sourceButtonClass}
        >
          {isLoading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : loadIcon === "github" ? (
            <Github className="mr-1.5 h-3.5 w-3.5" />
          ) : (
            <Globe className="mr-1.5 h-3.5 w-3.5" />
          )}
          Load
        </Button>
      </div>
    </div>
  );

  const renderRobotLoader = () => (
    <div
      className={`space-y-4 rounded-lg border p-4 transition-colors ${
        robotSourceDropActive
          ? "border-[#ff63d5]/60 bg-[#ff63d5]/[0.05]"
          : "border-border bg-background/40"
      }`}
      onDragEnter={(event) => {
        event.preventDefault();
        setRobotSourceDropActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setRobotSourceDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setRobotSourceDropActive(false);
      }}
      onDrop={handleRobotSourceDrop}
    >
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Robot</p>
      </div>
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
        <p>Load a URDF package folder, loose robot files, GitHub repository, or direct URDF/Xacro URL.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => folderInputRef.current?.click()}
          className={sourceButtonClass}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Local Folder
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => localFilesInputRef.current?.click()}
          className={sourceButtonClass}
        >
          <FileUp className="mr-1.5 h-3.5 w-3.5" />
          Local Files
        </Button>
      </div>
      <form className="space-y-2" onSubmit={stageGithubRobot}>
        <div className="flex w-full flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <div className="flex w-full min-w-0 items-center gap-1.5">
            <Input
              type="text"
              placeholder="https://github.com/owner/repo"
              value={githubUrl}
              onChange={(event) => setGithubUrl(event.target.value)}
              disabled={isLoadingGithub}
              className="min-w-0 flex-1 bg-background/80"
            />
            <Button
              type="submit"
              disabled={isLoadingGithub || !githubUrl.trim()}
              size="sm"
              className={sourceButtonClass}
            >
              {isLoadingGithub ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Github className="mr-1.5 h-3.5 w-3.5" />
              )}
              Load
            </Button>
          </div>
        </div>
        <Input
          type="text"
          placeholder="Optional URDF path, e.g. robots/arm/robot.urdf"
          value={githubUrdfPath}
          onChange={(event) => setGithubUrdfPath(event.target.value)}
          disabled={isLoadingGithub}
          className="bg-background/80"
        />
      </form>
      <form onSubmit={stageUrlRobot}>
        <div className="flex w-full min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Input
            type="text"
            placeholder="URL or Hugging Face resolve link"
            value={urlSource}
            onChange={(event) => setUrlSource(event.target.value)}
            disabled={isLoadingUrl}
            className="min-w-0 flex-1 bg-background/80"
          />
          <Button
            type="submit"
            disabled={isLoadingUrl || !urlSource.trim()}
            size="sm"
            className={sourceButtonClass}
          >
            {isLoadingUrl ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Globe className="mr-1.5 h-3.5 w-3.5" />
            )}
            Load
          </Button>
        </div>
      </form>
      {stagedRobot || loadedRobotName ? (
        <div className="space-y-2 rounded-md border border-border/70 bg-background/40 p-2.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {loadedRobotName ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Bot className="h-3.5 w-3.5" />
            )}
            <span>{loadedRobotName ? "Loaded Robot" : "Selected Robot"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs text-foreground">
              {loadedRobotName ?? stagedRobot?.label}
            </span>
          </div>
        </div>
      ) : (
        renderRecentLinkPanel({
          title: "Recent Robot Sources",
          emptyLabel: "No recent local robot folder yet.",
          entries: [],
          onLoadUrl: () => undefined,
          onRemoveUrl: () => undefined,
          lastLocalLabel: lastLocalFolder,
          onBrowseLocal: () => folderInputRef.current?.click(),
          onClearLocal: () => {
            setLastLocalFolder(null);
            writeStoredString(LAST_LOCAL_ROBOT_SOURCE_STORAGE_KEY, null);
          },
        })
      )}
    </div>
  );

  const renderCameraSetupLoader = () => (
    <div
      className={`space-y-4 rounded-lg border p-4 transition-colors ${
        cameraSourceDropActive
          ? "border-[#ff63d5]/60 bg-[#ff63d5]/[0.05]"
          : "border-border bg-background/40"
      }`}
      onDragEnter={(event) => {
        event.preventDefault();
        setCameraSourceDropActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setCameraSourceDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setCameraSourceDropActive(false);
      }}
      onDrop={handleCameraSourceDrop}
    >
      <div className="flex items-center gap-2">
        <Camera className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Camera</p>
      </div>
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
        <p>Load a camera JSON/YAML with name, parent joint, pose, and intrinsics.</p>
      </div>
      {renderCompactSourceIntake({
        isDropActive: cameraSourceDropActive,
        isPreparing: isLoadingCameraConfig,
        localLabel: "Drag camera JSON/YAML",
        onBrowseLocal: () => cameraConfigFileInputRef.current?.click(),
        inputPlaceholder: "https://.../camera-config.json",
        inputValue: cameraConfigUrl,
        onInputValueChange: setCameraConfigUrl,
        onLoadRemote: () => loadCameraConfigFromUrl(cameraConfigUrl),
        loadDisabled: isLoadingCameraConfig || !cameraConfigUrl.trim(),
        isLoading: isLoadingCameraConfig,
        loadIcon: "globe",
      })}
      {cameras.length > 0 ? (
        <div className="space-y-2 rounded-md border border-border/70 bg-background/40 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Camera className="h-3.5 w-3.5" />
              <span>Loaded Cameras ({loadedCameraSummary})</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                clearCameras();
                toast.success("Cleared all cameras.");
              }}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {cameras.map((camera) => (
              <div
                key={camera.id}
                className="group flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs text-foreground"
                title={`${camera.name} (${camera.parent_joint})`}
              >
                <span className="max-w-[190px] truncate">{camera.name}</span>
                <span className="text-muted-foreground">·</span>
                <span className="max-w-[150px] truncate text-muted-foreground">
                  {camera.parent_joint}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    removeCamera(camera.id);
                    toast.success(`Removed camera "${camera.name}".`);
                  }}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                  aria-label={`Delete camera ${camera.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        renderRecentLinkPanel({
          title: "Recent Camera Configs",
          emptyLabel: "No recent camera configs yet.",
          entries: recentCameraConfigs,
          onLoadUrl: loadCameraConfigFromUrl,
          onRemoveUrl: (url) => {
            setRecentCameraConfigs(removeRecentValue(RECENT_CAMERA_CONFIGS_STORAGE_KEY, url));
          },
          lastLocalLabel: lastLocalCameraConfig,
          onBrowseLocal: () => cameraConfigFileInputRef.current?.click(),
          onClearLocal: () => {
            setLastLocalCameraConfig(null);
            writeStoredString(LAST_LOCAL_CAMERA_CONFIG_STORAGE_KEY, null);
          },
        })
      )}
    </div>
  );

  const renderWorldLayoutLoader = () => (
    <div
      className={`space-y-4 rounded-lg border p-4 transition-colors ${
        worldSourceDropActive
          ? "border-[#ff63d5]/60 bg-[#ff63d5]/[0.05]"
          : "border-border bg-background/40"
      }`}
      onDragEnter={(event) => {
        event.preventDefault();
        setWorldSourceDropActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setWorldSourceDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setWorldSourceDropActive(false);
      }}
      onDrop={handleWorldSourceDrop}
    >
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">World</p>
      </div>
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
        <p>Paste a world link or browse local JSON. Public and GitHub file links are supported.</p>
      </div>
      {renderCompactSourceIntake({
        isDropActive: worldSourceDropActive,
        isPreparing: isLoadingWorldLayout,
        localLabel: "Drag world JSON",
        onBrowseLocal: () => worldLayoutFileInputRef.current?.click(),
        inputPlaceholder: "https://.../world-layout.json",
        inputValue: worldLayoutUrl,
        onInputValueChange: setWorldLayoutUrl,
        onLoadRemote: () => loadWorldLayoutFromUrl(worldLayoutUrl),
        loadDisabled: isLoadingWorldLayout || !worldLayoutUrl.trim(),
        isLoading: isLoadingWorldLayout,
        loadIcon: "globe",
      })}
      {loadedWorldLayoutName ? (
        <div className="space-y-2 rounded-md border border-border/70 bg-background/40 p-2.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Globe className="h-3.5 w-3.5" />
            <span>Loaded World Layout</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs text-foreground">
              {loadedWorldLayoutName}
            </span>
          </div>
        </div>
      ) : (
        renderRecentLinkPanel({
          title: "Recent World Layouts",
          emptyLabel: "No recent world layouts yet.",
          entries: recentWorldLayouts,
          onLoadUrl: (url) => {
            void loadWorldLayoutFromUrl(url);
          },
          onRemoveUrl: (url) => {
            setRecentWorldLayouts(removeRecentValue(RECENT_WORLD_LAYOUTS_STORAGE_KEY, url));
          },
          lastLocalLabel: lastLocalWorldLayout,
          onBrowseLocal: () => worldLayoutFileInputRef.current?.click(),
          onClearLocal: () => {
            setLastLocalWorldLayout(null);
            writeStoredString(LAST_LOCAL_WORLD_LAYOUT_STORAGE_KEY, null);
          },
        })
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-start bg-background px-4 py-6">
      <div className="flex w-full items-start justify-between pb-2">
        <div className="inline-flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {gpuMode === "high" ? "GPU Performance: High" : "GPU Performance: Low"}
          </span>
          <Switch
            checked={gpuMode === "high"}
            onCheckedChange={handleGPUModeToggle}
            className="data-[state=checked]:bg-[#ff63d5]/80"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Button
            onClick={handlePlayDemoMotionClick}
            size="sm"
            className="h-7 min-w-[170px] rounded-md border border-[#ff63d5]/25 bg-[#ff63d5]/[0.06] px-3 text-xs text-foreground hover:bg-[#ff63d5]/[0.1]"
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Play Sample Motion
          </Button>
        </div>
      </div>
      <div className={`w-full ${SETUP_ENTRY_WIDE_CONTAINER_CLASS}`}>
        <input
          ref={worldLayoutFileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleWorldLayoutFileSelect}
          className="hidden"
          aria-label="Select world layout JSON file"
        />
        <input
          ref={cameraConfigFileInputRef}
          type="file"
          accept=".json,.yaml,.yml,application/json,text/yaml,text/x-yaml"
          onChange={handleCameraConfigFileSelect}
          className="hidden"
          aria-label="Select camera configuration file"
        />
        <input
          ref={localFilesInputRef}
          type="file"
          multiple
          accept=".urdf,.xacro,.zip,.stl,.dae,.obj,.glb,.gltf,.mtl,.png,.jpg,.jpeg"
          onChange={handleFolderSelect}
          className="hidden"
          aria-label="Select robot files or zip archive"
        />
        <input
          ref={folderInputRef}
          type="file"
          {...({ webkitdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
          multiple
          onChange={handleFolderSelect}
          className="hidden"
          aria-label="Select robot simulation files folder"
        />
        <div className="space-y-3 text-center">
          <img
            src={logoUrl}
            alt="URDF Studio"
            className="mx-auto h-32 w-auto object-contain"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Load one or combine different sources.</p>
          <Button
            onClick={() => {
              void handleLoadSetup();
            }}
            disabled={!hasSetupSelection || entryLoadInteractionsDisabled}
            size="sm"
            className={launcherActionButtonClass}
          >
            {isLoadingSetup ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 h-4 w-4" />
            )}
            Load Setup
          </Button>
        </div>
        <div className={SETUP_ENTRY_PRIMARY_GRID_CLASS}>
          <div className={SETUP_ENTRY_STACK_CLASS}>
            {renderRobotLoader()}
            {renderCameraSetupLoader()}
          </div>
          {renderWorldLayoutLoader()}
        </div>
      </div>
    </div>
  );
};
