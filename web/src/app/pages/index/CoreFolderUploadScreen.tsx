import {
  useCallback,
  useMemo,
  useRef,
  useState,
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
  CORE_FOLDER_UPLOAD_SCREEN_PARAMS,
  toRecentLinkEntries,
  toRecentRobotSourceEntries,
} from "@/app/pages/index/coreFolderUploadScreenState";
import type { SourceEntryActions } from "@/app/pages/index/sourceEntryTypes";
import { useCameraConfigSourceController } from "@/app/pages/index/useCameraConfigSourceController";
import { useRobotSourceController } from "@/app/pages/index/useRobotSourceController";
import { useWorldLayoutSourceController } from "@/app/pages/index/useWorldLayoutSourceController";

type CoreFolderUploadScreenProps = SourceEntryActions;

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
  const { gpuMode, setGPUMode } = useGPUMode();
  const cameras = useCameraStore((state) => state.cameras);
  const loadCameras = useCameraStore((state) => state.loadCameras);
  const clearCameras = useCameraStore((state) => state.clearCameras);
  const removeCamera = useCameraStore((state) => state.removeCamera);
  const [isLoadingSetup, setIsLoadingSetup] = useState(false);
  const shouldPreserveCamerasForRobotLoad = useCallback(
    () => useCameraStore.getState().cameras.length > 0,
    []
  );
  const {
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
    stageRecentRobotSource,
    stageUrlRobot,
    stagedRobot,
    urlSource,
  } = useRobotSourceController({
    onFolderSelected,
    onGitHubSelected,
    onUrlSelected,
    shouldPreserveCameras: shouldPreserveCamerasForRobotLoad,
  });
  const {
    cameraConfigUrl,
    cameraSourceDropActive,
    clearLastLocalCameraConfig,
    handleCameraConfigFileSelect,
    handleCameraSourceDrop,
    isLoadingCameraConfig,
    lastLocalCameraConfig,
    loadCameraConfigFromUrl,
    recentCameraConfigs,
    removeRecentCameraConfig,
    setCameraConfigUrl,
    setCameraSourceDropActive,
  } = useCameraConfigSourceController({ loadCameras });
  const {
    clearLastLocalWorldLayout,
    handleWorldLayoutFileSelect,
    handleWorldSourceDrop,
    isLoadingWorldLayout,
    lastLocalWorldLayout,
    loadWorldLayoutFromUrl,
    loadedWorldLayoutName,
    recentWorldLayouts,
    removeRecentWorldLayout,
    setWorldLayoutUrl,
    setWorldSourceDropActive,
    worldLayoutUrl,
    worldSourceDropActive,
  } = useWorldLayoutSourceController({ onImportWorldLayout });

  const logoUrl = `${import.meta.env.BASE_URL}assets/urdf-studio-logo.png`;
  const entryLoadInteractionsDisabled = isLoadingSetup;
  const hasSetupSelection = Boolean(stagedRobot) || Boolean(loadedWorldLayoutName);
  const loadedCameraSummary = useMemo(
    () => (cameras.length === 1 ? "1 camera" : `${cameras.length} cameras`),
    [cameras.length]
  );

  const handleLoadSetup = useCallback(async (): Promise<void> => {
    if (!stagedRobot) {
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
      await loadStagedRobot();
      if (worldLayoutUrl.trim() && !loadedWorldLayoutName) {
        await loadWorldLayoutFromUrl(worldLayoutUrl);
      }
      toast.success("Setup loaded.");
    } finally {
      setIsLoadingSetup(false);
    }
  }, [
    loadStagedRobot,
    loadWorldLayoutFromUrl,
    loadedWorldLayoutName,
    onOpenWorldOnlyWorkspace,
    stagedRobot,
    worldLayoutUrl,
  ]);

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
      infoContent={
        <>
          For a GitHub repository, paste the repo link and, if the URDF isn't at the root, its path
          within the repo (e.g. <code>robots/arm/robot.urdf</code>). Sibling mesh files
          (.stl/.dae/.obj/.glb/.gltf) referenced by the URDF are resolved automatically from the same
          repository - you don't need to list them separately.
        </>
      }
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
          emptyLabel="No recent robot sources yet."
          entries={toRecentRobotSourceEntries(recentRobotSources)}
          onLoadEntry={stageRecentRobotSource}
          onRemoveEntry={removeRecentRobotSource}
          lastLocalLabel={lastLocalFolder}
          onBrowseLocal={() => folderInputRef.current?.click()}
          onClearLocal={clearLastLocalFolder}
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
          entries={toRecentLinkEntries(recentCameraConfigs)}
          onLoadEntry={loadCameraConfigFromUrl}
          onRemoveEntry={removeRecentCameraConfig}
          lastLocalLabel={lastLocalCameraConfig}
          onBrowseLocal={() => cameraConfigFileInputRef.current?.click()}
          onClearLocal={clearLastLocalCameraConfig}
        />
      )}
    </SourcePanel>
  );

  const renderWorldLayoutLoader = () => (
    <SourcePanel
      icon={Globe}
      title="World"
      description="Paste a world link, or load a folder containing the world layout JSON plus any mesh, splat, or texture assets it references. Public and GitHub file links are supported."
      infoContent={
        <>
          A World is one JSON file describing scene objects, camera(s), and robot pose - plus,
          when a scene needs them, any <code>.glb</code>/<code>.gltf</code>/<code>.stl</code>/
          <code>.dae</code>/<code>.obj</code>/<code>.ply</code> files it references. Pick
          <strong> Local Folder</strong> to load the JSON and its assets together; each asset
          reference resolves by relative path, so nothing needs to be hosted anywhere. Full schema:{" "}
          <code>docs/specs/WORLD_FORMAT.md</code>.
        </>
      }
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
          entries={toRecentLinkEntries(recentWorldLayouts)}
          onLoadEntry={(url) => {
            void loadWorldLayoutFromUrl(url);
          }}
          onRemoveEntry={removeRecentWorldLayout}
          lastLocalLabel={lastLocalWorldLayout}
          onBrowseLocal={() => worldLayoutFileInputRef.current?.click()}
          onClearLocal={clearLastLocalWorldLayout}
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
