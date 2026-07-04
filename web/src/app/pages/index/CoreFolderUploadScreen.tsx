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
  Github,
  Globe,
  Loader2,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { parseCameraConfig } from "@/features/camera";
import { useGPUMode } from "@/shared/hooks/use-gpu-mode";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import {
  LocalSourceButtons,
  RecentLinkPanel,
  RemoteSourceInput,
  SourcePanel,
} from "@/app/pages/index/coreFolderUploadScreenParts";
import {
  buildWorldLayoutFolderAssetMap,
  splitWorldLayoutFolderFiles,
} from "@/app/pages/index/worldLayoutFolderImport";
import {
  addRecentValue,
  CORE_FOLDER_UPLOAD_SCREEN_PARAMS,
  deriveLocalSourceLabel,
  deriveSourceLabel,
  fileListToArray,
  readStoredJsonArray,
  readStoredString,
  removeRecentValue,
  writeStoredString,
} from "@/app/pages/index/coreFolderUploadScreenState";
import type { SourceEntryActions } from "@/app/pages/index/sourceEntryTypes";

type CoreFolderUploadScreenProps = SourceEntryActions;

type StagedRobotSource = {
  label: string;
  kind: "local" | "github" | "url";
  load: () => Promise<void>;
};

export const CoreFolderUploadScreen = ({
  onFolderSelected,
  onGitHubSelected,
  onUrlSelected,
  onPlayDemoMotion,
  onImportWorldLayout,
  onOpenWorldOnlyWorkspace,
}: CoreFolderUploadScreenProps) => {
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const localFilesInputRef = useRef<HTMLInputElement | null>(null);
  const worldLayoutFileInputRef = useRef<HTMLInputElement | null>(null);
  const worldLayoutFolderInputRef = useRef<HTMLInputElement | null>(null);
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
    readStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalRobotSourceStorageKey)
  );
  const [lastLocalCameraConfig, setLastLocalCameraConfig] = useState<string | null>(() =>
    readStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalCameraConfigStorageKey)
  );
  const [lastLocalWorldLayout, setLastLocalWorldLayout] = useState<string | null>(() =>
    readStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalWorldLayoutStorageKey)
  );
  const [recentCameraConfigs, setRecentCameraConfigs] = useState<string[]>(() =>
    readStoredJsonArray(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentCameraConfigsStorageKey)
  );
  const [recentWorldLayouts, setRecentWorldLayouts] = useState<string[]>(() =>
    readStoredJsonArray(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentWorldLayoutsStorageKey)
  );

  const logoUrl = `${import.meta.env.BASE_URL}assets/urdf-studio-logo.png`;
  const entryLoadInteractionsDisabled = isLoadingSetup;
  const hasSetupSelection = Boolean(stagedRobot) || Boolean(loadedWorldLayoutName);
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
        setRecentWorldLayouts(addRecentValue(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentWorldLayoutsStorageKey, normalizedUrl));
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
        setRecentCameraConfigs(addRecentValue(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentCameraConfigsStorageKey, normalizedUrl));
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
        writeStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalCameraConfigStorageKey, file.name);
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
      if (!loadedWorldLayoutName) {
        toast.error("Select a robot source or load a world layout before loading setup.");
        return;
      }
      onOpenWorldOnlyWorkspace();
      toast.success("Setup loaded.");
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
  }, [loadWorldLayoutFromUrl, loadedWorldLayoutName, onOpenWorldOnlyWorkspace, worldLayoutUrl]);

  const handlePlayDemoMotionClick = useCallback((): void => {
    void onPlayDemoMotion();
  }, [onPlayDemoMotion]);

  const handleGPUModeToggle = useCallback(
    (checked: boolean): void => {
      setGPUMode(checked ? "high" : "low");
    },
    [setGPUMode]
  );

  const renderRobotLoader = () => (
    <SourcePanel
      icon={Bot}
      title="Robot"
      description="Load a URDF package folder, loose robot files, GitHub repository, or direct URDF/Xacro URL."
      isDropActive={robotSourceDropActive}
      onDropActiveChange={setRobotSourceDropActive}
      onDrop={handleRobotSourceDrop}
    >
      <LocalSourceButtons
        onBrowseFolder={() => folderInputRef.current?.click()}
        onBrowseFiles={() => localFilesInputRef.current?.click()}
      />
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
              className={CORE_FOLDER_UPLOAD_SCREEN_PARAMS.sourceButtonClass}
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
            className={CORE_FOLDER_UPLOAD_SCREEN_PARAMS.sourceButtonClass}
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
        <RecentLinkPanel
          title="Recent Robot Sources"
          emptyLabel="No recent local robot folder yet."
          entries={[]}
          onLoadUrl={() => undefined}
          onRemoveUrl={() => undefined}
          lastLocalLabel={lastLocalFolder}
          onBrowseLocal={() => folderInputRef.current?.click()}
          onClearLocal={() => {
            setLastLocalFolder(null);
            writeStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalRobotSourceStorageKey, null);
          }}
        />
      )}
    </SourcePanel>
  );

  const renderCameraSetupLoader = () => (
    <SourcePanel
      icon={Camera}
      title="Camera"
      description="Load a camera JSON/YAML with name, parent joint, pose, and intrinsics."
      isDropActive={cameraSourceDropActive}
      onDropActiveChange={setCameraSourceDropActive}
      onDrop={handleCameraSourceDrop}
    >
      <LocalSourceButtons
        filesLabel="Local File"
        onBrowseFiles={() => cameraConfigFileInputRef.current?.click()}
      />
      <RemoteSourceInput
        inputPlaceholder="https://.../camera-config.json"
        inputValue={cameraConfigUrl}
        onInputValueChange={setCameraConfigUrl}
        onLoadRemote={() => loadCameraConfigFromUrl(cameraConfigUrl)}
        loadDisabled={isLoadingCameraConfig || !cameraConfigUrl.trim()}
        isLoading={isLoadingCameraConfig}
        loadIcon="globe"
      />
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
        <RecentLinkPanel
          title="Recent Camera Configs"
          emptyLabel="No recent camera configs yet."
          entries={recentCameraConfigs}
          onLoadUrl={loadCameraConfigFromUrl}
          onRemoveUrl={(url) => {
            setRecentCameraConfigs(removeRecentValue(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentCameraConfigsStorageKey, url));
          }}
          lastLocalLabel={lastLocalCameraConfig}
          onBrowseLocal={() => cameraConfigFileInputRef.current?.click()}
          onClearLocal={() => {
            setLastLocalCameraConfig(null);
            writeStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalCameraConfigStorageKey, null);
          }}
        />
      )}
    </SourcePanel>
  );

  const renderWorldLayoutLoader = () => (
    <SourcePanel
      icon={Globe}
      title="World"
      description="Paste a world link, or load a folder containing the world layout JSON plus any mesh, splat, or texture assets it references. Public and GitHub file links are supported."
      isDropActive={worldSourceDropActive}
      onDropActiveChange={setWorldSourceDropActive}
      onDrop={handleWorldSourceDrop}
    >
      <LocalSourceButtons
        onBrowseFolder={() => worldLayoutFolderInputRef.current?.click()}
        onBrowseFiles={() => worldLayoutFileInputRef.current?.click()}
      />
      <RemoteSourceInput
        inputPlaceholder="https://.../world-layout.json"
        inputValue={worldLayoutUrl}
        onInputValueChange={setWorldLayoutUrl}
        onLoadRemote={() => loadWorldLayoutFromUrl(worldLayoutUrl)}
        loadDisabled={isLoadingWorldLayout || !worldLayoutUrl.trim()}
        isLoading={isLoadingWorldLayout}
        loadIcon="globe"
      />
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
        <RecentLinkPanel
          title="Recent World Layouts"
          emptyLabel="No recent world layouts yet."
          entries={recentWorldLayouts}
          onLoadUrl={(url) => {
            void loadWorldLayoutFromUrl(url);
          }}
          onRemoveUrl={(url) => {
            setRecentWorldLayouts(removeRecentValue(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.recentWorldLayoutsStorageKey, url));
          }}
          lastLocalLabel={lastLocalWorldLayout}
          onBrowseLocal={() => worldLayoutFileInputRef.current?.click()}
          onClearLocal={() => {
            setLastLocalWorldLayout(null);
            writeStoredString(CORE_FOLDER_UPLOAD_SCREEN_PARAMS.lastLocalWorldLayoutStorageKey, null);
          }}
        />
      )}
    </SourcePanel>
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
            className="h-9 min-w-[170px] rounded-md border border-border/70 bg-background/60 px-3 text-xs font-medium text-foreground shadow-none hover:border-border hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="mr-2 inline-flex h-4 w-4 items-center justify-center text-muted-foreground">
              <Play className="h-3.5 w-3.5" />
            </span>
            <span>Play Sample Motion</span>
          </Button>
        </div>
      </div>
      <div className={`w-full ${CORE_FOLDER_UPLOAD_SCREEN_PARAMS.setupEntryWideContainerClass}`}>
        <input
          ref={worldLayoutFileInputRef}
          type="file"
          multiple
          accept=".json,application/json,.stl,.dae,.obj,.glb,.gltf,.mtl,.ply,.splat,.png,.jpg,.jpeg"
          onChange={handleWorldLayoutFileSelect}
          className="hidden"
          aria-label="Select world layout JSON file and assets"
        />
        <input
          ref={worldLayoutFolderInputRef}
          type="file"
          {...({ webkitdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
          multiple
          onChange={handleWorldLayoutFileSelect}
          className="hidden"
          aria-label="Select world layout folder"
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
            className={CORE_FOLDER_UPLOAD_SCREEN_PARAMS.launcherActionButtonClass}
          >
            {isLoadingSetup ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 h-4 w-4" />
            )}
            Load Setup
          </Button>
        </div>
        <div className={CORE_FOLDER_UPLOAD_SCREEN_PARAMS.setupEntryPrimaryGridClass}>
          <div className={CORE_FOLDER_UPLOAD_SCREEN_PARAMS.setupEntryStackClass}>
            {renderRobotLoader()}
            {renderCameraSetupLoader()}
          </div>
          {renderWorldLayoutLoader()}
        </div>
      </div>
    </div>
  );
};
