import { useRef, useCallback, memo, useState, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/shared/ui/button";
import { buildUrdfOpsBrowserUrl, URDF_OPS_TABS } from "@/shared/config/urdfOpsRoutes";
import { Switch } from "@/shared/ui/switch";
import { Input } from "@/shared/ui/input";
import { FolderUploadRuntimePanel } from "@/features/dataset/FolderUploadRuntimePanel";
import { FolderUploadRobotLoader } from "@/features/dataset/FolderUploadRobotLoader";
import { filterActionableUnmatchedMeshReferences } from "@/features/dataset/candidateMeshWarnings";
import {
  FolderOpen,
  Github,
  Loader2,
  Clock,
  Folder,
  Info,
  Camera,
  Bot,
  Sparkles,
  Redo2,
  Pencil,
  Check,
  Globe,
  Trash2,
  X,
  ArrowRight,
} from "lucide-react";
import { useGPUMode } from "@/shared/hooks/use-gpu-mode";
import { useRecentGitHubRepos } from "@/shared/hooks/use-recent-github-repos";
import { useRecentLinks } from "@/shared/hooks/use-recent-links";
import {
  inspectRepositoryCandidates,
  isXacroPath,
  meshExtensionsDisplay,
  resolveRepositoryXacroTargetPath,
} from "@/shared/lib/urdfCore";
import { normalizeMeshPathForMatch } from "@/shared/lib/urdfBrowser";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import { useFeatureGateAvailability } from "@/shared/lib/featureGateUi";
import { startVisiblePageInterval } from "@/shared/lib/pageVisibility";
import { useGitHubSourceStore } from "@/shared/store/useGitHubSourceStore";
import { toast } from "sonner";
import {
  parseGitHubUrl,
  findURDFCandidates,
  checkCandidatesForUnsupportedFormats,
  type URDFCandidate,
  type GitHubFile,
} from "@/features/urdf/github/githubRepo";
import {
  buildIluGitHubCandidateFileList,
  fetchIluGitHubRepoCandidateSummary,
  fetchIluGitHubRepoFiles,
  fetchIluGitHubRepoCandidates,
  type IluGitHubRepoSource,
} from "@/features/urdf/github/iluGitHubImport";
import {
  getIluGalleryRepoPreview,
  type IluGalleryEntry,
  type IluGalleryPublishedRepo,
} from "@/features/dataset/iluGalleryApi";
import {
  GALLERY_EDITOR_AUTOSTART_QUERY_PARAM,
  GALLERY_EDITOR_AUTOSTART_QUERY_VALUE,
  GALLERY_EDITOR_ENTRY_QUERY_PARAM,
  GALLERY_EDITOR_ENTRY_QUERY_VALUE,
  GALLERY_EDITOR_SOURCE_QUERY_PARAM,
  GALLERY_LOADING_PLACEHOLDER_CARD_COUNT,
} from "@/features/dataset/iluGalleryParams";
import {
  getGalleryRepoMetadataFieldInputValue,
  useIluGalleryEditorState,
} from "@/features/dataset/useIluGalleryEditorState";
import {
  useAssemblyStore,
  type AssemblyRobotInstance,
} from "@/features/assembly/store/useAssemblyStore";
import { parseCameraConfig } from "@/features/camera";
import { normalizeWorldLayoutImportUrl } from "@/features/world-share/sceneImportUrl";
import { API_BASE_URL } from "@/shared/config/runtime";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { useRobotPoseStore } from "@/shared/store/useRobotPoseStore";
import type { WorkspaceMode } from "@/features/workspace/types";
import {
  VISIBLE_FOLDER_UPLOAD_ENTRY_MODE_CONFIGS,
  getFolderUploadEntryModeConfig,
  syncEntryOptionWithWorkspaceMode,
  type FolderUploadEntryOption,
} from "@/features/dataset/folderUploadEntryModes";
import {
  FOLDER_UPLOAD_ROBOT_SHORTCUT_LIST,
  type FolderUploadRobotShortcut,
  type FolderUploadRobotShortcutId,
} from "@/features/dataset/folderUploadRobotShortcuts";
import {
  assignRelativePath,
  buildKitchenGeneratedUrdfFile,
  cloneWithRelativePath,
  collectEntryFiles,
  createFileListFromFiles,
  createOrderedLocalFileList,
  dedupePathsPreserveOrder,
  dedupeUrdfCandidatesByPath,
  deriveSelectedLocalFolder,
  describeKitchenArtifact,
  getLocalRelativePath,
  inferZipRoot,
  normalizeLocalPath,
  reportKitchenArtifactWarnings,
  reportKitchenBuildWarning,
  toLocalGitHubFiles,
  toNamespacedPath,
  upsertKitchenGeneratedUrdfFile,
  type DataTransferItemWithEntry,
  type FileSystemEntryLike,
  type KitchenLocalGeneratedFile,
  type LocalWebkitFile,
  type PreparedLocalRobotSource,
} from "@/features/dataset/folderUploadLocalSources";
import { loadRobotAssetFileListFromManifestUrl } from "@/shared/robotAssets/robotAssetManifest";
import {
  approveRuntimeProviderSession,
  getRuntimeProviderSession,
  getRuntimeSessionStats,
  listRuntimeTelemetryChannels,
  startRuntimeProviderRecording,
  stopRuntimeProviderRecording,
  TelemetryStreamKind,
  type RuntimeProviderSessionSnapshot,
  type RuntimeSessionStatsResponse,
  type TelemetryChannelSnapshot,
} from "@/runtime_engine/runtime_contract";
import { sendButterClawChatCommand } from "@/studio_ui/runtimeviz/butterclawApi";
import {
  proveVerifiableRoboticsExecution,
  type VerifiableRoboticsProofResponse,
  type VerifiableRoboticsPositionSample,
} from "@/studio_ui/runtimeviz/verifiableRoboticsApi";
import {
  isRuntimeDemoEnabled,
  type RuntimeDemoSpeedMode,
} from "@/studio_ui/runtimeviz/runtimeRobotPreviewParams";
import {
  RUNTIME_DEMO_DEFAULT_RESTRICTED_AREA_IDS,
  RUNTIME_DEMO_OBJECTS,
  RUNTIME_DEMO_RESTRICTED_AREAS,
  findRuntimeDemoRestrictedArea,
  getRuntimeDemoRestrictedRegions,
  type RuntimeDemoRestrictedAreaId,
} from "@/studio_ui/runtimeviz/runtimeDemoScene";
import {
  allowAttestationConnection,
  fetchAttestationStatuses,
  type AttestationStatusPayload,
} from "@/studio_ui/attestation/attestationApi";
import {
  isResetRuntimeTraceMessage,
  isRuntimePoseSampleMessage,
} from "@/shared/contracts/previewBridge";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { buildRuntimeConnectionTargets } from "@/features/dataset/runtimeConnectionTargets";
import {
  buildRuntimeAdapterFamilies,
  buildRuntimeAdapterStatus,
  buildRuntimeStatsAuditSnapshot,
} from "@/features/dataset/runtimeReviewHelpers";
import { buildSubstitutionWorkspaceLaunchPlan } from "@/features/dataset/substitutionWorkspace";
import {
  assignSubstitutionTarget,
  clearSubstitutionTarget,
  createEmptySubstitutionAssignments,
  pruneSubstitutionAssignments,
  type SubstitutionAssignments,
  type SubstitutionTarget,
} from "@/features/dataset/substitutionAssignments";
import {
  GALLERY_REPO_METADATA_VISIBLE_FIELDS,
  type GalleryRepoMetadataField,
} from "@/features/dataset/galleryRepoMetadataFields";
import {
  buildGalleryRobotAttentionNotes,
  buildGalleryRobotLimbLine,
  buildGalleryRobotMacroTag,
  buildGalleryRobotStructureLine,
} from "@/features/dataset/galleryRobotTraits";
import {
  resolveGalleryEntryGenerateAction,
  resolveGalleryEntryMediaState,
} from "@/features/dataset/galleryEntryMedia";
import {
  buildGitHubCandidateDialogCopy,
  formatGitHubCandidateSourceLabel,
} from "@/features/dataset/githubCandidateSelection";
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem,
} from "@/shared/lib/browserStorage";

interface FolderUploadScreenProps {
  onFolderSelected: (
    files: FileList,
    options?: { preserveCameras?: boolean }
  ) => void | Promise<void>;
  onPlayDemoMotion?: () => void;
  onImportWorldLayout?: (worldLayoutUrl: string) => Promise<void>;
  onWorkspaceModeChange?: (mode: WorkspaceMode) => void;
  onOpenTrainingMode?: () => void;
  workspaceMode?: WorkspaceMode;
}

const readStoredString = (storageKey: string, fallback = ""): string => {
  if (typeof window === "undefined") return fallback;
  return readBrowserStorageItem(storageKey) || fallback;
};

const readStoredOptionalString = (storageKey: string): string | null => {
  if (typeof window === "undefined") return null;
  return readBrowserStorageItem(storageKey);
};

const usePersistedStringState = (storageKey: string, fallback = "") => {
  const [value, setValue] = useState<string>(() => readStoredString(storageKey, fallback));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const normalized = value.trim();
    if (normalized.length > 0) {
      writeBrowserStorageItem(storageKey, normalized);
      return;
    }
    removeBrowserStorageItem(storageKey);
  }, [storageKey, value]);

  return [value, setValue] as const;
};

const usePersistedOptionalStringState = (storageKey: string) => {
  const [value, setValue] = useState<string | null>(() => readStoredOptionalString(storageKey));

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (value) {
      writeBrowserStorageItem(storageKey, value);
      return;
    }
    removeBrowserStorageItem(storageKey);
  }, [storageKey, value]);

  return [value, setValue] as const;
};

const clearPersistedStringState = (
  storageKey: string,
  setValue: Dispatch<SetStateAction<string | null>>
) => {
  setValue(null);
  if (typeof window !== "undefined") {
    removeBrowserStorageItem(storageKey);
  }
};

const resolveGalleryEntrySourceFile = (entry: IluGalleryEntry): string =>
  entry.sourceFile || (entry.urdfPath || entry.id).split("/").pop() || entry.id;

const resolveGalleryEntrySourcePath = (entry: IluGalleryEntry): string =>
  entry.urdfPath || entry.id;

const RUNTIME_COMMAND_SUGGESTIONS = [
  "/scan",
  "/trajectory",
  "/restricted-area",
  "/speed",
  "/prove-safety",
  "/rotate",
  "/move",
  "/stop",
  "/status",
] as const;

const ROBOT_GALLERY_URL = "https://www.urdfstudio.com/robots";
const WORLD_LAYOUT_GALLERY_URL = "https://www.urdfstudio.com/world-layouts";
const RECENT_WORLD_LAYOUTS_STORAGE_KEY = "urdfstudio:recent-world-layouts";
const RECENT_CAMERA_CONFIGS_STORAGE_KEY = "urdfstudio:recent-camera-configs";
const LAST_WORLD_LAYOUT_URL_STORAGE_KEY = "urdfstudio:last-world-layout-url";
const LAST_CAMERA_CONFIG_URL_STORAGE_KEY = "urdfstudio:last-camera-config-url";
const RUNTIME_SESSION_ID_STORAGE_KEY = "urdfstudio:runtime-session-id";
const RUNTIME_SESSION_TOKEN_STORAGE_KEY = "urdfstudio:runtime-session-token";
const RUNTIME_ROBOT_ID_STORAGE_KEY = "urdfstudio:runtime-robot-id";
const RUNTIME_TELEMETRY_POLL_INTERVAL_MS = 1000;
const MAX_ASSEMBLY_ROBOTS = 5;
const SETUP_ENTRY_WIDE_CONTAINER_CLASS = "max-w-7xl space-y-6";
const SETUP_ENTRY_PRIMARY_GRID_CLASS =
  "grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] xl:items-start";
const SETUP_ENTRY_STACK_CLASS = "space-y-4";

const clearPersistedRuntimeSessionToken = (): void => {
  if (typeof window === "undefined") return;
  removeBrowserStorageItem(RUNTIME_SESSION_TOKEN_STORAGE_KEY);
  removeBrowserStorageItem(RUNTIME_SESSION_TOKEN_STORAGE_KEY, "session");
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

type AssemblyQueuedSelection = {
  id: string;
  name: string;
  sourcePrefix: string;
  namespacedUrdfPath: string;
  source:
    | (GitHubSourceInfo & {
        type: "github";
        url?: string;
        files: GitHubFile[];
        candidatePath: string;
      })
    | {
        type: "local";
        folderLabel?: string | null;
        localFiles: File[];
        candidatePath: string;
      };
};

type AssemblyQueuedSelectionPreview = {
  id: string;
  name: string;
  sourceKey: string;
  sourceLabel: string;
  source:
    | {
        type: "github";
        owner: string;
        repo: string;
      }
    | {
        type: "local";
      };
};

type AssemblySourceCard = {
  sourceKey: string;
  sourceLabel: string;
  candidates: URDFCandidate[];
  source:
    | (GitHubSourceInfo & {
        type: "github";
        files: GitHubFile[];
        url: string;
      })
    | {
        type: "local";
        folderLabel?: string | null;
        files: File[];
      };
};

type CandidateSourceContext =
  | (GitHubSourceInfo & {
      type: "github";
      files: GitHubFile[];
    })
  | {
      type: "local";
      files: File[];
    };

const getAssemblySourceKey = (selection: AssemblyQueuedSelection): string => {
  if (selection.source.type === "github") {
    return `github/${selection.source.owner}/${selection.source.repo}/${selection.source.branch || "default"}/${selection.source.path || "root"}`;
  }
  return `local/${selection.source.folderLabel || "folder"}`;
};

const getAssemblyQueuedSelectionSourceLabel = (selection: AssemblyQueuedSelection): string =>
  selection.source.type === "github"
    ? `${selection.source.owner}/${selection.source.repo}${selection.source.path ? `/${selection.source.path}` : ""}`
    : selection.source.folderLabel || "Local folder";

const getAssemblyQueuedSelectionSourceContext = (
  selection: AssemblyQueuedSelection
): CandidateSourceContext =>
  selection.source.type === "github"
    ? {
        type: "github",
        owner: selection.source.owner,
        repo: selection.source.repo,
        path: selection.source.path,
        branch: selection.source.branch,
        files: selection.source.files,
      }
    : {
        type: "local",
        files: selection.source.localFiles,
      };

const sanitizePathToken = (value: string, fallback: string): string => {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^-+|-+$/g, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/-+/g, "-");
  return normalized || fallback;
};

type GitHubSourceInfo = {
  owner: string;
  repo: string;
  path?: string;
  branch?: string;
};

const ASSEMBLY_SUMMARY_CARD_CLASS =
  "space-y-3 rounded-lg border border-border bg-background/40 p-4";

export const FolderUploadScreen = memo(
  ({
    onFolderSelected,
    onPlayDemoMotion,
    onImportWorldLayout,
    onWorkspaceModeChange,
    onOpenTrainingMode,
    workspaceMode = "studio",
  }: FolderUploadScreenProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localFilesInputRef = useRef<HTMLInputElement>(null);
  const worldLayoutFileInputRef = useRef<HTMLInputElement>(null);
  const cameraConfigFileInputRef = useRef<HTMLInputElement>(null);
  const galleryEditorDeepLinkHandledRef = useRef(false);
  const { gpuMode, setGPUMode } = useGPUMode();
  const requestInitialRobotPose = useRobotPoseStore((state) => state.requestInitialPose);
  const { recentRepos, addRecentRepo, removeRecentRepo } = useRecentGitHubRepos();
  const buildGitHubRepoUrl = useCallback(
    (params: { owner: string; repo: string; path?: string; branch?: string }): string => {
      const { owner, repo, path, branch } = params;
      if (path) {
        return `https://github.com/${owner}/${repo}/tree/${branch || "HEAD"}/${path}`;
      }
      if (branch) {
        return `https://github.com/${owner}/${repo}/tree/${branch}`;
      }
      return `https://github.com/${owner}/${repo}`;
    },
    []
  );
  const {
    activeGenerateEntryId: activeGalleryGenerateEntryId,
    activeGalleryEntryLoadId,
    activeInlineEditorId: galleryActiveInlineEditorId,
    clearEntrySelection: clearGalleryEntrySelection,
    discardItemTitleDraft: discardGalleryItemTitleDraft,
    downloadBundle: handleDownloadGalleryBundle,
    entries: galleryEntries,
    entriesError: galleryEntriesError,
    generateAssets: handleGenerateGalleryAssets,
    generateEntryAssets: handleGenerateGalleryEntryAssets,
    generationButtonLabel: galleryGenerationButtonLabel,
    generationCompleted: galleryGenerationCompleted,
    generationInFlight: galleryGenerationInFlight,
    generationProgressLabel: galleryGenerationProgressLabel,
    githubUrl: galleryGithubUrl,
    hasPendingPublishChanges: galleryHasPendingPublishChanges,
    inspectionElapsedLabel: galleryElapsedLabel,
    isEditingMetadata: isEditingGalleryMetadata,
    isLoadingPublishPreview: isLoadingGalleryPublishPreview,
    isPublishingPr: isPublishingGalleryPr,
    isSavingMetadata: isSavingGalleryMetadata,
    isStudioEntryLoadInFlight,
    itemTitleDrafts: galleryItemTitleDrafts,
    job: galleryJob,
    keepItemTitleDraft: keepGalleryItemTitleDraft,
    loadingVisible: isGalleryLoadingVisible,
    mediaCounts: galleryMediaCounts,
    metadataDirty: galleryMetadataDirty,
    missingMediaEntries: galleryMissingMediaEntries,
    missingTargets: galleryMissingTargets,
    pendingPublishState: galleryPendingPublishState,
    publishPr: handlePublishGalleryPr,
    publishPreview: galleryPublishPreview,
    publishPreviewFilePaths: galleryPublishPreviewFilePaths,
    publishedPr: galleryPublishedPr,
    repoMetadataDraft: galleryRepoMetadataDraft,
    repoNotCataloged: galleryRepoNotCataloged,
    saveMetadata: handleSaveGalleryMetadata,
    selectAllEntries: selectAllGalleryEntries,
    selectMissingEntries: selectMissingGalleryEntries,
    selectedEntries: gallerySelectedEntries,
    selectedEntryIds: gallerySelectedEntryIds,
    selectedTargets: gallerySelectedTargets,
    setEditingMetadata: setGalleryMetadataEditing,
    setGithubUrl: setGalleryGithubUrl,
    setItemTitleDraft: setGalleryItemTitleDraft,
    showSlowNotice: showGallerySlowNotice,
    sourceBusy: isGallerySourceBusy,
    sourceLabel: gallerySourceLabel,
    startInlineEditor: startGalleryInlineEditor,
    startInspectionJob: startGalleryInspectionJob,
    statusLabel: galleryStatusLabel,
    toggleEditingMetadata: toggleGalleryMetadataEditing,
    toggleEntrySelection: toggleGalleryEntrySelection,
    updateRepoMetadataDraftField: updateGalleryRepoMetadataDraftField,
    withStudioEntryLoad,
  } = useIluGalleryEditorState({ addRecentRepo, buildGitHubRepoUrl });
  const {
    recentLinks: recentWorldLayouts,
    addRecentLink: addRecentWorldLayout,
    removeRecentLink: removeRecentWorldLayout,
  } = useRecentLinks({
    storageKey: RECENT_WORLD_LAYOUTS_STORAGE_KEY,
    maxItems: 3,
  });
  const {
    recentLinks: recentCameraConfigs,
    addRecentLink: addRecentCameraConfig,
    removeRecentLink: removeRecentCameraConfig,
  } = useRecentLinks({
    storageKey: RECENT_CAMERA_CONFIGS_STORAGE_KEY,
    maxItems: 3,
  });
  const setGitHubSource = useGitHubSourceStore((state) => state.setSource);
  const clearGitHubSource = useGitHubSourceStore((state) => state.clearSource);
  const cameras = useCameraStore((state) => state.cameras);
  const loadCameras = useCameraStore((state) => state.loadCameras);
  const clearCameras = useCameraStore((state) => state.clearCameras);
  const removeCamera = useCameraStore((state) => state.removeCamera);
  const [githubUrl, setGithubUrl] = useState("");
  const [isLoadingGithub, setIsLoadingGithub] = useState(false);
  const [loadingRobotShortcutId, setLoadingRobotShortcutId] =
    useState<FolderUploadRobotShortcutId | null>(null);
  const [urdfCandidates, setUrdfCandidates] = useState<URDFCandidate[]>([]);
  const [studioCandidateGalleryPreviewByPath, setStudioCandidateGalleryPreviewByPath] = useState<Record<string, IluGalleryEntry>>({});
  const [studioCandidateGalleryPublishedRepo, setStudioCandidateGalleryPublishedRepo] =
    useState<IluGalleryPublishedRepo | null>(null);
  const [isLoadingStudioCandidateGalleryPreview, setIsLoadingStudioCandidateGalleryPreview] = useState(false);
  const [showUrdfDialog, setShowUrdfDialog] = useState(false);
  const [candidateDialogTitle, setCandidateDialogTitle] = useState<string | null>(null);
  const [candidateDialogDescription, setCandidateDialogDescription] = useState<string | null>(null);
  const [fetchedFiles, setFetchedFiles] = useState<GitHubFile[]>([]);
  const [localSelectionFiles, setLocalSelectionFiles] = useState<File[] | null>(null);
  const [repoInfo, setRepoInfo] = useState<GitHubSourceInfo | null>(null);
  const xacroGate = useFeatureGateAvailability(FEATURE_GATES.xacroExpansion);
  const xacroGateUnavailableMessage = `${xacroGate.unavailableSuffix}. ${xacroGate.unavailableReason}`;
  const githubLoadButtonDisabled = isLoadingGithub || !githubUrl.trim();
  const githubLoadButtonLabel = isLoadingGithub ? "Loading..." : "Load";
  const [entryOption, setEntryOption] = useState<FolderUploadEntryOption>(() =>
    syncEntryOptionWithWorkspaceMode("studio", workspaceMode)
  );
  const leaveGalleryEditorMode = useCallback((): void => {
    setEntryOption("studio");
    setGalleryMetadataEditing(false);

    if (typeof window === "undefined") {
      return;
    }

    const nextUrl = new URL(window.location.href);
    const previousSearch = nextUrl.search;
    nextUrl.searchParams.delete(GALLERY_EDITOR_ENTRY_QUERY_PARAM);
    nextUrl.searchParams.delete(GALLERY_EDITOR_SOURCE_QUERY_PARAM);
    nextUrl.searchParams.delete(GALLERY_EDITOR_AUTOSTART_QUERY_PARAM);

    if (nextUrl.search !== previousSearch) {
      window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    }
  }, [setGalleryMetadataEditing]);
  const [runtimeSessionId, setRuntimeSessionId] = usePersistedStringState(
    RUNTIME_SESSION_ID_STORAGE_KEY,
    "default"
  );
  const [runtimeSessionToken, setRuntimeSessionToken] = useState<string>(() => {
    return "";
  });
  const [runtimeRobotId, setRuntimeRobotId] = usePersistedStringState(
    RUNTIME_ROBOT_ID_STORAGE_KEY,
    "my_kiwi"
  );
  const [runtimeTelemetryChannels, setRuntimeTelemetryChannels] = useState<TelemetryChannelSnapshot[]>([]);
  const [runtimeListError, setRuntimeListError] = useState<string | null>(null);
  const [runtimeBackendStats, setRuntimeBackendStats] = useState<RuntimeSessionStatsResponse | null>(null);
  const [runtimeProviderSession, setRuntimeProviderSession] =
    useState<RuntimeProviderSessionSnapshot | null>(null);
  const [runtimeProviderError, setRuntimeProviderError] = useState<string | null>(null);
  const [, setIsRefreshingRuntimeProvider] = useState(false);
  const [isApprovingRuntimeProvider, setIsApprovingRuntimeProvider] = useState(false);
  const [isTogglingRuntimeProviderRecording, setIsTogglingRuntimeProviderRecording] =
    useState(false);
  const [isRefreshingRuntimeTelemetry, setIsRefreshingRuntimeTelemetry] = useState(false);
  const [runtimeAttestationStatuses, setRuntimeAttestationStatuses] = useState<AttestationStatusPayload[]>([]);
  const [runtimeAttestationError, setRuntimeAttestationError] = useState<string | null>(null);
  const [isRefreshingRuntimeAttestation, setIsRefreshingRuntimeAttestation] = useState(false);
  const [runtimeCommandText, setRuntimeCommandText] = useState("");
  const [isSendingRuntimeCommand, setIsSendingRuntimeCommand] = useState(false);
  const [runtimeCommandMessages, setRuntimeCommandMessages] = useState<string[]>([]);
  const [runtimeCommandError, setRuntimeCommandError] = useState<string | null>(null);
  const [runtimeRestrictedAreaIds, setRuntimeRestrictedAreaIds] = useState<RuntimeDemoRestrictedAreaId[]>([]);
  const [runtimeDemoSpeedMode, setRuntimeDemoSpeedMode] = useState<RuntimeDemoSpeedMode>("normal");
  const [runtimeTraceSamples, setRuntimeTraceSamples] = useState<VerifiableRoboticsPositionSample[]>([]);
  const [isProvingRuntimeSafety, setIsProvingRuntimeSafety] = useState(false);
  const [runtimeProofError, setRuntimeProofError] = useState<string | null>(null);
  const [runtimeProofResult, setRuntimeProofResult] = useState<VerifiableRoboticsProofResponse | null>(null);
  const [runtimeProofElapsedMs, setRuntimeProofElapsedMs] = useState(0);
  const [runtimeLastTrajectoryTarget, setRuntimeLastTrajectoryTarget] = useState<string | null>(null);
  const runtimeTraceStartRef = useRef<number | null>(null);
  const runtimeLastTracePointRef = useRef<{ x: number; y: number; tMs: number } | null>(null);
  const runtimeProofStartedAtRef = useRef<number | null>(null);
  const runtimeDemoDefaultsAppliedRef = useRef(false);
  const studioCandidateGalleryPreviewRequestIdRef = useRef(0);
  const [selectedCandidatePaths, setSelectedCandidatePaths] = useState<string[]>([]);
  const [assemblyQueuedSelections, setAssemblyQueuedSelections] = useState<AssemblyQueuedSelection[]>([]);
  const [assemblySources, setAssemblySources] = useState<AssemblySourceCard[]>([]);
  const [activeAssemblySourceKey, setActiveAssemblySourceKey] = useState<string | null>(null);
  const [substitutionAssignments, setSubstitutionAssignments] = useState<SubstitutionAssignments>(
    createEmptySubstitutionAssignments
  );
  const assemblyQueuedSelectionPreviews = useMemo<AssemblyQueuedSelectionPreview[]>(
    () =>
      assemblyQueuedSelections.map((selection) => ({
        id: selection.id,
        name: selection.name,
        sourceKey: getAssemblySourceKey(selection),
        sourceLabel: getAssemblyQueuedSelectionSourceLabel(selection),
        source:
          selection.source.type === "github"
            ? {
                type: "github",
                owner: selection.source.owner,
                repo: selection.source.repo,
              }
            : {
                type: "local",
              },
      })),
    [assemblyQueuedSelections]
  );
  const substitutionQueuedSelections = useMemo<Record<SubstitutionTarget, AssemblyQueuedSelection | null>>(
    () => ({
      host:
        assemblyQueuedSelections.find((selection) => selection.id === substitutionAssignments.host) ||
        null,
      element:
        assemblyQueuedSelections.find((selection) => selection.id === substitutionAssignments.element) ||
        null,
    }),
    [assemblyQueuedSelections, substitutionAssignments.element, substitutionAssignments.host]
  );
  const [stagedSetupRobot, setStagedSetupRobot] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const entryMode = getFolderUploadEntryModeConfig(entryOption);
  const normalizedRuntimeSessionId = runtimeSessionId.trim();
  const normalizedRuntimeSessionToken = runtimeSessionToken.trim();
  const normalizedRuntimeRobotId = runtimeRobotId.trim();
  const runtimeDemoEnabled = useMemo(
    () =>
      entryMode.isRuntime ||
      (typeof window !== "undefined" ? isRuntimeDemoEnabled(window.location.search) : false),
    [entryMode.isRuntime]
  );
  const runtimeDemoObjectLabels = useMemo(
    () => Array.from(new Set(RUNTIME_DEMO_OBJECTS.map((object) => object.class_label))),
    []
  );
  const runtimeDemoRestrictedAreaLabels = useMemo(
    () => RUNTIME_DEMO_RESTRICTED_AREAS.map((area) => area.label),
    []
  );
  const runtimeDemoSpeedLabels = useMemo(() => ["slow", "normal", "fast"] as const, []);

  useEffect(() => {
    if (!runtimeDemoEnabled) {
      runtimeDemoDefaultsAppliedRef.current = false;
      return;
    }
    if (runtimeDemoDefaultsAppliedRef.current) {
      return;
    }
    setRuntimeRestrictedAreaIds([...RUNTIME_DEMO_DEFAULT_RESTRICTED_AREA_IDS]);
    runtimeDemoDefaultsAppliedRef.current = true;
  }, [runtimeDemoEnabled]);

  const clearRuntimeProofState = useCallback(() => {
    setRuntimeProofResult(null);
    setRuntimeProofError(null);
  }, []);
  const clearRuntimeCommandComposer = useCallback(() => {
    setRuntimeCommandError(null);
    setRuntimeCommandText("");
  }, []);
  const applyRuntimeCommandMessages = useCallback(
    (messages: string[]) => {
      setRuntimeCommandMessages(messages);
      clearRuntimeCommandComposer();
    },
    [clearRuntimeCommandComposer]
  );
  const resetRuntimeTraceEpisode = useCallback(() => {
    runtimeTraceStartRef.current = null;
    runtimeLastTracePointRef.current = null;
    setRuntimeTraceSamples([]);
    clearRuntimeProofState();
  }, [clearRuntimeProofState]);
  const resetRuntimeTraceWithMessages = useCallback(
    (messages: string[]) => {
      resetRuntimeTraceEpisode();
      applyRuntimeCommandMessages(messages);
    },
    [applyRuntimeCommandMessages, resetRuntimeTraceEpisode]
  );
  const computeRuntimeProofWorkspace = useCallback(() => {
    const margin = 0.6;
    const demoXs = runtimeDemoEnabled ? RUNTIME_DEMO_OBJECTS.map((object) => object.position_xyz[0]) : [];
    const demoYs = runtimeDemoEnabled ? RUNTIME_DEMO_OBJECTS.map((object) => object.position_xyz[1]) : [];
    const sampleXs = runtimeTraceSamples.map((sample) => sample.x);
    const sampleYs = runtimeTraceSamples.map((sample) => sample.y);
    const restrictedRegions = getRuntimeDemoRestrictedRegions(runtimeRestrictedAreaIds);
    const xs = [
      ...sampleXs,
      ...demoXs,
      ...restrictedRegions.flatMap((region) => [region.xmin, region.xmax]),
      0,
    ];
    const ys = [
      ...sampleYs,
      ...demoYs,
      ...restrictedRegions.flatMap((region) => [region.ymin, region.ymax]),
      0,
    ];
    return {
      min_x: Math.min(...xs) - margin,
      max_x: Math.max(...xs) + margin,
      min_y: Math.min(...ys) - margin,
      max_y: Math.max(...ys) + margin,
    };
  }, [runtimeDemoEnabled, runtimeRestrictedAreaIds, runtimeTraceSamples]);
  const runtimeProofPhase = useMemo(() => {
    if (!isProvingRuntimeSafety) {
      return null;
    }
    if (runtimeProofElapsedMs < 1500) {
      return "Preparing trace and public safety policy...";
    }
    if (runtimeProofElapsedMs < 5000) {
      return "Launching SP1 runtime and checking the execution trace...";
    }
    if (runtimeProofElapsedMs < 15000) {
      return "Generating zero-knowledge proof...";
    }
    return "Finalizing proof and verification report...";
  }, [isProvingRuntimeSafety, runtimeProofElapsedMs]);
  const runtimeProofProgressPercent = useMemo(() => {
    if (!isProvingRuntimeSafety) {
      return 0;
    }
    return Math.min(96, 12 + Math.round((runtimeProofElapsedMs / 22000) * 84));
  }, [isProvingRuntimeSafety, runtimeProofElapsedMs]);
  const compactContainerClass = entryOption === "gallery"
    ? "max-w-screen-2xl space-y-6"
    : entryMode.isCompact
      ? "max-w-6xl space-y-3"
      : entryMode.showWorldLoader && entryMode.showCameraLoader
        ? SETUP_ENTRY_WIDE_CONTAINER_CLASS
        : "max-w-2xl space-y-6";
  const setAssemblySelectedUrdfPaths = useAssemblyStore((state) => state.setSelectedUrdfPaths);
  const clearAssemblySelection = useAssemblyStore((state) => state.clear);
  const [worldLayoutUrl, setWorldLayoutUrl] = usePersistedStringState(
    LAST_WORLD_LAYOUT_URL_STORAGE_KEY
  );
  const [isLoadingWorldLayout, setIsLoadingWorldLayout] = useState(false);
  const [loadedWorldLayoutName, setLoadedWorldLayoutName] = useState<string | null>(null);
  const [cameraConfigUrl, setCameraConfigUrl] = usePersistedStringState(
    LAST_CAMERA_CONFIG_URL_STORAGE_KEY
  );
  const [isLoadingCameraConfig, setIsLoadingCameraConfig] = useState(false);
  const [loadedRobotName, setLoadedRobotName] = useState<string | null>(null);
  const [worldSourceDropActive, setWorldSourceDropActive] = useState(false);
  const [cameraSourceDropActive, setCameraSourceDropActive] = useState(false);
  const [lastLocalWorldLayout, setLastLocalWorldLayout] = usePersistedOptionalStringState(
    "urdfstudio:lastLocalWorldLayout"
  );

  // Last uploaded local folder
  const [lastLocalFolder, setLastLocalFolder] = usePersistedOptionalStringState(
    "urdfstudio:lastLocalFolder"
  );
  const [robotSourceDropActive, setRobotSourceDropActive] = useState(false);
  const [isPreparingDroppedRobotSource, setIsPreparingDroppedRobotSource] = useState(false);
  const [lastLocalCameraConfig, setLastLocalCameraConfig] = usePersistedOptionalStringState(
    "urdfstudio:lastLocalCameraConfig"
  );

  useEffect(() => {
    clearPersistedRuntimeSessionToken();
  }, []);

  useEffect(() => {
    clearPersistedRuntimeSessionToken();
  }, [normalizedRuntimeSessionToken]);

  useEffect(() => {
    const availableSelectionIds = new Set(assemblyQueuedSelections.map((selection) => selection.id));
    setSubstitutionAssignments((current) => {
      const next = pruneSubstitutionAssignments(current, availableSelectionIds);
      return next.host === current.host && next.element === current.element ? current : next;
    });
  }, [assemblyQueuedSelections]);

  const clearLastLocalFolder = useCallback(() => {
    clearPersistedStringState("urdfstudio:lastLocalFolder", setLastLocalFolder);
  }, [setLastLocalFolder]);

  const clearLastLocalWorldLayout = useCallback(() => {
    clearPersistedStringState("urdfstudio:lastLocalWorldLayout", setLastLocalWorldLayout);
  }, [setLastLocalWorldLayout]);
  const clearLastLocalCameraConfig = useCallback(() => {
    clearPersistedStringState("urdfstudio:lastLocalCameraConfig", setLastLocalCameraConfig);
  }, [setLastLocalCameraConfig]);
  const clearSelectedCandidatePaths = useCallback(() => {
    setSelectedCandidatePaths([]);
  }, []);
  const clearStudioCandidateGalleryPreview = useCallback(() => {
    studioCandidateGalleryPreviewRequestIdRef.current += 1;
    setStudioCandidateGalleryPreviewByPath({});
    setStudioCandidateGalleryPublishedRepo(null);
    setIsLoadingStudioCandidateGalleryPreview(false);
  }, []);
  const closeUrdfSelectionDialog = useCallback(
    (options?: { clearSelection?: boolean }) => {
      setShowUrdfDialog(false);
      setCandidateDialogTitle(null);
      setCandidateDialogDescription(null);
      clearStudioCandidateGalleryPreview();
      if (options?.clearSelection) {
        clearSelectedCandidatePaths();
      }
    },
    [clearSelectedCandidatePaths, clearStudioCandidateGalleryPreview]
  );
  const setGitHubSelectionSource = useCallback(
    (nextRepoInfo: GitHubSourceInfo | null, nextFiles: GitHubFile[]) => {
      setRepoInfo(nextRepoInfo);
      setFetchedFiles(nextFiles);
      setLocalSelectionFiles(null);
    },
    []
  );
  const clearGitHubSelectionSource = useCallback(() => {
    setRepoInfo(null);
    setFetchedFiles([]);
  }, []);
  const setLocalSelectionSource = useCallback(
    (localFiles: File[] | null) => {
      clearGitHubSelectionSource();
      setLocalSelectionFiles(localFiles);
    },
    [clearGitHubSelectionSource]
  );
  const withGitHubLoading = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setIsLoadingGithub(true);
    try {
      return await action();
    } finally {
      setIsLoadingGithub(false);
    }
  }, []);
  const withRobotShortcutLoading = useCallback(async <T,>(
    shortcutId: FolderUploadRobotShortcutId,
    action: () => Promise<T>
  ): Promise<T> => {
    setLoadingRobotShortcutId(shortcutId);
    try {
      return await action();
    } finally {
      setLoadingRobotShortcutId(null);
    }
  }, []);
  const withWorldLayoutLoading = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setIsLoadingWorldLayout(true);
    try {
      return await action();
    } finally {
      setIsLoadingWorldLayout(false);
    }
  }, []);
  const withCameraConfigLoading = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setIsLoadingCameraConfig(true);
    try {
      return await action();
    } finally {
      setIsLoadingCameraConfig(false);
    }
  }, []);

  const prepareZipRobotSource = useCallback(async (zipFile: File): Promise<PreparedLocalRobotSource> => {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(zipFile);
    const extractedFiles: File[] = [];
    const zipEntries = Object.values(zip.files).filter((entry) => !entry.dir);
    for (const entry of zipEntries) {
      const blob = await entry.async("blob");
      const fileName = entry.name.split("/").filter(Boolean).pop() || zipFile.name.replace(/\.zip$/i, "");
      const extracted = new File([blob], fileName, {
        type: blob.type || "application/octet-stream",
        lastModified: zipFile.lastModified,
      });
      extractedFiles.push(assignRelativePath(extracted, entry.name));
    }
    return {
      files: extractedFiles,
      sourceOrigin: "zip",
      sourceLabel: inferZipRoot(zipEntries.map((entry) => entry.name)) || zipFile.name,
    };
  }, []);

  const collectDroppedRobotFiles = useCallback(async (event: React.DragEvent<HTMLElement>): Promise<File[]> => {
    const itemEntries = Array.from(event.dataTransfer.items ?? [])
      .map((item) => (item as DataTransferItemWithEntry).webkitGetAsEntry?.() ?? null)
      .filter(Boolean) as FileSystemEntryLike[];
    if (itemEntries.length > 0) {
      const nestedFiles = await Promise.all(itemEntries.map((entry) => collectEntryFiles(entry)));
      return nestedFiles.flat();
    }
    return Array.from(event.dataTransfer.files ?? []);
  }, []);

  useEffect(() => {
    if (!entryMode.isAssembly) {
      setAssemblyQueuedSelections([]);
      setAssemblySources([]);
      setActiveAssemblySourceKey(null);
      setSelectedCandidatePaths([]);
      clearAssemblySelection();
      return;
    }
    setStagedSetupRobot(null);
  }, [clearAssemblySelection, entryMode.isAssembly]);

  useEffect(() => {
    onWorkspaceModeChange?.(entryMode.workspaceMode);
  }, [entryMode.workspaceMode, onWorkspaceModeChange]);

  useEffect(() => {
    setEntryOption((current) =>
      syncEntryOptionWithWorkspaceMode(current, workspaceMode)
    );
  }, [workspaceMode]);

  const entryLoadInteractionsDisabled =
    isStudioEntryLoadInFlight ||
    isLoadingGithub ||
    loadingRobotShortcutId !== null ||
    isLoadingWorldLayout ||
    isLoadingCameraConfig ||
    isPreparingDroppedRobotSource;

  const checkLocalCandidatesForUnsupportedFormats = useCallback(
    async (candidates: URDFCandidate[], localFiles: File[]): Promise<URDFCandidate[]> => {
      const localGitHubFiles = toLocalGitHubFiles(localFiles);
      const localFileMap = new Map<string, File>();
      localFiles.forEach((file) => {
        localFileMap.set(getLocalRelativePath(file).toLowerCase(), file);
      });
      try {
        const inspected = await inspectRepositoryCandidates(
          candidates,
          localGitHubFiles,
          async (_candidate, file) => {
            const localFile = localFileMap.get(file.path.toLowerCase());
            if (!localFile) {
              throw new Error(`Local file not found for candidate: ${file.path}`);
            }
            return localFile.text();
          }
        );
        return inspected.map((candidate) =>
          candidate.isXacro
            ? {
                ...candidate,
                hasUnsupportedFormats: false,
                unsupportedFormats: undefined,
                unmatchedMeshReferences: undefined,
              }
            : candidate
        );
      } catch {
        return candidates;
      }
    },
    []
  );

  const mergeGitHubCandidateDiagnostics = useCallback((diagnostics: URDFCandidate[]): void => {
    if (diagnostics.length === 0) return;
    const byPath = new Map(
      diagnostics.map((candidate) => [normalizeLocalPath(candidate.path), candidate] as const)
    );
    setUrdfCandidates((current) =>
      current.map((candidate) => byPath.get(normalizeLocalPath(candidate.path)) ?? candidate)
    );
  }, []);

  const upsertAssemblySource = useCallback((nextSource: AssemblySourceCard) => {
    setAssemblySources((current) => {
      const existingIndex = current.findIndex((source) => source.sourceKey === nextSource.sourceKey);
      if (existingIndex === -1) {
        return [...current, nextSource];
      }
      const next = [...current];
      next[existingIndex] = nextSource;
      return next;
    });
  }, []);

  const ensureGitHubCandidateDiagnostics = useCallback(
    async (
      candidate: URDFCandidate,
      files: GitHubFile[],
      source: GitHubSourceInfo
    ): Promise<URDFCandidate> => {
      if (
        candidate.isXacro ||
        candidate.hasUnsupportedFormats !== undefined ||
        candidate.unmatchedMeshReferences !== undefined
      ) {
        return candidate;
      }

      const inspected = await checkCandidatesForUnsupportedFormats(
        [candidate],
        files,
        source.owner,
        source.repo,
        undefined,
        { maxCandidatesToInspect: 1, concurrency: 1 }
      );
      const nextCandidate = inspected[0] ?? candidate;
      mergeGitHubCandidateDiagnostics([nextCandidate]);
      return nextCandidate;
    },
    [mergeGitHubCandidateDiagnostics]
  );

  const handleButtonClick = useCallback((): void => {
    fileInputRef.current?.click();
  }, []);

  const handleLocalFilesButtonClick = useCallback((): void => {
    localFilesInputRef.current?.click();
  }, []);

  const handleGPUModeToggle = useCallback((checked: boolean): void => {
    setGPUMode(checked ? "high" : "low");
  }, [setGPUMode]);

  const handlePlayDemoMotionClick = useCallback(() => {
    if (!onPlayDemoMotion) return;
    onPlayDemoMotion();
  }, [onPlayDemoMotion]);

  const handleRefreshRuntimeTelemetry = useCallback(
    async (options?: { silent?: boolean }): Promise<void> => {
      if (!normalizedRuntimeSessionId) {
        setRuntimeTelemetryChannels([]);
        setRuntimeBackendStats(null);
        setRuntimeListError("Set a runtime session ID to load telemetry streams.");
        return;
      }
      if (!options?.silent) {
        setIsRefreshingRuntimeTelemetry(true);
      }
      try {
        const [channelsResponse, statsResponse] = await Promise.all([
          listRuntimeTelemetryChannels(normalizedRuntimeSessionId, {
            sessionToken: normalizedRuntimeSessionToken || undefined,
          }),
          getRuntimeSessionStats(normalizedRuntimeSessionId, {
            sessionToken: normalizedRuntimeSessionToken || undefined,
          }),
        ]);
        setRuntimeTelemetryChannels(channelsResponse.channels);
        setRuntimeBackendStats(statsResponse);
        setRuntimeListError(null);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load runtime telemetry channels.";
        setRuntimeListError(message);
        setRuntimeBackendStats(null);
        if (!options?.silent) {
          toast.error(message);
        }
      } finally {
        if (!options?.silent) {
          setIsRefreshingRuntimeTelemetry(false);
        }
      }
    },
    [normalizedRuntimeSessionId, normalizedRuntimeSessionToken]
  );

  const handleRefreshRuntimeProvider = useCallback(
    async (options?: { silent?: boolean }): Promise<void> => {
      if (!normalizedRuntimeSessionId) {
        setRuntimeProviderSession(null);
        setRuntimeProviderError("Set a runtime session ID to inspect provider state.");
        return;
      }
      if (!options?.silent) {
        setIsRefreshingRuntimeProvider(true);
      }
      try {
        const providerSession = await getRuntimeProviderSession(normalizedRuntimeSessionId, {
          sessionToken: normalizedRuntimeSessionToken || undefined,
        });
        setRuntimeProviderSession(providerSession);
        setRuntimeProviderError(null);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load runtime provider session.";
        if (message.includes("(404)")) {
          setRuntimeProviderSession(null);
          setRuntimeProviderError(null);
          return;
        }
        setRuntimeProviderSession(null);
        setRuntimeProviderError(message);
        if (!options?.silent) {
          toast.error(message);
        }
      } finally {
        if (!options?.silent) {
          setIsRefreshingRuntimeProvider(false);
        }
      }
    },
    [normalizedRuntimeSessionId, normalizedRuntimeSessionToken]
  );

  const handleApproveRuntimeProvider = useCallback(async (): Promise<void> => {
    if (!normalizedRuntimeSessionId || runtimeProviderSession?.state !== "pending") {
      return;
    }
    setIsApprovingRuntimeProvider(true);
    try {
      const approval = await approveRuntimeProviderSession(normalizedRuntimeSessionId, {
        approved_capabilities: runtimeProviderSession.requested_capabilities,
        granted_formats: runtimeProviderSession.preferred_formats,
      });
      setRuntimeProviderSession(approval);
      setRuntimeProviderError(null);
      toast.success(`Approved ${approval.provider_display_name || approval.provider_id}.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to approve runtime provider.";
      setRuntimeProviderError(message);
      toast.error(message);
    } finally {
      setIsApprovingRuntimeProvider(false);
    }
  }, [normalizedRuntimeSessionId, runtimeProviderSession]);

  const handleToggleRuntimeProviderRecording = useCallback(async (): Promise<void> => {
    if (!normalizedRuntimeSessionId || runtimeProviderSession === null) {
      return;
    }
    setIsTogglingRuntimeProviderRecording(true);
    try {
      const nextProviderSession =
        runtimeProviderSession.recording_state === "recording"
          ? await stopRuntimeProviderRecording(normalizedRuntimeSessionId, {
              sessionToken: normalizedRuntimeSessionToken || undefined,
            })
          : await startRuntimeProviderRecording(
              normalizedRuntimeSessionId,
              runtimeProviderSession.robot_display_name ||
                runtimeProviderSession.robot_id ||
                runtimeProviderSession.provider_display_name ||
                runtimeProviderSession.provider_id,
              { sessionToken: normalizedRuntimeSessionToken || undefined }
            );
      setRuntimeProviderSession(nextProviderSession);
      setRuntimeProviderError(null);
      toast.success(
        nextProviderSession.recording_state === "recording"
          ? "Runtime provider recording started."
          : "Runtime provider recording stopped."
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update runtime provider recording.";
      setRuntimeProviderError(message);
      toast.error(message);
    } finally {
      setIsTogglingRuntimeProviderRecording(false);
    }
  }, [normalizedRuntimeSessionId, normalizedRuntimeSessionToken, runtimeProviderSession]);

  const handleRefreshRuntimeAttestation = useCallback(
    async (options?: { silent?: boolean }): Promise<void> => {
      if (runtimeDemoEnabled) {
        setRuntimeAttestationStatuses([]);
        setRuntimeAttestationError(null);
        return;
      }
      if (!normalizedRuntimeRobotId) {
        setRuntimeAttestationStatuses([]);
        setRuntimeAttestationError("Set a robot ID to evaluate trust and connection policy.");
        return;
      }
      if (!options?.silent) {
        setIsRefreshingRuntimeAttestation(true);
      }
      try {
        const statuses = await fetchAttestationStatuses();
        setRuntimeAttestationStatuses(statuses);
        setRuntimeAttestationError(null);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load attestation status.";
        setRuntimeAttestationStatuses([]);
        setRuntimeAttestationError(message);
        if (!options?.silent) {
          toast.error(message);
        }
      } finally {
        if (!options?.silent) {
          setIsRefreshingRuntimeAttestation(false);
        }
      }
    },
    [normalizedRuntimeRobotId, runtimeDemoEnabled]
  );

  const handleAllowRuntimeConnection = useCallback(async (): Promise<void> => {
    if (!normalizedRuntimeRobotId) {
      toast.error("Set a robot ID before allowing connection.");
      return;
    }
    try {
      await allowAttestationConnection(normalizedRuntimeRobotId);
      await handleRefreshRuntimeAttestation({ silent: true });
      toast.success("Temporary connection override enabled.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to allow runtime connection.";
      toast.error(message);
    }
  }, [handleRefreshRuntimeAttestation, normalizedRuntimeRobotId]);

  const applyRuntimeDemoTrajectoryCommand = useCallback(
    (text: string): boolean => {
      const match = text.trim().match(/^\/trajectory\s+(.+?)(?:\s+(.+))?$/i);
      if (!match) {
        return false;
      }
      const firstLabel = match[1]?.trim();
      const secondLabel = match[2]?.trim();
      const fromLabel = secondLabel ? firstLabel : null;
      const toLabel = secondLabel ?? firstLabel;
      if (!toLabel) {
        throw new Error("Use /trajectory <object> or /trajectory <object-a> <object-b>.");
      }
      resetRuntimeTraceEpisode();
      window.dispatchEvent(
        new CustomEvent("urdfstudio:runtime-demo-trajectory", {
          detail: { fromLabel, toLabel },
        })
      );
      setRuntimeLastTrajectoryTarget(toLabel);
      applyRuntimeCommandMessages([
        fromLabel
          ? `Trajectory updated from '${fromLabel}' to '${toLabel}'.`
          : `Trajectory updated from robot to '${toLabel}'.`,
      ]);
      toast.success("Runtime trajectory updated.");
      return true;
    },
    [applyRuntimeCommandMessages, resetRuntimeTraceEpisode]
  );

  const applyRuntimeDemoDirectCommand = useCallback(
    (text: string): boolean => {
      const trimmed = text.trim();
      if (/^\/status$/i.test(trimmed)) {
        const lastSample = runtimeTraceSamples.at(-1) ?? null;
        applyRuntimeCommandMessages([
          lastSample
            ? `Simulation pose x=${lastSample.x.toFixed(2)} y=${lastSample.y.toFixed(2)} t=${lastSample.t_ms}ms.`
            : "Simulation runtime is ready. No motion samples captured yet.",
        ]);
        window.dispatchEvent(
          new CustomEvent("urdfstudio:runtime-demo-direct-command", {
            detail: { command: "status" },
          })
        );
        return true;
      }

      if (/^\/stop$/i.test(trimmed)) {
        window.dispatchEvent(
          new CustomEvent("urdfstudio:runtime-demo-direct-command", {
            detail: { command: "stop" },
          })
        );
        applyRuntimeCommandMessages(["Simulation runtime stop acknowledged."]);
        return true;
      }

      const rotateMatch = trimmed.match(/^\/rotate\s+(-?\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?$/i);
      if (rotateMatch) {
        const degrees = Number(rotateMatch[1]);
        const thetaVel = Number(rotateMatch[2] ?? 45);
        if (!Number.isFinite(degrees) || !Number.isFinite(thetaVel) || thetaVel <= 0) {
          throw new Error("Use /rotate <degrees> [theta_vel].");
        }
        resetRuntimeTraceEpisode();
        window.dispatchEvent(
          new CustomEvent("urdfstudio:runtime-demo-direct-command", {
            detail: { command: "rotate", degrees, thetaVel },
          })
        );
        applyRuntimeCommandMessages([`Simulation rotate ${degrees.toFixed(1)}deg at ${thetaVel.toFixed(1)}deg/s.`]);
        return true;
      }

      const moveMatch = trimmed.match(/^\/move\s+(-?\d+(?:\.\d+)?)(?:\s+(-?\d+(?:\.\d+)?))?\s+(\d+(?:\.\d+)?)$/i);
      if (moveMatch) {
        const xVel = Number(moveMatch[1]);
        const yVel = moveMatch[2] == null ? 0 : Number(moveMatch[2]);
        const durationS = Number(moveMatch[3]);
        if (!Number.isFinite(xVel) || !Number.isFinite(yVel) || !Number.isFinite(durationS) || durationS <= 0) {
          throw new Error("Use /move <x_vel> [y_vel] <duration_s>.");
        }
        resetRuntimeTraceEpisode();
        window.dispatchEvent(
          new CustomEvent("urdfstudio:runtime-demo-direct-command", {
            detail: { command: "move", xVel, yVel, durationS },
          })
        );
        applyRuntimeCommandMessages([
          `Simulation move x=${xVel.toFixed(2)} y=${yVel.toFixed(2)} for ${durationS.toFixed(2)}s.`,
        ]);
        return true;
      }

      const strafeMatch = trimmed.match(/^\/strafe\s+(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/i);
      if (strafeMatch) {
        const yVel = Number(strafeMatch[1]);
        const durationS = Number(strafeMatch[2]);
        if (!Number.isFinite(yVel) || !Number.isFinite(durationS) || durationS <= 0) {
          throw new Error("Use /strafe <y_vel> <duration_s>.");
        }
        resetRuntimeTraceEpisode();
        window.dispatchEvent(
          new CustomEvent("urdfstudio:runtime-demo-direct-command", {
            detail: { command: "move", xVel: 0, yVel, durationS },
          })
        );
        applyRuntimeCommandMessages([`Simulation strafe y=${yVel.toFixed(2)} for ${durationS.toFixed(2)}s.`]);
        return true;
      }

      return false;
    },
    [applyRuntimeCommandMessages, resetRuntimeTraceEpisode, runtimeTraceSamples]
  );

  const applyRuntimeDemoRestrictedAreaCommand = useCallback(
    (text: string): boolean => {
      const match = text.trim().match(/^\/restricted-area(?:\s+([a-z0-9_-]+))?$/i);
      if (!match) {
        return false;
      }
      const rawArg = match[1]?.trim().toLowerCase() ?? "";
      let nextAreaIds: RuntimeDemoRestrictedAreaId[];
      let message: string;
      if (rawArg === "clear" || rawArg === "off" || rawArg === "remove") {
        nextAreaIds = [];
        message = "Restricted areas cleared.";
      } else if (rawArg.length === 0) {
        const nextArea = RUNTIME_DEMO_RESTRICTED_AREAS.find(
          (area) => !runtimeRestrictedAreaIds.includes(area.id)
        );
        if (!nextArea) {
          nextAreaIds = [];
          message = "Restricted areas cleared.";
        } else {
          nextAreaIds = [...runtimeRestrictedAreaIds, nextArea.id];
          message = `Restricted area '${nextArea.label}' added.`;
        }
      } else {
        const area = findRuntimeDemoRestrictedArea(rawArg);
        if (!area) {
          throw new Error(
            `Unknown restricted area '${rawArg}'. Try ${runtimeDemoRestrictedAreaLabels.join(", ")}.`
          );
        }
        nextAreaIds = runtimeRestrictedAreaIds.includes(area.id)
          ? runtimeRestrictedAreaIds.filter((areaId) => areaId !== area.id)
          : [...runtimeRestrictedAreaIds, area.id];
        message = nextAreaIds.includes(area.id)
          ? `Restricted area '${area.label}' added.`
          : `Restricted area '${area.label}' removed.`;
      }
      clearRuntimeProofState();
      window.dispatchEvent(
        new CustomEvent("urdfstudio:runtime-demo-restricted-area", {
          detail: { areaIds: nextAreaIds },
        })
      );
      setRuntimeRestrictedAreaIds(nextAreaIds);
      applyRuntimeCommandMessages([
        message,
        nextAreaIds.length > 0
          ? `Active forbidden zones: ${nextAreaIds.join(", ")}.`
          : "No forbidden zones are active.",
      ]);
      toast.success(message);
      return true;
    },
    [
      applyRuntimeCommandMessages,
      clearRuntimeProofState,
      runtimeDemoRestrictedAreaLabels,
      runtimeRestrictedAreaIds,
    ]
  );

  const handleProveRuntimeSafety = useCallback(async (): Promise<void> => {
    if (!normalizedRuntimeRobotId) {
      toast.error("Set a robot ID before proving safety.");
      return;
    }
    if (!normalizedRuntimeSessionId) {
      toast.error("Set a runtime session ID before proving safety.");
      return;
    }
    if (runtimeTraceSamples.length === 0) {
      toast.error("No runtime trace captured yet. Run /scan or a trajectory first.");
      return;
    }
    setIsProvingRuntimeSafety(true);
    runtimeProofStartedAtRef.current = Date.now();
    setRuntimeProofElapsedMs(0);
    setRuntimeProofError(null);
    try {
      const workspace = computeRuntimeProofWorkspace();
      const result = await proveVerifiableRoboticsExecution({
        robot_id: normalizedRuntimeRobotId,
        session_id: normalizedRuntimeSessionId,
        mode: "prove",
        samples: runtimeTraceSamples,
        workspace,
        forbidden_regions: getRuntimeDemoRestrictedRegions(runtimeRestrictedAreaIds),
        max_step_l1_distance: 0.14,
        max_step_delta_l1_distance: 0.09,
        quantization_scale: 100,
      });
      setRuntimeProofResult(result);
      setRuntimeCommandMessages(result.messages);
      toast.success(
        result.policy_satisfied === false ? "Safety violation proved." : "Safety proof generated."
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to prove runtime safety.";
      setRuntimeProofError(message);
      toast.error(message);
    } finally {
      setIsProvingRuntimeSafety(false);
    }
  }, [
    computeRuntimeProofWorkspace,
    normalizedRuntimeRobotId,
    normalizedRuntimeSessionId,
    runtimeRestrictedAreaIds,
    runtimeTraceSamples,
  ]);

  const applyRuntimeDemoScanCommand = useCallback(
    (text: string): boolean => {
      const match = text.trim().match(/^\/scan(?:\s+(.+))?$/i);
      if (!match) {
        return false;
      }
      const target = match[1]?.trim() ?? "";
      resetRuntimeTraceEpisode();
      setRuntimeLastTrajectoryTarget(null);
      window.dispatchEvent(new Event("urdfstudio:runtime-demo-scan"));
      applyRuntimeCommandMessages(
        target
          ? [
              `Demo scan completed for '${target}'.`,
              "Demo detections loaded into runtime.",
            ]
          : [
              "Demo scene scan completed.",
              "Demo detections loaded into runtime.",
            ]
      );
      toast.success("Runtime demo scan loaded.");
      return true;
    },
    [applyRuntimeCommandMessages, resetRuntimeTraceEpisode]
  );

  const applyRuntimeDemoSpeedCommand = useCallback(
    (text: string): boolean => {
      const match = text.trim().match(/^\/speed(?:\s+(slow|normal|fast))?$/i);
      if (!match) {
        return false;
      }
      const nextSpeedMode = (match[1]?.toLowerCase() as RuntimeDemoSpeedMode | undefined) ?? "normal";
      resetRuntimeTraceEpisode();
      window.dispatchEvent(
        new CustomEvent("urdfstudio:runtime-demo-speed", {
          detail: { speedMode: nextSpeedMode },
        })
      );
      setRuntimeDemoSpeedMode(nextSpeedMode);
      applyRuntimeCommandMessages([`Demo motion speed set to '${nextSpeedMode}'.`]);
      toast.success(`Runtime speed set to ${nextSpeedMode}.`);
      return true;
    },
    [applyRuntimeCommandMessages, resetRuntimeTraceEpisode]
  );

  const handleSetRuntimeDemoSpeedMode = useCallback(
    (nextSpeedMode: RuntimeDemoSpeedMode) => {
      resetRuntimeTraceEpisode();
      window.dispatchEvent(
        new CustomEvent("urdfstudio:runtime-demo-speed", {
          detail: { speedMode: nextSpeedMode },
        })
      );
      setRuntimeDemoSpeedMode(nextSpeedMode);
      applyRuntimeCommandMessages([`Demo motion speed set to '${nextSpeedMode}'.`]);
      toast.success(`Runtime speed set to ${nextSpeedMode}.`);
    },
    [applyRuntimeCommandMessages, resetRuntimeTraceEpisode]
  );

  const autocompleteRuntimeCommand = useCallback(
    (text: string): string | null => {
      const trimmed = text.trimStart();
      if (!trimmed.startsWith("/")) {
        return null;
      }
      const commandMatch = trimmed.match(/^\/[^\s]*$/);
      if (commandMatch) {
        const current = commandMatch[0].toLowerCase();
        const match =
          RUNTIME_COMMAND_SUGGESTIONS.find((command) => command.startsWith(current)) ?? null;
        return match;
      }

      const trajectoryMatch = trimmed.match(/^\/trajectory\s+(.+)?$/i);
      if (trajectoryMatch) {
        const rawArgs = trimmed.replace(/^\/trajectory\s+/i, "");
        const parts = rawArgs.split(/\s+/).filter(Boolean);
        const currentToken = rawArgs.endsWith(" ") ? "" : parts[parts.length - 1] ?? "";
        const baseParts = rawArgs.endsWith(" ") ? parts : parts.slice(0, -1);
        const candidate =
          runtimeDemoObjectLabels.find((label) =>
            label.toLowerCase().startsWith(currentToken.toLowerCase())
          ) ?? null;
        if (!candidate) {
          return null;
        }
        return `/trajectory ${[...baseParts, candidate].join(" ")}`;
      }

      const scanMatch = trimmed.match(/^\/scan\s+(.+)?$/i);
      if (scanMatch) {
        const currentToken = trimmed.replace(/^\/scan\s+/i, "").trim();
        const candidate =
          runtimeDemoObjectLabels.find((label) =>
            label.toLowerCase().startsWith(currentToken.toLowerCase())
          ) ?? null;
        return candidate ? `/scan ${candidate}` : null;
      }

      const restrictedAreaMatch = trimmed.match(/^\/restricted-area\s+(.+)?$/i);
      if (restrictedAreaMatch) {
        const currentToken = trimmed.replace(/^\/restricted-area\s+/i, "").trim().toLowerCase();
        const options = [
          ...runtimeDemoRestrictedAreaLabels,
          "clear",
          "off",
          "remove",
        ];
        const candidate = options.find((option) => option.startsWith(currentToken)) ?? null;
        return candidate ? `/restricted-area ${candidate}` : null;
      }

      const speedMatch = trimmed.match(/^\/speed\s+(.+)?$/i);
      if (speedMatch) {
        const currentToken = trimmed.replace(/^\/speed\s+/i, "").trim().toLowerCase();
        const candidate =
          runtimeDemoSpeedLabels.find((label) => label.startsWith(currentToken)) ?? null;
        return candidate ? `/speed ${candidate}` : null;
      }

      return null;
    },
    [runtimeDemoObjectLabels, runtimeDemoRestrictedAreaLabels, runtimeDemoSpeedLabels]
  );

  const handleSendRuntimeCommand = useCallback(async (): Promise<void> => {
    const text = runtimeCommandText.trim();
    if (!normalizedRuntimeRobotId) {
      toast.error("Set a robot ID before sending a ButterClaw command.");
      return;
    }
    if (!text) {
      toast.error("Enter a command for ButterClaw.");
      return;
    }
    setIsSendingRuntimeCommand(true);
    setRuntimeCommandError(null);
    try {
      if (applyRuntimeDemoScanCommand(text)) {
        return;
      }
      if (/^\/prove-safety$/i.test(text)) {
        await handleProveRuntimeSafety();
        return;
      }
      if (runtimeDemoEnabled && applyRuntimeDemoDirectCommand(text)) {
        return;
      }
      if (runtimeDemoEnabled && applyRuntimeDemoSpeedCommand(text)) {
        return;
      }
      if (runtimeDemoEnabled && applyRuntimeDemoRestrictedAreaCommand(text)) {
        return;
      }
      if (runtimeDemoEnabled && applyRuntimeDemoTrajectoryCommand(text)) {
        return;
      }
      const response = await sendButterClawChatCommand(normalizedRuntimeRobotId, text);
      if (/^\/scan(?:\s|$)/i.test(text)) {
        window.dispatchEvent(new Event("urdfstudio:runtime-object-refresh"));
      }
      applyRuntimeCommandMessages(response.messages);
      toast.success("ButterClaw command sent.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send ButterClaw command.";
      setRuntimeCommandError(message);
      toast.error(message);
    } finally {
      setIsSendingRuntimeCommand(false);
    }
  }, [
    applyRuntimeDemoScanCommand,
    applyRuntimeDemoDirectCommand,
    applyRuntimeDemoSpeedCommand,
    applyRuntimeDemoRestrictedAreaCommand,
    applyRuntimeDemoTrajectoryCommand,
    applyRuntimeCommandMessages,
    handleProveRuntimeSafety,
    normalizedRuntimeRobotId,
    runtimeCommandText,
    runtimeDemoEnabled,
  ]);

  useEffect(() => {
    const handleRuntimeObjectSelected = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      const label = (event.detail as { label?: string } | undefined)?.label?.trim();
      if (!label) {
        return;
      }
      resetRuntimeTraceEpisode();
      window.dispatchEvent(
        new CustomEvent("urdfstudio:runtime-demo-trajectory", {
          detail: { fromLabel: null, toLabel: label },
        })
      );
      setRuntimeLastTrajectoryTarget(label);
      applyRuntimeCommandMessages([`Auto trajectory requested to '${label}'.`]);
      toast.success(`Trajectory set to ${label}.`);
    };
    window.addEventListener("urdfstudio:runtime-object-selected", handleRuntimeObjectSelected);
    return () => {
      window.removeEventListener(
        "urdfstudio:runtime-object-selected",
        handleRuntimeObjectSelected
      );
    };
  }, [applyRuntimeCommandMessages, resetRuntimeTraceEpisode]);

  useEffect(() => {
    if (!entryMode.isRuntime) {
      return;
    }
    const handleRuntimePoseSample = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (!isRuntimePoseSampleMessage(event.data)) {
        if (isResetRuntimeTraceMessage(event.data)) {
          resetRuntimeTraceWithMessages(["Runtime trace cleared after pose reset."]);
        }
        return;
      }
      const x = typeof event.data.x === "number" ? event.data.x : null;
      const y = typeof event.data.y === "number" ? event.data.y : null;
      const tMs = typeof event.data.tMs === "number" ? event.data.tMs : null;
      if (x === null || y === null || tMs === null) {
        return;
      }
      if (runtimeTraceStartRef.current === null) {
        runtimeTraceStartRef.current = tMs;
      }
      const relativeTMs = Math.max(0, tMs - runtimeTraceStartRef.current);
      const lastPoint = runtimeLastTracePointRef.current;
      if (lastPoint) {
        const dt = relativeTMs - lastPoint.tMs;
        const dx = x - lastPoint.x;
        const dy = y - lastPoint.y;
        if (dt < 75 && Math.hypot(dx, dy) < 0.015) {
          return;
        }
      }
      runtimeLastTracePointRef.current = { x, y, tMs: relativeTMs };
      setRuntimeTraceSamples((current) => [...current, { x, y, t_ms: relativeTMs }]);
    };

    window.addEventListener("message", handleRuntimePoseSample);
    return () => {
      window.removeEventListener("message", handleRuntimePoseSample);
    };
  }, [entryMode.isRuntime, resetRuntimeTraceWithMessages]);

  useEffect(() => {
    if (!isProvingRuntimeSafety) {
      setRuntimeProofElapsedMs(0);
      runtimeProofStartedAtRef.current = null;
      return;
    }
    runtimeProofStartedAtRef.current = Date.now();
    setRuntimeProofElapsedMs(0);
    const intervalId = window.setInterval(() => {
      if (runtimeProofStartedAtRef.current === null) {
        return;
      }
      setRuntimeProofElapsedMs(Date.now() - runtimeProofStartedAtRef.current);
    }, 120);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isProvingRuntimeSafety]);

  const handleDumpRuntimeStats = useCallback(async (): Promise<void> => {
    const snapshot = buildRuntimeStatsAuditSnapshot({
      capturedAtIso: new Date().toISOString(),
      sessionId: normalizedRuntimeSessionId,
      tokenConfigured: normalizedRuntimeSessionToken.length > 0,
      backendStats: runtimeBackendStats,
      channels: runtimeTelemetryChannels,
    });
    const payload = JSON.stringify(snapshot, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      toast.success("Runtime stats copied.");
    } catch {
      toast.error("Failed to copy runtime stats.");
    }
  }, [
    runtimeBackendStats,
    normalizedRuntimeSessionId,
    normalizedRuntimeSessionToken,
    runtimeTelemetryChannels,
  ]);

  useEffect(() => {
    if (!entryMode.isRuntime) return;
    return startVisiblePageInterval(() => {
      void handleRefreshRuntimeAttestation({ silent: true });
    }, RUNTIME_TELEMETRY_POLL_INTERVAL_MS * 2);
  }, [entryMode.isRuntime, handleRefreshRuntimeAttestation]);

  useEffect(() => {
    if (!entryMode.isRuntime) return;
    if (!normalizedRuntimeSessionId) {
      setRuntimeTelemetryChannels([]);
      setRuntimeBackendStats(null);
      setRuntimeListError("Set a runtime session ID to load telemetry streams.");
      return;
    }
    return startVisiblePageInterval(() => {
      void handleRefreshRuntimeTelemetry({ silent: true });
    }, RUNTIME_TELEMETRY_POLL_INTERVAL_MS);
  }, [entryMode.isRuntime, handleRefreshRuntimeTelemetry, normalizedRuntimeSessionId]);

  useEffect(() => {
    if (!entryMode.isRuntime) return;
    if (!normalizedRuntimeSessionId) {
      setRuntimeProviderSession(null);
      setRuntimeProviderError("Set a runtime session ID to inspect provider state.");
      return;
    }
    return startVisiblePageInterval(() => {
      void handleRefreshRuntimeProvider({ silent: true });
    }, RUNTIME_TELEMETRY_POLL_INTERVAL_MS);
  }, [entryMode.isRuntime, handleRefreshRuntimeProvider, normalizedRuntimeSessionId]);

  useEffect(() => {
    if (!loadedRobotName) return;
    setRuntimeRobotId((current) => (current.trim() === "" || current === "my_kiwi" ? loadedRobotName : current));
  }, [loadedRobotName, setRuntimeRobotId]);

  const runtimeAdapterStatus = useMemo(() => {
    return buildRuntimeAdapterStatus(runtimeTelemetryChannels, runtimeBackendStats);
  }, [runtimeBackendStats, runtimeTelemetryChannels]);

  const runtimeAdapterFamilies = useMemo(() => {
    return buildRuntimeAdapterFamilies(runtimeTelemetryChannels);
  }, [runtimeTelemetryChannels]);

  const runtimeLayerCounts = useMemo(() => {
    const countByKind = (kind: TelemetryStreamKind) =>
      runtimeTelemetryChannels.filter((channel) => channel.stream_kind === kind).length;
    return [
      { id: "tf", label: "TF", count: countByKind(TelemetryStreamKind.TF_EDGE_BATCH) },
      { id: "marker", label: "Markers", count: countByKind(TelemetryStreamKind.MARKER_DELTA_BATCH) },
      { id: "pose", label: "Pose", count: countByKind(TelemetryStreamKind.POSE) },
      { id: "joint", label: "Joint State", count: countByKind(TelemetryStreamKind.JOINT_STATE_BATCH) },
      { id: "diag", label: "Diagnostics", count: countByKind(TelemetryStreamKind.DIAGNOSTIC_EVENT) },
    ];
  }, [runtimeTelemetryChannels]);

  const runtimeBackendDropReasonSummary = useMemo(() => {
    if (!runtimeBackendStats) {
      return "n/a";
    }
    const entries = Object.entries(runtimeBackendStats.drop_reasons).filter(([, count]) => count > 0);
    if (entries.length === 0) {
      return "none";
    }
    return entries.map(([reason, count]) => `${reason}:${count}`).join(", ");
  }, [runtimeBackendStats]);

  const runtimeConnectionTargets = useMemo(() => {
    return buildRuntimeConnectionTargets(API_BASE_URL, normalizedRuntimeSessionId);
  }, [normalizedRuntimeSessionId]);

  const currentRuntimeAttestation = useMemo(() => {
    if (!normalizedRuntimeRobotId) return null;
    return (
      runtimeAttestationStatuses.find((status) => status.robot_id === normalizedRuntimeRobotId) ??
      null
    );
  }, [normalizedRuntimeRobotId, runtimeAttestationStatuses]);

  const runtimeFleetSummary = useMemo(() => {
    const verified = runtimeAttestationStatuses.filter(
      (status) => status.effective_trust_state === "verified"
    ).length;
    const failed = runtimeAttestationStatuses.filter(
      (status) => status.effective_trust_state === "failed"
    ).length;
    const inactive = runtimeAttestationStatuses.filter(
      (status) => status.effective_trust_state === "inactive"
    ).length;
    const stale = runtimeAttestationStatuses.filter(
      (status) => status.effective_trust_state === "stale"
    ).length;
    const alerts = runtimeAttestationStatuses.filter(
      (status) => status.effective_trust_state === "failed" || status.effective_trust_state === "inactive"
    );

    return {
      total: runtimeAttestationStatuses.length,
      verified,
      failed,
      inactive,
      stale,
      alerts,
    };
  }, [runtimeAttestationStatuses]);

  const runtimeControlSummary = useMemo(() => {
    if (runtimeDemoEnabled) {
      return {
        headline: "Simulation control is open on this machine.",
        detail:
          "Commands execute against the local runtime demo and do not require Raspberry Pi attestation.",
      };
    }

    if (!normalizedRuntimeRobotId) {
      return {
        headline: "Pick a robot before opening control.",
        detail: "The control gate follows the selected robot identity and its current attestation state.",
      };
    }

    if (currentRuntimeAttestation?.control_allowed) {
      return {
        headline: "Control path is open on this machine.",
        detail:
          currentRuntimeAttestation.control_explanation ??
          "Commands can flow once the operator opens the runtime session.",
      };
    }

    return {
      headline: "Control is blocked until trust passes.",
      detail:
        currentRuntimeAttestation?.control_explanation ??
        "Verify the robot or apply a temporary operator override before sending commands.",
    };
  }, [currentRuntimeAttestation, normalizedRuntimeRobotId, runtimeDemoEnabled]);

  const runtimeReceiverSummary = useMemo(() => {
    if (runtimeDemoEnabled) {
      return {
        label: "Local simulation",
        detail:
          "This workstation is running the simulation-backed runtime access demo without Raspberry Pi hardware.",
      };
    }

    if (!normalizedRuntimeRobotId) {
      return {
        label: "Local console",
        detail: "This workstation is treated as the trusted operator console for the runtime demo.",
      };
    }
    return {
      label: "Allowed computer",
      detail: currentRuntimeAttestation?.control_allowed
        ? "This workstation is trusted locally. Only robot attestation controls command access."
        : "This workstation stays trusted locally, but robot attestation still blocks commands until trust passes.",
    };
  }, [currentRuntimeAttestation?.control_allowed, normalizedRuntimeRobotId, runtimeDemoEnabled]);

  const loadWorldLayoutFromUrl = useCallback(
    async (inputUrl: string): Promise<boolean> => {
      const normalizedUrl = normalizeWorldLayoutImportUrl(inputUrl);
      if (!normalizedUrl) {
        toast.error("Please enter a world layout link");
        return false;
      }
      if (!onImportWorldLayout) {
        toast.error("World layout import is not available in this build");
        return false;
      }

      return withStudioEntryLoad({ kind: "world_layout" }, async () =>
        withWorldLayoutLoading(async () => {
          await onImportWorldLayout(normalizedUrl);
          addRecentWorldLayout(normalizedUrl);
          setWorldLayoutUrl(normalizedUrl);
          setLoadedWorldLayoutName(deriveSourceLabel(normalizedUrl, "world-layout.json"));
          toast.success("Loaded world layout");
          return true;
        })
      ).catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to import world layout";
        toast.error(message);
        return false;
      });
    },
    [addRecentWorldLayout, onImportWorldLayout, setWorldLayoutUrl, withStudioEntryLoad, withWorldLayoutLoading]
  );

  const importWorldLayoutFromInput = useCallback(async (): Promise<void> => {
    if (!worldLayoutUrl.trim()) {
      toast.error("Please enter a world layout link");
      return;
    }
    await loadWorldLayoutFromUrl(worldLayoutUrl);
  }, [loadWorldLayoutFromUrl, worldLayoutUrl]);

  const handleWorldLayoutFileButtonClick = useCallback((): void => {
    worldLayoutFileInputRef.current?.click();
  }, []);

  const processWorldLayoutFile = useCallback(
    async (file: File) => {
      if (!onImportWorldLayout) {
        toast.error("World layout import is not available in this build");
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      try {
        await withStudioEntryLoad({ kind: "world_layout" }, async () =>
          withWorldLayoutLoading(async () => {
            await onImportWorldLayout(objectUrl);
            setLastLocalWorldLayout(file.name);
            setLoadedWorldLayoutName(file.name);
            toast.success(`Loaded world layout from ${file.name}`);
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to import world layout";
        toast.error(message);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    },
    [onImportWorldLayout, setLastLocalWorldLayout, withStudioEntryLoad, withWorldLayoutLoading]
  );

  const handleWorldLayoutFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await processWorldLayoutFile(file);
      } finally {
        e.currentTarget.value = "";
      }
    },
    [processWorldLayoutFile]
  );

  const applyCameraConfig = useCallback(
    (cameraConfig: { cameras: Array<(typeof cameras)[number]> }, sourceLabel: string) => {
      loadCameras(cameraConfig);
      toast.success(`Loaded ${cameraConfig.cameras.length} camera(s) from ${sourceLabel}`);
    },
    [loadCameras]
  );

  const loadCameraConfigFromUrl = useCallback(
    async (inputUrl: string) => {
      const normalizedUrl = inputUrl.trim();
      if (!normalizedUrl) {
        toast.error("Please enter a camera config URL");
        return;
      }

      try {
        await withStudioEntryLoad({ kind: "camera_config" }, async () =>
          withCameraConfigLoading(async () => {
            const response = await fetch(normalizedUrl);
            if (!response.ok) {
              throw new Error(`Failed to fetch camera config (${response.status})`);
            }
            const content = await response.text();
            let inferredFilename = "camera-config.json";
            try {
              const parsedUrl = new URL(normalizedUrl);
              inferredFilename = parsedUrl.pathname.split("/").pop() || inferredFilename;
            } catch {
              // Keep fallback filename for non-standard URLs.
            }
            const config = parseCameraConfig(content, inferredFilename);
            applyCameraConfig(config, normalizedUrl);
            addRecentCameraConfig(normalizedUrl);
            setCameraConfigUrl(normalizedUrl);
          })
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to import camera configuration";
        toast.error(message);
      }
    },
    [addRecentCameraConfig, applyCameraConfig, setCameraConfigUrl, withCameraConfigLoading, withStudioEntryLoad]
  );

  const importCameraConfigFromInput = useCallback(async () => {
    await loadCameraConfigFromUrl(cameraConfigUrl);
  }, [cameraConfigUrl, loadCameraConfigFromUrl]);

  const handleCameraConfigFileButtonClick = useCallback(() => {
    cameraConfigFileInputRef.current?.click();
  }, []);

  const processCameraConfigFile = useCallback(
    async (file: File) => {
      try {
        await withStudioEntryLoad({ kind: "camera_config" }, async () =>
          withCameraConfigLoading(async () => {
            const content = await file.text();
            const config = parseCameraConfig(content, file.name);
            applyCameraConfig(config, file.name);
            setLastLocalCameraConfig(file.name);
          })
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to import camera configuration";
        toast.error(message);
      }
    },
    [applyCameraConfig, setLastLocalCameraConfig, withCameraConfigLoading, withStudioEntryLoad]
  );

  const handleCameraConfigFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        await processCameraConfigFile(file);
      } finally {
        event.currentTarget.value = "";
      }
    },
    [processCameraConfigFile]
  );

  const handleDeleteCamera = useCallback(
    (cameraId: string, cameraName: string) => {
      removeCamera(cameraId);
      toast.success(`Removed camera "${cameraName}"`);
    },
    [removeCamera]
  );

  const finalizeRobotLoad = useCallback(
    async (files: FileList, options?: { applyWorldLayout?: boolean }) => {
      await onFolderSelected(files, { preserveCameras: useCameraStore.getState().cameras.length > 0 });
      if (options?.applyWorldLayout === false) return;
      if (entryMode.isAssembly || !worldLayoutUrl.trim() || !onImportWorldLayout) return;
      await loadWorldLayoutFromUrl(worldLayoutUrl);
    },
    [entryMode.isAssembly, loadWorldLayoutFromUrl, onFolderSelected, onImportWorldLayout, worldLayoutUrl]
  );

  const validateCandidateForLoad = useCallback(
    (
      candidate: URDFCandidate,
      sourceLabel: "repository" | "folder",
      repositoryFiles?: GitHubFile[]
    ): boolean => {
      if (!candidate.isXacro && candidate.hasUnsupportedFormats === true) {
        const formats = candidate.unsupportedFormats?.join(", ") || "unknown";
        toast.error(
          `URDF uses unsupported mesh formats (${formats}). Only ${meshExtensionsDisplay()} files are supported.`,
          { duration: 6000 }
        );
        return false;
      }

      if (candidate.isXacro) {
        if (!xacroGate.enabled) {
          toast.error(xacroGateUnavailableMessage);
          return false;
        }
        toast.info("Xacro file detected. Expanding to URDF before loading...");
      }

      if (
        !candidate.isXacro &&
        candidate.unmatchedMeshReferences &&
        candidate.unmatchedMeshReferences.length > 0
      ) {
        const actionableUnmatchedRefs =
          repositoryFiles && repositoryFiles.length > 0
            ? filterActionableUnmatchedMeshReferences(
                candidate.path,
                candidate.unmatchedMeshReferences,
                repositoryFiles
              )
            : candidate.unmatchedMeshReferences;

        if (actionableUnmatchedRefs.length === 0) {
          return true;
        }

        const unmatchedCount = actionableUnmatchedRefs.length;
        const unmatchedList = actionableUnmatchedRefs.slice(0, 3).join(", ");
        const moreText = unmatchedCount > 3 ? ` and ${unmatchedCount - 3} more` : "";
        toast.warning(
          `Warning: ${unmatchedCount} mesh file(s) referenced in URDF but not found in ${sourceLabel}: ${unmatchedList}${moreText}`,
          { duration: 8000 }
        );
      }

      return true;
    },
    [xacroGate.enabled, xacroGateUnavailableMessage]
  );

  const isCandidateUnavailable = useCallback(
    (candidate: URDFCandidate): boolean =>
      (candidate.hasUnsupportedFormats === true && !candidate.isXacro) ||
      (candidate.isXacro && !xacroGate.enabled),
    [xacroGate.enabled]
  );

  const openCandidateSelectionDialog = useCallback(
    (
      candidates: URDFCandidate[],
      localFiles: File[] | null = null,
      options?: {
        assemblySourceKey?: string | null;
        dialogTitle?: string | null;
        dialogDescription?: string | null;
      }
    ) => {
      const uniqueCandidates = dedupeUrdfCandidatesByPath(candidates);
      clearStudioCandidateGalleryPreview();
      setUrdfCandidates(uniqueCandidates);
      setLocalSelectionFiles(localFiles);
      setSelectedCandidatePaths([]);
      setActiveAssemblySourceKey(options?.assemblySourceKey ?? null);
      setCandidateDialogTitle(options?.dialogTitle ?? null);
      setCandidateDialogDescription(options?.dialogDescription ?? null);
      setShowUrdfDialog(true);
    },
    [clearStudioCandidateGalleryPreview]
  );
  const openLocalCandidateSelection = useCallback(
    (
      candidates: URDFCandidate[],
      localFiles: File[],
      options?: { assemblySourceKey?: string | null }
    ) => {
      setLocalSelectionSource(localFiles);
      openCandidateSelectionDialog(candidates, localFiles, options);
    },
    [openCandidateSelectionDialog, setLocalSelectionSource]
  );

  const processPreparedLocalRobotSource = useCallback(
    async (preparedSource: PreparedLocalRobotSource): Promise<void> => {
      clearGitHubSource();
      setLocalSelectionSource(null);

      let localFiles = preparedSource.files;
      const selectedFolderPath = deriveSelectedLocalFolder(localFiles) || preparedSource.sourceLabel;
      if (selectedFolderPath) {
        setLastLocalFolder(selectedFolderPath);
      }

      let kitchenArtifact: KitchenLocalGeneratedFile["artifact"] | null = null;
      let kitchenBuildError: string | null = null;
      try {
        const generatedKitchenFile = await buildKitchenGeneratedUrdfFile(localFiles);
        if (generatedKitchenFile) {
          kitchenArtifact = generatedKitchenFile.artifact;
          localFiles = upsertKitchenGeneratedUrdfFile(localFiles, generatedKitchenFile.file);
        }
      } catch (error) {
        kitchenBuildError =
          error instanceof Error ? error.message : "Kitchen XML could not be converted.";
      }

      const localGitHubFiles = toLocalGitHubFiles(localFiles);
      let candidates = findURDFCandidates(localGitHubFiles);
      if (candidates.length === 0) {
        toast.error(
          kitchenBuildError
            ? `No .urdf file found. Kitchen XML could not be generated: ${kitchenBuildError}`
            : "No .urdf file found in the selected source"
        );
        return;
      }
      if (kitchenBuildError) {
        reportKitchenBuildWarning(kitchenBuildError);
      }
      if (kitchenArtifact) {
        toast.success(`Generated ${describeKitchenArtifact(kitchenArtifact)}`);
        reportKitchenArtifactWarnings(kitchenArtifact);
      }
      candidates = await checkLocalCandidatesForUnsupportedFormats(candidates, localFiles);

      if (entryMode.isAssembly) {
        const sourceKey = `local/${selectedFolderPath || "folder"}`;
        upsertAssemblySource({
          sourceKey,
          sourceLabel: selectedFolderPath || "Local folder",
          candidates,
          source: {
            type: "local",
            folderLabel: selectedFolderPath,
            files: localFiles,
          },
        });
        openLocalCandidateSelection(candidates, localFiles, { assemblySourceKey: sourceKey });
        return;
      }

      openLocalCandidateSelection(candidates, localFiles);
    },
    [
      checkLocalCandidatesForUnsupportedFormats,
      clearGitHubSource,
      entryMode.isAssembly,
      openLocalCandidateSelection,
      setLastLocalFolder,
      setLocalSelectionSource,
      upsertAssemblySource,
    ]
  );

  const processRawLocalRobotFiles = useCallback(
    async (rawFiles: File[]): Promise<void> => {
      const normalizedFiles = rawFiles.filter((file) => file.size > 0 || file.name.toLowerCase().endsWith(".urdf"));
      if (normalizedFiles.length === 1 && normalizedFiles[0]?.name.toLowerCase().endsWith(".zip")) {
        setIsPreparingDroppedRobotSource(true);
        try {
          const preparedZipSource = await prepareZipRobotSource(normalizedFiles[0]);
          await processPreparedLocalRobotSource(preparedZipSource);
        } finally {
          setIsPreparingDroppedRobotSource(false);
        }
        return;
      }
      await processPreparedLocalRobotSource(
        {
          files: normalizedFiles,
          sourceOrigin: "files",
          sourceLabel: deriveSelectedLocalFolder(normalizedFiles),
        }
      );
    },
    [prepareZipRobotSource, processPreparedLocalRobotSource]
  );

  const handleLocalFilesSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    await processRawLocalRobotFiles(Array.from(files));
    event.currentTarget.value = "";
  }, [processRawLocalRobotFiles]);

  const handleFolderSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processPreparedLocalRobotSource({
      files: Array.from(files),
      sourceOrigin: "folder",
      sourceLabel: deriveSelectedLocalFolder(Array.from(files)),
    });
    e.currentTarget.value = "";
  }, [
    processPreparedLocalRobotSource,
  ]);

  const reportGitHubLoadError = useCallback((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : "Failed to load repository";

    if (errorMessage.includes("403") || errorMessage.includes("access denied")) {
      toast.error("Repository is private, access is denied, or server GitHub auth is unavailable.");
    } else if (errorMessage.includes("404") || errorMessage.includes("not found")) {
      toast.error("Repository or path not found.");
    } else if (errorMessage.includes("rate limit")) {
      toast.error(errorMessage);
    } else {
      toast.error(errorMessage);
    }
  }, []);

  const hydrateStudioCandidateGalleryPreview = useCallback(async (
    sourceInfo: IluGitHubRepoSource,
    candidates: URDFCandidate[]
  ): Promise<void> => {
    const requestId = studioCandidateGalleryPreviewRequestIdRef.current + 1;
    studioCandidateGalleryPreviewRequestIdRef.current = requestId;
    setStudioCandidateGalleryPreviewByPath({});
    setStudioCandidateGalleryPublishedRepo(null);
    setIsLoadingStudioCandidateGalleryPreview(true);
    try {
      const preview = await getIluGalleryRepoPreview(sourceInfo, candidates);
      if (studioCandidateGalleryPreviewRequestIdRef.current !== requestId) {
        return;
      }
      setStudioCandidateGalleryPreviewByPath(
        Object.fromEntries(
          preview.items
            .map((item) => [item.urdfPath || item.id, item] as const)
            .filter(([path]) => Boolean(path))
        )
      );
      setStudioCandidateGalleryPublishedRepo(preview.publishedRepo ?? null);
    } catch {
      if (studioCandidateGalleryPreviewRequestIdRef.current === requestId) {
        setStudioCandidateGalleryPreviewByPath({});
        setStudioCandidateGalleryPublishedRepo(null);
      }
    } finally {
      if (studioCandidateGalleryPreviewRequestIdRef.current === requestId) {
        setIsLoadingStudioCandidateGalleryPreview(false);
      }
    }
  }, []);

  const openGitHubCandidateSelection = useCallback(
    async (
      sourceInfo: IluGitHubRepoSource,
      options: { sourceUrl?: string }
    ): Promise<void> => {
      if (!entryMode.isAssembly) {
        const candidateSummary = await fetchIluGitHubRepoCandidateSummary(sourceInfo);
        const resolvedSourceInfo = {
          ...sourceInfo,
          branch: sourceInfo.branch || candidateSummary.ref || undefined,
        };
        const dialogCopy = buildGitHubCandidateDialogCopy(
          resolvedSourceInfo,
          candidateSummary.candidates
        );
        setGitHubSelectionSource({ ...resolvedSourceInfo }, []);
        openCandidateSelectionDialog(candidateSummary.candidates, null, {
          dialogTitle: dialogCopy.title,
          dialogDescription: dialogCopy.description,
        });
        void hydrateStudioCandidateGalleryPreview(resolvedSourceInfo, candidateSummary.candidates);
        if (dialogCopy.discoveryToast) {
          toast.info(dialogCopy.discoveryToast, { duration: 6000 });
        }
        return;
      }

      const { files, candidates } = await fetchIluGitHubRepoCandidates(sourceInfo);
      const dialogCopy = buildGitHubCandidateDialogCopy(sourceInfo, candidates);
      setGitHubSelectionSource({ ...sourceInfo }, files);
      if (entryMode.isAssembly) {
        const sourceKey = `github/${sourceInfo.owner}/${sourceInfo.repo}/${sourceInfo.branch || "default"}/${sourceInfo.path || "root"}`;
        upsertAssemblySource({
          sourceKey,
          sourceLabel: formatGitHubCandidateSourceLabel(sourceInfo),
          candidates,
          source: {
            type: "github",
            owner: sourceInfo.owner,
            repo: sourceInfo.repo,
            path: sourceInfo.path,
            branch: sourceInfo.branch,
            files,
            url: options.sourceUrl || buildGitHubRepoUrl(sourceInfo),
          },
        });
        openCandidateSelectionDialog(candidates, null, {
          assemblySourceKey: sourceKey,
          dialogTitle: dialogCopy.title,
          dialogDescription: dialogCopy.description,
        });
        return;
      }
      openCandidateSelectionDialog(candidates, null, {
        dialogTitle: dialogCopy.title,
        dialogDescription: dialogCopy.description,
      });
      if (dialogCopy.discoveryToast) {
        toast.info(dialogCopy.discoveryToast, { duration: 6000 });
      }
    },
    [
      buildGitHubRepoUrl,
      entryMode.isAssembly,
      hydrateStudioCandidateGalleryPreview,
      openCandidateSelectionDialog,
      setGitHubSelectionSource,
      upsertAssemblySource,
    ]
  );

  const handleGithubLoad = useCallback(async (): Promise<void> => {
    if (!githubUrl.trim()) {
      toast.error("Please enter a GitHub repository URL");
      return;
    }

    const repoInfo = parseGitHubUrl(githubUrl.trim());
    if (!repoInfo) {
      toast.error("Invalid GitHub repository URL. Format: owner/repo or https://github.com/owner/repo");
      return;
    }

    try {
      await withGitHubLoading(async () => {
        await openGitHubCandidateSelection(repoInfo, {
          sourceUrl: githubUrl.trim() || buildGitHubRepoUrl(repoInfo),
        });
      });
    } catch (error) {
      reportGitHubLoadError(error);
      console.error("GitHub repo load error:", error);
    }
  }, [
    buildGitHubRepoUrl,
    githubUrl,
    openGitHubCandidateSelection,
    reportGitHubLoadError,
    withGitHubLoading,
  ]);

  const handleGalleryGithubLoad = useCallback(async (): Promise<void> => {
    const sourceUrl = galleryGithubUrl.trim();
    if (!sourceUrl) {
      toast.error("Please enter a GitHub repository or folder URL");
      return;
    }

    const sourceInfo = parseGitHubUrl(sourceUrl);
    if (!sourceInfo) {
      toast.error("Invalid GitHub repository URL. Format: owner/repo or https://github.com/owner/repo");
      return;
    }

    await startGalleryInspectionJob(sourceInfo, sourceUrl);
  }, [galleryGithubUrl, startGalleryInspectionJob]);

  useEffect(() => {
    if (galleryEditorDeepLinkHandledRef.current || typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const isGalleryEditorEntry =
      params.get(GALLERY_EDITOR_ENTRY_QUERY_PARAM) === GALLERY_EDITOR_ENTRY_QUERY_VALUE;
    const sourceUrl = params.get(GALLERY_EDITOR_SOURCE_QUERY_PARAM)?.trim() ?? "";
    if (!isGalleryEditorEntry || !sourceUrl) {
      return;
    }

    galleryEditorDeepLinkHandledRef.current = true;
    setGalleryGithubUrl(sourceUrl);
    setEntryOption("gallery");
    setGalleryMetadataEditing(true);

    if (params.get(GALLERY_EDITOR_AUTOSTART_QUERY_PARAM) !== GALLERY_EDITOR_AUTOSTART_QUERY_VALUE) {
      return;
    }

    const sourceInfo = parseGitHubUrl(sourceUrl);
    if (!sourceInfo) {
      toast.error("Invalid GitHub repository URL. Format: owner/repo or https://github.com/owner/repo");
      return;
    }

    void startGalleryInspectionJob(sourceInfo, sourceUrl);
  }, [setGalleryMetadataEditing, setGalleryGithubUrl, startGalleryInspectionJob]);

  const handleRobotSourceDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setRobotSourceDropActive(true);
  }, []);
  const handleRobotSourceDragOver = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setRobotSourceDropActive(true);
  }, []);
  const handleRobotSourceDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setRobotSourceDropActive(false);
  }, []);
  const handleRobotSourceDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    setRobotSourceDropActive(false);
    try {
      setIsPreparingDroppedRobotSource(true);
      const droppedFiles = await collectDroppedRobotFiles(event);
      if (droppedFiles.length === 0) {
        toast.error("No local robot files were dropped.");
        return;
      }
      await processRawLocalRobotFiles(droppedFiles);
    } finally {
      setIsPreparingDroppedRobotSource(false);
    }
  }, [collectDroppedRobotFiles, processRawLocalRobotFiles]);

  const buildCachedGitHubSourceContext = useCallback(() => {
    if (!repoInfo || fetchedFiles.length === 0) {
      return null;
    }
    return {
      sourceInfo: {
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        path: repoInfo.path,
        branch: repoInfo.branch,
      },
      files: fetchedFiles,
    };
  }, [fetchedFiles, repoInfo]);

  const loadGitHubFilesForSelectedCandidate = useCallback(
    async (candidate: URDFCandidate) => {
      const cachedSource = buildCachedGitHubSourceContext();
      if (cachedSource) {
        const resolvedCandidate = await ensureGitHubCandidateDiagnostics(
          candidate,
          cachedSource.files,
          cachedSource.sourceInfo
        );
        return {
          resolvedCandidate,
          sourceInfo: cachedSource.sourceInfo,
          files: cachedSource.files,
        };
      }

      const sourceInfo = repoInfo
        ? {
            owner: repoInfo.owner,
            repo: repoInfo.repo,
            path: repoInfo.path,
            branch: repoInfo.branch,
          }
        : parseGitHubUrl(githubUrl.trim());
      if (!sourceInfo) {
        toast.error("Invalid repository information");
        return null;
      }

      const files = await fetchIluGitHubRepoFiles(sourceInfo);
      setGitHubSelectionSource(sourceInfo, files);
      const resolvedCandidate = await ensureGitHubCandidateDiagnostics(candidate, files, sourceInfo);
      return { resolvedCandidate, sourceInfo, files };
    },
    [
      buildCachedGitHubSourceContext,
      ensureGitHubCandidateDiagnostics,
      githubUrl,
      repoInfo,
      setGitHubSelectionSource,
    ]
  );

  const buildFileListForCandidate = useCallback(
    async (
      source: CandidateSourceContext,
      candidatePath: string,
      options?: { additionalUrdfPaths?: string[] }
    ): Promise<FileList> => {
      if (source.type === "local") {
        return createOrderedLocalFileList(source.files, candidatePath);
      }
      return buildIluGitHubCandidateFileList(
        {
          files: source.files,
          owner: source.owner,
          repo: source.repo,
          branch: source.branch,
        },
        candidatePath,
        {
          additionalUrdfPaths: options?.additionalUrdfPaths,
        }
      );
    },
    []
  );

  const openGitHubXacroLoadingToast = useCallback((candidatePath: string) => {
    if (!isXacroPath(candidatePath)) {
      return null;
    }
    return toast.loading(
      "Expanding GitHub Xacro: resolving package dependencies and support files...",
      { duration: Infinity }
    );
  }, []);
  const applyGitHubRobotFromPath = useCallback(
    async (
      params: {
        sourceInfo: GitHubSourceInfo;
        files: GitHubFile[];
        urdfPath: string;
        displayName: string;
      },
      options?: { applyWorldLayout?: boolean; additionalUrdfPaths?: string[]; sourceUrl?: string }
    ) => {
      const { sourceInfo, files, urdfPath, displayName } = params;
      closeUrdfSelectionDialog();

      setGitHubSource({
        owner: sourceInfo.owner,
        repo: sourceInfo.repo,
        path: sourceInfo.path,
        branch: sourceInfo.branch,
        files,
        urdfPath,
      });
      const loadingToastId = openGitHubXacroLoadingToast(urdfPath);
      try {
        const fileList = await buildFileListForCandidate(
          {
            type: "github",
            owner: sourceInfo.owner,
            repo: sourceInfo.repo,
            path: sourceInfo.path,
            branch: sourceInfo.branch,
            files,
          },
          urdfPath,
          options
        );

        const repoUrl = options?.sourceUrl || githubUrl.trim() || buildGitHubRepoUrl(sourceInfo);
        addRecentRepo(sourceInfo.owner, sourceInfo.repo, sourceInfo.path, repoUrl);

        await finalizeRobotLoad(fileList, options);
        setLoadedRobotName(displayName);
        toast.success(`Loaded ${displayName} from GitHub`);
      } finally {
        if (loadingToastId !== null) {
          toast.dismiss(loadingToastId);
        }
      }
    },
    [
      addRecentRepo,
      buildFileListForCandidate,
      buildGitHubRepoUrl,
      closeUrdfSelectionDialog,
      finalizeRobotLoad,
      githubUrl,
      openGitHubXacroLoadingToast,
      setGitHubSource,
    ]
  );
  const applyLoadedGitHubRobot = useCallback(
    async (
      candidate: URDFCandidate,
      sourceInfo: GitHubSourceInfo,
      files: GitHubFile[],
      options?: { applyWorldLayout?: boolean; additionalUrdfPaths?: string[] }
    ) =>
      applyGitHubRobotFromPath(
        {
          sourceInfo,
          files,
          urdfPath: candidate.path,
          displayName: candidate.name,
        },
        options
      ),
    [applyGitHubRobotFromPath]
  );

  const handleTryRobotShortcut = useCallback(async (shortcut: FolderUploadRobotShortcut): Promise<void> => {
    try {
      await withStudioEntryLoad({ kind: "local_candidate" }, async () =>
        withRobotShortcutLoading(shortcut.id, async () => {
          onWorkspaceModeChange?.("studio");
          clearAssemblySelection();
          leaveGalleryEditorMode();
          clearGitHubSource();
          setGitHubSelectionSource(null, []);
          const fileList = await loadRobotAssetFileListFromManifestUrl(
            shortcut.manifestUrl
          );
          if (shortcut.cameraConfigUrl) {
            const cameraConfigResponse = await fetch(shortcut.cameraConfigUrl);
            if (!cameraConfigResponse.ok) {
              throw new Error(
                `Failed to fetch ${shortcut.displayName} camera config (${cameraConfigResponse.status})`
              );
            }
            applyCameraConfig(
              parseCameraConfig(
                await cameraConfigResponse.text(),
                shortcut.cameraConfigUrl,
              ),
              shortcut.cameraConfigUrl,
            );
          } else {
            clearCameras();
          }
          requestInitialRobotPose(shortcut.initialRobotPose);
          await finalizeRobotLoad(fileList, { applyWorldLayout: false });
          setLoadedRobotName(shortcut.displayName);
          toast.success(`Loaded ${shortcut.displayName}`);
        })
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Failed to load ${shortcut.displayName}.`;
      toast.error(message);
      console.error(`${shortcut.displayName} shortcut load error:`, error);
    }
  }, [
    clearAssemblySelection,
    clearGitHubSource,
    clearCameras,
    applyCameraConfig,
    finalizeRobotLoad,
    leaveGalleryEditorMode,
    onWorkspaceModeChange,
    requestInitialRobotPose,
    setGitHubSelectionSource,
    withRobotShortcutLoading,
    withStudioEntryLoad,
  ]);

  const handleOpenGalleryEntry = useCallback(
    async (entry: IluGalleryEntry): Promise<void> => {
      const sourceInfo: GitHubSourceInfo = {
        owner: entry.owner,
        repo: entry.repo,
        path: entry.path || undefined,
        branch: entry.branch || undefined,
      };

      try {
        await withStudioEntryLoad({ kind: "gallery_entry", entryId: entry.id }, async () =>
          withGitHubLoading(async () => {
            const files = await fetchIluGitHubRepoFiles(sourceInfo);
            const resolvedEntryTargetPath = entry.urdfPath
              ? resolveRepositoryXacroTargetPath(
                  files,
                  normalizeMeshPathForMatch(entry.urdfPath) || entry.urdfPath
                )
              : "";
            const normalizedTarget = resolvedEntryTargetPath
              ? normalizeMeshPathForMatch(resolvedEntryTargetPath)
              : "";
            const candidates = normalizedTarget ? findURDFCandidates(files) : [];
            const matchedCandidate = normalizedTarget
              ? (candidates.find((candidate) => normalizeMeshPathForMatch(candidate.path) === normalizedTarget) ?? null)
              : null;

            if (matchedCandidate) {
              if (!validateCandidateForLoad(matchedCandidate, "repository", files)) {
                return;
              }
              onWorkspaceModeChange?.("studio");
              clearAssemblySelection();
              await applyLoadedGitHubRobot(matchedCandidate, sourceInfo, files, {
                applyWorldLayout: false,
              });
              leaveGalleryEditorMode();
              return;
            }

            if (resolvedEntryTargetPath) {
              onWorkspaceModeChange?.("studio");
              clearAssemblySelection();
              await applyGitHubRobotFromPath(
                {
                  sourceInfo,
                  files,
                  urdfPath: resolvedEntryTargetPath,
                  displayName: entry.title,
                },
                { applyWorldLayout: false }
              );
              leaveGalleryEditorMode();
              return;
            }

            setGithubUrl(buildGitHubRepoUrl(sourceInfo));
            setGitHubSelectionSource({ ...sourceInfo }, files);
            const dialogCopy = buildGitHubCandidateDialogCopy(sourceInfo, candidates);
            openCandidateSelectionDialog(candidates, null, {
              dialogTitle: dialogCopy.title,
              dialogDescription: dialogCopy.description,
            });
            toast.info(`Select a robot from ${entry.title}.`);
          })
        );
      } catch (error) {
        reportGitHubLoadError(error);
      }
    },
    [
      applyLoadedGitHubRobot,
      applyGitHubRobotFromPath,
      buildGitHubRepoUrl,
      clearAssemblySelection,
      leaveGalleryEditorMode,
      onWorkspaceModeChange,
      openCandidateSelectionDialog,
      reportGitHubLoadError,
      setGitHubSelectionSource,
      validateCandidateForLoad,
      withGitHubLoading,
      withStudioEntryLoad,
    ]
  );

  const openGalleryEditorForStudioSource = useCallback((): void => {
    if (!repoInfo) {
      toast.error("Load a GitHub repo first to edit gallery metadata.");
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    const sourceUrl = buildGitHubRepoUrl(repoInfo);
    const editorUrl = new URL(window.location.href);
    editorUrl.searchParams.set(GALLERY_EDITOR_ENTRY_QUERY_PARAM, GALLERY_EDITOR_ENTRY_QUERY_VALUE);
    editorUrl.searchParams.set(GALLERY_EDITOR_SOURCE_QUERY_PARAM, sourceUrl);
    editorUrl.searchParams.set(GALLERY_EDITOR_AUTOSTART_QUERY_PARAM, GALLERY_EDITOR_AUTOSTART_QUERY_VALUE);
    editorUrl.hash = "";

    const editorWindow = window.open(editorUrl.toString(), "_blank");
    if (editorWindow) {
      editorWindow.opener = null;
    }
    toast.info("Opened gallery card editor in a new tab.");
  }, [
    buildGitHubRepoUrl,
    repoInfo,
  ]);

  const handleUrdfSelect = useCallback(
    async (
      candidate: URDFCandidate,
      options?: { applyWorldLayout?: boolean; additionalUrdfPaths?: string[] }
    ): Promise<void> => {
      onWorkspaceModeChange?.(entryMode.workspaceMode);
      if (!entryMode.isAssembly) {
        clearAssemblySelection();
      }

      if (localSelectionFiles && localSelectionFiles.length > 0) {
        if (!validateCandidateForLoad(candidate, "folder", toLocalGitHubFiles(localSelectionFiles))) {
          return;
        }
        closeUrdfSelectionDialog();
        try {
          await withStudioEntryLoad({ kind: "local_candidate" }, async () => {
            const orderedFiles = await buildFileListForCandidate(
              { type: "local", files: localSelectionFiles },
              candidate.path,
              options
            );
            await finalizeRobotLoad(orderedFiles, options);
            if (entryOption === "gallery") {
              setEntryOption("studio");
            }
            setLocalSelectionSource(null);
            setStagedSetupRobot(null);
            setLoadedRobotName(candidate.name);
            toast.success(`Loaded ${candidate.name} from local folder`);
          });
        } catch (error) {
          console.error("[Local] URDF load error:", error);
        }
        return;
      }
      
      try {
        await withStudioEntryLoad({ kind: "github_candidate" }, async () =>
          withGitHubLoading(async () => {
            const loadedSource = await loadGitHubFilesForSelectedCandidate(candidate);
            if (!loadedSource) {
              return;
            }
            if (!validateCandidateForLoad(loadedSource.resolvedCandidate, "repository", loadedSource.files)) {
              return;
            }
            await applyLoadedGitHubRobot(
              loadedSource.resolvedCandidate,
              loadedSource.sourceInfo,
              loadedSource.files,
              options
            );
            if (entryOption === "gallery") {
              setEntryOption("studio");
            }
          })
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to load selected URDF";
        console.error("[GitHub] URDF load error:", error);
        toast.error(errorMessage);
      }
    },
    [
      applyLoadedGitHubRobot,
      buildFileListForCandidate,
      clearAssemblySelection,
      closeUrdfSelectionDialog,
      entryOption,
      entryMode.isAssembly,
      entryMode.workspaceMode,
      finalizeRobotLoad,
      localSelectionFiles,
      loadGitHubFilesForSelectedCandidate,
      onWorkspaceModeChange,
      setLocalSelectionSource,
      validateCandidateForLoad,
      withGitHubLoading,
      withStudioEntryLoad,
    ]
  );

  const toggleAssemblyCandidate = useCallback((path: string) => {
    setSelectedCandidatePaths((current) => {
      if (current.includes(path)) {
        return current.filter((value) => value !== path);
      }
      if (assemblyQueuedSelections.length + current.length >= MAX_ASSEMBLY_ROBOTS) {
        toast.error(`Assembly Mode currently supports up to ${MAX_ASSEMBLY_ROBOTS} robots.`);
        return current;
      }
      return [...current, path];
    });
  }, [assemblyQueuedSelections.length]);
  const selectSingleCandidatePath = useCallback((path: string) => {
    setSelectedCandidatePaths([path]);
  }, []);

  const handleSelectAllAssemblyCandidates = useCallback((visiblePaths?: string[]) => {
    const remainingSlots = Math.max(0, MAX_ASSEMBLY_ROBOTS - assemblyQueuedSelections.length);
    const availablePaths = dedupePathsPreserveOrder(
      (visiblePaths && visiblePaths.length > 0
        ? urdfCandidates.filter((candidate) => visiblePaths.includes(candidate.path))
        : urdfCandidates)
        .filter((candidate) => !isCandidateUnavailable(candidate))
        .map((candidate) => candidate.path)
    ).slice(0, remainingSlots);
    setSelectedCandidatePaths(availablePaths);
    if (remainingSlots === 0) {
      toast.error(`Assembly Mode currently supports up to ${MAX_ASSEMBLY_ROBOTS} robots.`);
    }
  }, [assemblyQueuedSelections.length, isCandidateUnavailable, urdfCandidates]);

  const handleOpenAssemblySource = useCallback((sourceKey: string) => {
    const source = assemblySources.find((item) => item.sourceKey === sourceKey);
    if (!source) {
      toast.error("Assembly source is no longer available.");
      return;
    }
    if (source.source.type === "github") {
      setGitHubSelectionSource(
        {
          owner: source.source.owner,
          repo: source.source.repo,
          path: source.source.path,
          branch: source.source.branch,
        },
        source.source.files
      );
    } else {
      setLocalSelectionSource(source.source.files);
    }
    openCandidateSelectionDialog(
      source.candidates,
      source.source.type === "local" ? source.source.files : null,
      { assemblySourceKey: source.sourceKey }
    );
  }, [
    assemblySources,
    openCandidateSelectionDialog,
    setGitHubSelectionSource,
    setLocalSelectionSource,
  ]);
  const handleRemoveAssemblySource = useCallback((sourceKey: string) => {
    setAssemblySources((current) => current.filter((source) => source.sourceKey !== sourceKey));
    setAssemblyQueuedSelections((current) =>
      current.filter((selection) => getAssemblySourceKey(selection) !== sourceKey)
    );
    if (activeAssemblySourceKey === sourceKey) {
      setActiveAssemblySourceKey(null);
      closeUrdfSelectionDialog({ clearSelection: true });
    }
  }, [activeAssemblySourceKey, closeUrdfSelectionDialog]);
  const handleRemoveAssemblyQueuedSelection = useCallback((id: string) => {
    setAssemblyQueuedSelections((current) => current.filter((item) => item.id !== id));
  }, []);
  const handleAssignSubstitutionTarget = useCallback(
    (target: SubstitutionTarget, selectionId: string) => {
      setSubstitutionAssignments((current) =>
        assignSubstitutionTarget(current, target, selectionId)
      );
    },
    []
  );
  const handleClearSubstitutionTarget = useCallback((target: SubstitutionTarget) => {
    setSubstitutionAssignments((current) => clearSubstitutionTarget(current, target));
  }, []);
  const clearLoadedRobotSelection = useCallback(() => {
    setLoadedRobotName(null);
  }, []);
  const clearStagedSetupRobot = useCallback(() => {
    setStagedSetupRobot(null);
  }, []);
  const clearAssemblyQueue = useCallback(() => {
    setAssemblyQueuedSelections([]);
    setSubstitutionAssignments(createEmptySubstitutionAssignments());
  }, []);
  const finalizeAssemblyQueueLoad = useCallback(
    (selectedPathsCount: number) => {
      clearLoadedRobotSelection();
      clearAssemblyQueue();
      toast.success(
        `Loaded ${selectedPathsCount} assembly robot${selectedPathsCount > 1 ? "s" : ""}.`
      );
    },
    [clearAssemblyQueue, clearLoadedRobotSelection]
  );

  const getSelectedPrimaryCandidate = useCallback((): URDFCandidate | null => {
    const selectedPath = selectedCandidatePaths[0];
    if (selectedPath) {
      return urdfCandidates.find((candidate) => candidate.path === selectedPath) ?? null;
    }
    return null;
  }, [selectedCandidatePaths, urdfCandidates]);

  const handleLoadRobotOnlyFromDialog = useCallback(async () => {
    const candidate = getSelectedPrimaryCandidate();
    if (!candidate) {
      toast.error("Select a URDF first.");
      return;
    }
    await handleUrdfSelect(candidate, { applyWorldLayout: false });
  }, [
    getSelectedPrimaryCandidate,
    handleUrdfSelect,
  ]);

  const handleSelectRobotForSetup = useCallback(() => {
    const candidate = getSelectedPrimaryCandidate();
    if (!candidate) {
      toast.error("Select a URDF first.");
      return;
    }
    setStagedSetupRobot({ path: candidate.path, name: candidate.name });
    closeUrdfSelectionDialog();
    toast.success(`Selected ${candidate.name} for setup`);
  }, [closeUrdfSelectionDialog, getSelectedPrimaryCandidate]);

  const handleLoadSetup = useCallback(async () => {
    onWorkspaceModeChange?.("studio");
    if (stagedSetupRobot) {
      const candidate = urdfCandidates.find((item) => item.path === stagedSetupRobot.path);
      if (!candidate) {
        toast.error("Selected robot source is no longer available. Reload it and select again.");
        return;
      }
      await handleUrdfSelect(candidate, { applyWorldLayout: true });
      return;
    }

    if (worldLayoutUrl.trim()) {
      const loaded = await loadWorldLayoutFromUrl(worldLayoutUrl);
      if (loaded) {
        toast.success("World setup loaded.");
      }
      return;
    }

    if (cameras.length > 0) {
      toast.success("Camera setup loaded.");
    }
  }, [
    cameras.length,
    handleUrdfSelect,
    loadWorldLayoutFromUrl,
    onWorkspaceModeChange,
    stagedSetupRobot,
    urdfCandidates,
    worldLayoutUrl,
  ]);
  const hasSetupSelection =
    Boolean(stagedSetupRobot) || cameras.length > 0 || worldLayoutUrl.trim().length > 0;

  const handleAssemblyLoadSelected = useCallback(async (): Promise<void> => {
    const activeSource =
      (activeAssemblySourceKey
        ? assemblySources.find((source) => source.sourceKey === activeAssemblySourceKey)
        : null) || null;
    if (!activeSource) {
      toast.error("Assembly source is missing. Load a source again.");
      return;
    }
    const selectedCandidates = urdfCandidates.filter((candidate) =>
      selectedCandidatePaths.includes(candidate.path)
    );
    if (selectedCandidates.length === 0) {
      toast.error("Select at least one URDF file to add.");
      return;
    }

    const remainingSlots = Math.max(0, MAX_ASSEMBLY_ROBOTS - assemblyQueuedSelections.length);
    if (remainingSlots === 0) {
      toast.error(`Assembly Mode currently supports up to ${MAX_ASSEMBLY_ROBOTS} robots.`);
      return;
    }
    const queueStamp = `${Date.now()}`;
    const queuedFromSource: AssemblyQueuedSelection[] = [];
    if (activeSource.source.type === "local") {
      const source = activeSource.source;
      const localSourcePrefix = sanitizePathToken(activeSource.sourceKey, "local_source");
      selectedCandidates.slice(0, remainingSlots).forEach((candidate, index) => {
        queuedFromSource.push({
          id: `${localSourcePrefix}::${queueStamp}::${candidate.path}::${index}`,
          name: candidate.name,
          sourcePrefix: localSourcePrefix,
          namespacedUrdfPath: toNamespacedPath(localSourcePrefix, candidate.path),
          source: {
            type: "local",
            folderLabel: source.folderLabel,
            localFiles: source.files,
            candidatePath: candidate.path,
          },
        });
      });
    } else if (activeSource.source.type === "github") {
      const source = activeSource.source;
      const repoBranchSegment = source.branch ? `/${source.branch}` : "/default";
      const repoPathSegment = source.path ? `/${source.path}` : "/root";
      const githubSourcePrefix = sanitizePathToken(
        `github/${source.owner}/${source.repo}${repoBranchSegment}${repoPathSegment}`,
        "github_source"
      );
      const repoUrl = source.url;
      selectedCandidates.slice(0, remainingSlots).forEach((candidate, index) => {
        queuedFromSource.push({
          id: `${githubSourcePrefix}::${queueStamp}::${candidate.path}::${index}`,
          name: candidate.name,
          sourcePrefix: githubSourcePrefix,
          namespacedUrdfPath: toNamespacedPath(githubSourcePrefix, candidate.path),
          source: {
            type: "github",
            owner: source.owner,
            repo: source.repo,
            path: source.path,
            branch: source.branch,
            url: repoUrl,
            files: source.files,
            candidatePath: candidate.path,
          },
        });
      });
    }

    setAssemblyQueuedSelections((current) => {
      const next = [...current];
      queuedFromSource.forEach((item) => {
        const itemSourceKey = getAssemblySourceKey(item);
        if (
          next.some(
            (queued) =>
              getAssemblySourceKey(queued) === itemSourceKey &&
              queued.source.candidatePath === item.source.candidatePath
          )
        ) {
          return;
        }
        next.push(item);
      });
      return next;
    });
    if (selectedCandidates.length > remainingSlots) {
      toast.warning(`Only the first ${remainingSlots} robot${remainingSlots > 1 ? "s were" : " was"} added. Assembly Mode is limited to ${MAX_ASSEMBLY_ROBOTS} robots for now.`);
    }
    closeUrdfSelectionDialog({ clearSelection: true });
  }, [
    activeAssemblySourceKey,
    assemblySources,
    assemblyQueuedSelections.length,
    closeUrdfSelectionDialog,
    selectedCandidatePaths,
    urdfCandidates,
  ]);

  const handleLoadAssemblyQueue = useCallback(async (): Promise<void> => {
    if (assemblyQueuedSelections.length === 0) {
      toast.error("Add robots to the assembly queue first.");
      return;
    }

    try {
      await withGitHubLoading(async () => {
        const mergedDataTransfer = new DataTransfer();
        const mergedRelativePaths = new Set<string>();
        const selectedPaths: string[] = [];
        const selectedPathSet = new Set<string>();
        const namesByPath: Record<string, string> = {};
        const sourceByPath: Record<string, AssemblyRobotInstance["source"]> = {};

        for (const queued of assemblyQueuedSelections) {
          const sourceContext: CandidateSourceContext =
            queued.source.type === "github"
              ? {
                  type: "github",
                  owner: queued.source.owner,
                  repo: queued.source.repo,
                  path: queued.source.path,
                  branch: queued.source.branch,
                  files: queued.source.files,
                }
              : {
                  type: "local",
                  files: queued.source.localFiles,
                };
          const sourceFileList = await buildFileListForCandidate(
            sourceContext,
            queued.source.candidatePath
          );

          const sourceUrdfFiles = Array.from(sourceFileList).filter((file) =>
            file.name.toLowerCase().endsWith(".urdf")
          );
          const primarySourceUrdf = sourceUrdfFiles[0] ?? null;
          const primaryRelativePath = primarySourceUrdf
            ? ((primarySourceUrdf as LocalWebkitFile).webkitRelativePath || primarySourceUrdf.name)
            : queued.source.candidatePath;
          const resolvedNamespacedUrdfPath = toNamespacedPath(queued.sourcePrefix, primaryRelativePath);

          Array.from(sourceFileList).forEach((file) => {
            const currentRelativePath =
              (file as LocalWebkitFile).webkitRelativePath || file.name;
            const nextRelativePath = toNamespacedPath(queued.sourcePrefix, currentRelativePath);
            if (mergedRelativePaths.has(nextRelativePath)) {
              return;
            }
            mergedRelativePaths.add(nextRelativePath);
            mergedDataTransfer.items.add(cloneWithRelativePath(file, nextRelativePath));
          });

          if (!selectedPathSet.has(resolvedNamespacedUrdfPath)) {
            selectedPathSet.add(resolvedNamespacedUrdfPath);
            selectedPaths.push(resolvedNamespacedUrdfPath);
            namesByPath[resolvedNamespacedUrdfPath] = queued.name;
            sourceByPath[resolvedNamespacedUrdfPath] =
              queued.source.type === "github"
                ? {
                    type: "github",
                    owner: queued.source.owner,
                    repo: queued.source.repo,
                    path: queued.source.path,
                    branch: queued.source.branch,
                    url: queued.source.url,
                  }
                : {
                    type: "local",
                    folder: queued.source.folderLabel || undefined,
                  };
          }
        }

        onWorkspaceModeChange?.("assembly");
        clearGitHubSource();
        await finalizeRobotLoad(mergedDataTransfer.files, { applyWorldLayout: false });
        setAssemblySelectedUrdfPaths(selectedPaths, namesByPath, sourceByPath);
        finalizeAssemblyQueueLoad(selectedPaths.length);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load assembly queue";
      toast.error(message);
    }
  }, [
    assemblyQueuedSelections,
    buildFileListForCandidate,
    clearGitHubSource,
    finalizeAssemblyQueueLoad,
    finalizeRobotLoad,
    onWorkspaceModeChange,
    setAssemblySelectedUrdfPaths,
    withGitHubLoading,
  ]);

  /**
   * Load a repository from recent repos
   */
  const loadRecentRepo = useCallback(
    async (recentRepo: { owner: string; repo: string; path?: string; url: string }): Promise<void> => {
      // Set the URL in the input field
      setGithubUrl(recentRepo.url);
      const parsedRecentRepo = parseGitHubUrl(recentRepo.url);
      try {
        const sourceInfo = {
          owner: recentRepo.owner,
          repo: recentRepo.repo,
          path: recentRepo.path,
          branch: parsedRecentRepo?.branch,
        };
        await withGitHubLoading(async () => {
          await openGitHubCandidateSelection(sourceInfo, {
            sourceUrl: recentRepo.url,
          });
        });
      } catch (error) {
        reportGitHubLoadError(error);
        console.error("GitHub repo load error:", error);
      }
    },
    [
      openGitHubCandidateSelection,
      reportGitHubLoadError,
      withGitHubLoading,
    ]
  );

  /**
   * Handle removing a recent repo (with event stopPropagation to prevent loading)
   */
  const handleRemoveRecentRepo = useCallback(
    (e: React.MouseEvent, recentRepo: { owner: string; repo: string; path?: string }): void => {
      e.stopPropagation();
      removeRecentRepo(recentRepo.owner, recentRepo.repo, recentRepo.path);
      toast.success("Removed from recent repositories");
    },
    [removeRecentRepo]
  );
  const handleLoadRecentGalleryRepo = useCallback(async (
    recentRepo: { owner: string; repo: string; path?: string; url: string }
  ): Promise<void> => {
    setGalleryGithubUrl(recentRepo.url);
    const parsedRecentRepo = parseGitHubUrl(recentRepo.url);
    const sourceInfo = {
      owner: recentRepo.owner,
      repo: recentRepo.repo,
      path: recentRepo.path,
      branch: parsedRecentRepo?.branch,
    };
    await startGalleryInspectionJob(sourceInfo, recentRepo.url);
  }, [setGalleryGithubUrl, startGalleryInspectionJob]);

  const logoUrl = `${import.meta.env.BASE_URL}assets/urdf-studio-logo.png`;
  const entryOptions = VISIBLE_FOLDER_UPLOAD_ENTRY_MODE_CONFIGS.map(({ id, label }) => ({ id, label }));
  const activeLoaderDescription = entryMode.loaderDescription;
  const launcherActionButtonClass =
    "h-8 min-w-[172px] rounded-md border border-border/70 bg-muted/30 px-3 text-[12px] font-medium text-foreground hover:bg-muted/45 disabled:border-border/60 disabled:bg-muted/20 disabled:text-muted-foreground";
  const galleryActionButtonClass =
    "h-7 rounded-md border border-border/70 bg-muted/25 px-2.5 text-[11px] font-medium text-foreground hover:bg-muted/40 disabled:border-border/60 disabled:bg-muted/20 disabled:text-muted-foreground";
  const galleryCompactLoadButtonClass =
    "h-9 w-9 shrink-0 rounded-md border border-border/70 bg-muted/30 px-0 text-foreground hover:bg-muted/45 disabled:border-border/60 disabled:bg-muted/20 disabled:text-muted-foreground";
  const galleryOverviewLayoutClass =
    "grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)] lg:items-start";
  const galleryCardGridClass = "grid gap-5 lg:col-span-2 xl:grid-cols-2";
  const galleryMetadataFieldGridClass = "grid gap-2 md:grid-cols-2 xl:grid-cols-3";
  const gallerySourceControlsDisabled = isGallerySourceBusy || entryLoadInteractionsDisabled;
  const galleryLoadButtonDisabled = gallerySourceControlsDisabled || !galleryGithubUrl.trim();
  const renderRecentRepoChip = (
    repo: { owner: string; repo: string; path?: string; displayName: string; url: string },
    onClick: () => void
  ) => (
    <div
      key={`${repo.owner}/${repo.repo}${repo.path ? `/${repo.path}` : ""}`}
      className={`group relative flex w-fit max-w-full items-center gap-0.5 rounded-md border border-border/30 bg-background/14 px-1 py-0.5 transition-colors ${
        entryLoadInteractionsDisabled
          ? "cursor-not-allowed opacity-60"
          : "cursor-pointer hover:border-border/45 hover:bg-background/22"
      }`}
      onClick={() => {
        if (!entryLoadInteractionsDisabled) {
          onClick();
        }
      }}
    >
      <span className="text-muted-foreground/80">
        <Github className="w-3 h-3 flex-shrink-0" />
      </span>
      <span className="max-w-[132px] truncate whitespace-nowrap text-[11px] font-medium text-muted-foreground">{repo.displayName}</span>
      <button
        onClick={(event) => {
          if (!entryLoadInteractionsDisabled) {
            handleRemoveRecentRepo(event, repo);
          }
        }}
        disabled={entryLoadInteractionsDisabled}
        className="opacity-0 group-hover:opacity-100 flex-shrink-0 rounded p-0.5 transition-opacity hover:bg-destructive/20"
        aria-label="Remove from recent"
      >
        <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
      </button>
    </div>
  );
  const renderGalleryLoader = () => (
    <div className="space-y-6">
      <div className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-background/40 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium text-foreground">GitHub Source</p>
            <p className="text-xs text-muted-foreground">Generate gallery cards, previews, and publish assets from a GitHub repo or folder.</p>
          </div>
          <div className="flex min-w-0 flex-[1.5] flex-col gap-2 sm:flex-row">
            <Input
              type="text"
              placeholder="owner/repo or https://github.com/owner/repo"
              value={galleryGithubUrl}
              onChange={(event) => setGalleryGithubUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                }
              }}
              disabled={gallerySourceControlsDisabled}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void handleGalleryGithubLoad();
              }}
              disabled={galleryLoadButtonDisabled}
              className={galleryCompactLoadButtonClass}
              aria-label={gallerySourceControlsDisabled ? "Loading GitHub gallery source" : "Load GitHub gallery source"}
              title="Load GitHub gallery source"
            >
              {isGallerySourceBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onWorkspaceModeChange?.("studio");
              leaveGalleryEditorMode();
            }}
            disabled={entryLoadInteractionsDisabled}
            className={galleryActionButtonClass}
          >
            Back to Studio
          </Button>
        </div>
        <div className="mt-3 space-y-1">
          <p
            className={`text-xs ${
              isGallerySourceBusy ? "text-foreground" : "text-muted-foreground"
            }`}
            aria-live="polite"
          >
            {galleryStatusLabel}
          </p>
          {recentRepos.length === 0 ? (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>recent robots:</span>
              <span className="text-xs">No recent robot sources yet.</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>recent robots:</span>
              </div>
              {recentRepos.map((repo) => renderRecentRepoChip(repo, () => {
                void handleLoadRecentGalleryRepo(repo);
              }))}
            </div>
          )}
        </div>
      </div>
      {galleryEntriesError ? (
        <div className="rounded-lg border border-border bg-background/40 p-4 text-sm text-muted-foreground">
          {galleryEntriesError}
        </div>
      ) : isGalleryLoadingVisible ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Scanning Gallery Repo
                </span>
                {gallerySourceLabel ? (
                  <span className="rounded border border-border/50 bg-background/50 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {gallerySourceLabel}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1 rounded border border-border/50 bg-background/50 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {galleryElapsedLabel}
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Inspecting the repository and preparing gallery cards.
                </p>
                <p className="text-sm text-muted-foreground">
                  {galleryStatusLabel} Large repos can take a few minutes, but the scan is still running.
                </p>
                {showGallerySlowNotice ? (
                  <p className="text-xs text-muted-foreground">
                    This repo is taking longer than usual. Keep this panel open while we finish indexing the robots and their media.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <div className={galleryCardGridClass}>
            {Array.from({ length: GALLERY_LOADING_PLACEHOLDER_CARD_COUNT }, (_, index) => (
              <div
                key={`gallery-loading-card-${index}`}
                data-testid="gallery-loading-card"
                className="overflow-hidden rounded-xl border border-border/80 bg-background/50 shadow-[0_10px_28px_rgba(0,0,0,0.08)]"
              >
                <div className="grid grid-cols-2 gap-px border-b border-border/70 bg-border/70">
                  <div className="aspect-[1.18] animate-pulse bg-muted/30" />
                  <div className="aspect-[1.18] animate-pulse bg-muted/20" />
                </div>
                <div className="space-y-3 p-4">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-muted/30" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted/20" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-muted/20" />
                  <div className="flex gap-2 pt-1">
                    <div className="h-8 w-28 animate-pulse rounded bg-muted/25" />
                    <div className="h-8 w-32 animate-pulse rounded bg-muted/20" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : galleryEntries.length === 0 ? null : (
        <div className="space-y-4">
          <div className={galleryOverviewLayoutClass}>
          {galleryEntries.length > 0 ? (
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <div className="flex flex-col gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-base font-medium text-foreground">
                    {galleryRepoNotCataloged
                      ? "This repo is not in the robot gallery catalog yet."
                      : galleryMediaCounts.mediaMissing > 0
                        ? "Some robots are missing gallery assets."
                        : "Regenerate image and video assets for this repo or selected robots."}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Select the robots you want to update, then use <span className="font-medium text-foreground">Load Into Studio</span> on a card to open that robot in the main workspace.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {gallerySourceLabel ? <span>{gallerySourceLabel}</span> : null}
                    <span className="rounded border border-border/50 bg-background/50 px-1.5 py-0.5">{galleryEntries.length} robots</span>
                    <span className="rounded border border-border/50 bg-background/50 px-1.5 py-0.5">{gallerySelectedTargets.length} selected</span>
                    <span className="rounded border border-border/50 bg-background/50 px-1.5 py-0.5">{galleryMediaCounts.imageMissing} image missing</span>
                    <span className="rounded border border-border/50 bg-background/50 px-1.5 py-0.5">{galleryMediaCounts.videoMissing} video missing</span>
                  </div>
                  {galleryGenerationProgressLabel ? (
                    <p
                      className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-muted/25 px-2.5 py-1.5 text-xs font-medium text-foreground"
                      aria-live="polite"
                    >
                      {galleryGenerationCompleted ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {galleryGenerationProgressLabel}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Generate</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          void handleGenerateGalleryAssets("selected", galleryMissingTargets);
                        }}
                        disabled={
                          galleryGenerationInFlight ||
                          !galleryJob ||
                          galleryMissingTargets.length === 0
                        }
                        className={galleryActionButtonClass}
                      >
                        {galleryGenerationInFlight ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {galleryGenerationInFlight ? galleryGenerationButtonLabel : "Generate Missing"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          void handleGenerateGalleryAssets("selected");
                        }}
                        disabled={
                          galleryGenerationInFlight ||
                          !galleryJob ||
                          gallerySelectedEntries.length === 0
                        }
                        className={galleryActionButtonClass}
                      >
                        {galleryGenerationInFlight ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {galleryGenerationInFlight ? galleryGenerationButtonLabel : "Generate Selected"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          void handleGenerateGalleryAssets("repo");
                        }}
                        disabled={galleryGenerationInFlight || !galleryJob}
                        className={galleryActionButtonClass}
                      >
                        {galleryGenerationInFlight ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {galleryGenerationInFlight ? galleryGenerationButtonLabel : "Generate Repo"}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Selection</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" onClick={selectAllGalleryEntries} className={galleryActionButtonClass}>
                        Select All
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={selectMissingGalleryEntries}
                        disabled={galleryMissingMediaEntries.length === 0}
                        className={galleryActionButtonClass}
                      >
                        Select Missing
                      </Button>
                      <Button type="button" size="sm" onClick={clearGalleryEntrySelection} className={galleryActionButtonClass}>
                        Clear Selection
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Publish</p>
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={handlePublishGalleryPr}
                          disabled={
                            !galleryJob ||
                            galleryJob.status !== "completed" ||
                            isPublishingGalleryPr ||
                            galleryMetadataDirty ||
                            !galleryHasPendingPublishChanges
                          }
                          className={galleryActionButtonClass}
                        >
                          {isPublishingGalleryPr ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                          Publish PR
                        </Button>
                        {galleryPublishedPr ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              window.open(galleryPublishedPr.pullRequestUrl, "_blank", "noopener,noreferrer");
                            }}
                            className={galleryActionButtonClass}
                          >
                            Open PR #{galleryPublishedPr.pullRequestNumber}
                          </Button>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleDownloadGalleryBundle}
                        disabled={!galleryJob || galleryJob.status !== "completed"}
                        className={galleryActionButtonClass}
                      >
                        Download Bundle
                      </Button>
                      {galleryMetadataDirty ? (
                        <p className="text-xs text-amber-200">Save metadata edits before publishing.</p>
                      ) : galleryHasPendingPublishChanges ? (
                        <div className="space-y-1.5 rounded-md border border-border/60 bg-background/30 p-2">
                          <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                            {galleryPendingPublishState.hasGeneratedAssets ? (
                              <span className="rounded border border-border/50 bg-background/50 px-1.5 py-0.5">
                                Generated gallery assets
                              </span>
                            ) : null}
                            {galleryPendingPublishState.repoMetadataFieldLabels.length > 0 ? (
                              <span className="rounded border border-border/50 bg-background/50 px-1.5 py-0.5">
                                {galleryPendingPublishState.repoMetadataFieldLabels.length} repo metadata field{galleryPendingPublishState.repoMetadataFieldLabels.length === 1 ? "" : "s"}
                              </span>
                            ) : null}
                            {galleryPendingPublishState.renamedRobots.length > 0 ? (
                              <span className="rounded border border-border/50 bg-background/50 px-1.5 py-0.5">
                                {galleryPendingPublishState.renamedRobots.length} robot title change{galleryPendingPublishState.renamedRobots.length === 1 ? "" : "s"}
                              </span>
                            ) : null}
                            {galleryPublishPreview ? (
                              <span className="rounded border border-border/50 bg-background/50 px-1.5 py-0.5">
                                {galleryPublishPreview.files.length} files ready
                              </span>
                            ) : null}
                          </div>
                          {isLoadingGalleryPublishPreview ? (
                            <p className="text-xs text-muted-foreground">Preparing PR file preview…</p>
                          ) : galleryPublishPreview ? (
                            <div className="space-y-1 text-xs text-muted-foreground">
                              {galleryPendingPublishState.repoMetadataFieldLabels.length > 0 ? (
                                <p>
                                  Repo fields:{" "}
                                  <span className="text-foreground/85">
                                    {galleryPendingPublishState.repoMetadataFieldLabels.join(", ")}
                                  </span>
                                </p>
                              ) : null}
                              {galleryPendingPublishState.renamedRobots.length > 0 ? (
                                <div className="space-y-1">
                                  {galleryPendingPublishState.renamedRobots.map((change) => (
                                    <p key={change.id} className="break-all">
                                      Robot rename:{" "}
                                      <span className="text-foreground/85">{change.previousTitle}</span>
                                      {" -> "}
                                      <span className="text-foreground/85">{change.nextTitle}</span>
                                    </p>
                                  ))}
                                </div>
                              ) : null}
                              <p>
                                PR target: <span className="font-mono text-foreground/85">{galleryPublishPreview.repoSlug}</span>
                                {" · "}
                                branch <span className="font-mono text-foreground/85">{galleryPublishPreview.branchName}</span>
                              </p>
                              <div className="space-y-1">
                                {galleryPublishPreviewFilePaths.slice(0, 4).map((filePath) => (
                                  <p key={filePath} className="font-mono text-[11px] text-foreground/75 break-all">
                                    {filePath}
                                  </p>
                                ))}
                                {galleryPublishPreviewFilePaths.length > 4 ? (
                                  <p className="text-[11px] text-muted-foreground">
                                    +{galleryPublishPreviewFilePaths.length - 4} more files
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">Pending changes will be published as a PR.</p>
                          )}
                        </div>
                      ) : galleryPublishedPr ? (
                        <p className="text-xs text-muted-foreground">
                          Published to PR #{galleryPublishedPr.pullRequestNumber}. New metadata saves or asset generation will queue the next update.
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No unpublished gallery changes yet. Generate assets or save metadata edits to create a PR.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {galleryJob ? (
            <div className="min-w-0 rounded-lg border border-border bg-background/40 p-4">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-foreground">
                        Published Metadata
                      </p>
                      {gallerySourceLabel ? (
                        <span className="rounded border border-border/50 bg-background/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {gallerySourceLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isEditingGalleryMetadata ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          void handleSaveGalleryMetadata();
                        }}
                        disabled={!galleryMetadataDirty || isSavingGalleryMetadata || !galleryJob}
                        className={galleryActionButtonClass}
                      >
                        {isSavingGalleryMetadata ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                        Save
                      </Button>
                    ) : null}
                    <button
                      type="button"
                      onClick={toggleGalleryMetadataEditing}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                      aria-label="Edit published metadata"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className={galleryMetadataFieldGridClass}>
                  {GALLERY_REPO_METADATA_VISIBLE_FIELDS.map((field: GalleryRepoMetadataField) => (
                    <label
                      key={field.key}
                      className={`space-y-1 text-[10px] text-muted-foreground${field.columnClassName ? ` ${field.columnClassName}` : ""}`}
                    >
                      <span>{field.label}</span>
                      <Input
                        value={getGalleryRepoMetadataFieldInputValue(galleryRepoMetadataDraft, field)}
                        onChange={(event) => {
                          updateGalleryRepoMetadataDraftField(field, event.target.value);
                        }}
                        placeholder="Empty"
                        readOnly={!isEditingGalleryMetadata}
                        disabled={!isEditingGalleryMetadata}
                        className="h-8 text-xs"
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          <div className={galleryCardGridClass}>
            {galleryEntries.map((entry) => {
              const mediaState = resolveGalleryEntryMediaState(entry);
              const generateAction = resolveGalleryEntryGenerateAction(entry);
              const isInlineEditing = galleryActiveInlineEditorId === entry.id;
              const isGeneratingEntryAssets =
                galleryGenerationInFlight && activeGalleryGenerateEntryId === entry.id;
              const isCardGenerateDisabled =
                entryLoadInteractionsDisabled ||
                galleryGenerationInFlight ||
                !galleryJob ||
                galleryJob.status === "running";
              const robotMacroTag = buildGalleryRobotMacroTag(entry);
              const robotStructureLine = buildGalleryRobotStructureLine(entry);
              const robotLimbLine = buildGalleryRobotLimbLine(entry);
              const robotAttentionNotes = buildGalleryRobotAttentionNotes(entry);

              return (
              <div key={entry.id} className="overflow-hidden rounded-xl border border-border/80 bg-background/50 shadow-[0_10px_28px_rgba(0,0,0,0.08)]">
                <div className="grid grid-cols-2 gap-px border-b border-border/70 bg-border/70">
                  <div className="aspect-[1.18] bg-muted/25">
                    {entry.thumbnailUrl ? (
                      <img
                        src={entry.thumbnailUrl}
                        alt={`${entry.title} thumbnail`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-muted/25">
                        <img src={logoUrl} alt="" className="h-16 w-auto opacity-50" />
                      </div>
                    )}
                  </div>
                  <div className="aspect-[1.18] bg-muted/25">
                    {entry.videoUrl ? (
                      <video
                        src={entry.videoUrl}
                        poster={entry.thumbnailUrl || undefined}
                        className="h-full w-full object-cover"
                        autoPlay
                        loop
                        muted
                        playsInline
                      />
                    ) : entry.previewUrl ? (
                      <img
                        src={entry.previewUrl}
                        alt={`${entry.title} animated preview`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-muted/25">
                        <img src={logoUrl} alt="" className="h-16 w-auto opacity-50" />
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-4 p-5">
                  <div className="space-y-3">
                    <div className="flex flex-col gap-4">
                      {isInlineEditing ? (
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex items-center gap-2">
                            <Input
                              value={galleryItemTitleDrafts[entry.id] ?? entry.title}
                              onChange={(event) => {
                                setGalleryItemTitleDraft(entry.id, event.target.value);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  keepGalleryItemTitleDraft(entry.id, entry.title);
                                  return;
                                }
                                if (event.key === "Escape") {
                                  discardGalleryItemTitleDraft(entry.id);
                                }
                              }}
                              className="h-10 text-base font-medium"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                keepGalleryItemTitleDraft(entry.id, entry.title);
                              }}
                              disabled={galleryJob?.status === "running"}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
                              aria-label="Keep card title draft"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                discardGalleryItemTitleDraft(entry.id);
                              }}
                              disabled={galleryJob?.status === "running"}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
                              aria-label="Discard card title draft"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex items-start gap-2">
                            <p className="text-base font-semibold leading-6 text-foreground break-words">
                              {galleryItemTitleDrafts[entry.id] ?? entry.title}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                startGalleryInlineEditor(entry.id);
                              }}
                              disabled={galleryJob?.status === "running"}
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
                              aria-label="Edit card metadata"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="space-y-2 text-sm text-muted-foreground">
                            <p className="text-xs leading-5 break-all font-mono text-foreground/85">
                              {resolveGalleryEntrySourceFile(entry)}
                            </p>
                            {robotMacroTag ? (
                              <p className="text-sm font-medium text-foreground/90">{robotMacroTag}</p>
                            ) : null}
                            {robotStructureLine ? (
                              <p className="text-sm text-muted-foreground">{robotStructureLine}</p>
                            ) : null}
                            {robotLimbLine ? (
                              <p className="text-sm text-muted-foreground">{robotLimbLine}</p>
                            ) : null}
                            {robotAttentionNotes.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {robotAttentionNotes.map((note) => (
                                  <span
                                    key={`${entry.id}-note-${note}`}
                                    className="rounded-md border border-border/60 bg-muted/25 px-2 py-0.5 text-[11px] text-muted-foreground"
                                  >
                                    {note}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            <details className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
                              <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                Technical source details
                              </summary>
                              <div className="mt-2 space-y-1.5">
                                <p className="text-xs leading-5 break-all">
                                  Source path: <span className="font-mono text-foreground/85">{resolveGalleryEntrySourcePath(entry)}</span>
                                </p>
                                {entry.galleryFileBase ? (
                                  <p className="text-xs leading-5 break-all">
                                    Asset base: <span className="font-mono text-foreground/85">{entry.galleryFileBase}</span>
                                  </p>
                                ) : null}
                              </div>
                            </details>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
                      <div />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex h-9 items-center gap-2 px-1 text-sm text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={gallerySelectedEntryIds.includes(entry.id)}
                            disabled={entryLoadInteractionsDisabled}
                            onChange={() => {
                              toggleGalleryEntrySelection(entry.id);
                            }}
                            className="h-4 w-4 appearance-none rounded-sm border-2 border-muted-foreground/35 bg-transparent transition-colors checked:border-muted-foreground/55 checked:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground/20"
                          />
                          Select
                        </label>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            void handleGenerateGalleryEntryAssets(entry);
                          }}
                          disabled={isCardGenerateDisabled}
                          className={`${galleryActionButtonClass} min-w-[112px]`}
                        >
                          {isGeneratingEntryAssets ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          {isGeneratingEntryAssets ? galleryGenerationButtonLabel : generateAction.label}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            void handleOpenGalleryEntry(entry);
                          }}
                          disabled={entryLoadInteractionsDisabled}
                          className={`${galleryActionButtonClass} min-w-[132px]`}
                        >
                          {activeGalleryEntryLoadId === entry.id ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Load Into Studio
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        </div>
        </div>
      )}
    </div>
  );
  const renderWorldLayoutLoader = (title: string) => (
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
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setWorldSourceDropActive(false);
        const file = event.dataTransfer.files?.[0];
        if (!file) {
          toast.error("No local file was dropped.");
          return;
        }
        void processWorldLayoutFile(file);
      }}
    >
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{title}</p>
      </div>
      <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
          <p>Paste a world link or browse local JSON. Public and GitHub file links are supported.</p>
        </div>
        <a
          href={WORLD_LAYOUT_GALLERY_URL}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 inline-block text-xs text-[#ff63d5]/60 underline-offset-2 hover:text-[#ff63d5]/80 hover:underline"
        >
          Explore Gallery →
        </a>
      </div>
      {renderCompactSourceIntake({
        isDropActive: worldSourceDropActive,
        isPreparing: isLoadingWorldLayout,
        localLabel: "Drag world JSON",
        onBrowseLocal: handleWorldLayoutFileButtonClick,
        inputPlaceholder: "https://.../world-layout.json",
        inputValue: worldLayoutUrl,
        onInputValueChange: setWorldLayoutUrl,
        onLoadRemote: importWorldLayoutFromInput,
        loadDisabled: isLoadingWorldLayout || !worldLayoutUrl.trim(),
        isLoading: isLoadingWorldLayout,
        onDropFile: processWorldLayoutFile,
        disabled: entryLoadInteractionsDisabled,
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
      ) : renderRecentLinkPanel({
        title: "Recent World Layouts",
        emptyLabel: "No recent world layouts yet.",
        entries: recentWorldLayouts,
        onLoadUrl: loadWorldLayoutFromUrl,
        onRemoveUrl: (url) => removeRecentWorldLayout(url),
        removeSuccessMessage: "Removed from recent world layouts",
        lastLocalLabel: lastLocalWorldLayout,
        onBrowseLocal: handleWorldLayoutFileButtonClick,
        onClearLocal: clearLastLocalWorldLayout,
        clearLocalSuccessMessage: "Cleared last local world layout",
        disabled: entryLoadInteractionsDisabled,
      })}
    </div>
  );

  const renderRobotLoader = (title: string) => (
    <FolderUploadRobotLoader
      title={title}
      entryMode={entryMode}
      isLoadingGithub={isLoadingGithub}
      isLoadInteractionLocked={entryLoadInteractionsDisabled}
      isPreparingLocalSource={isPreparingDroppedRobotSource}
      isRobotSourceDropActive={robotSourceDropActive}
      githubUrl={githubUrl}
      githubLoadButtonDisabled={githubLoadButtonDisabled}
      githubLoadButtonLabel={githubLoadButtonLabel}
      loadedRobotName={loadedRobotName}
      stagedSetupRobotName={stagedSetupRobot?.name ?? null}
      recentRepos={recentRepos}
      lastLocalFolder={lastLocalFolder}
      assemblySources={assemblySources.map((source) => ({
        sourceKey: source.sourceKey,
        sourceLabel: source.sourceLabel,
        candidateCount: source.candidates.length,
        selectedCount: assemblyQueuedSelections.filter(
          (selection) => getAssemblySourceKey(selection) === source.sourceKey
        ).length,
      }))}
      activeAssemblySourceLabel={
        activeAssemblySourceKey
          ? assemblySources.find((source) => source.sourceKey === activeAssemblySourceKey)?.sourceLabel || null
          : null
      }
      assemblyQueuedSelections={assemblyQueuedSelectionPreviews}
      assemblyQueuedSelectionCount={assemblyQueuedSelections.length}
      maxAssemblyRobots={MAX_ASSEMBLY_ROBOTS}
      substitutionAssignments={substitutionAssignments}
      showUrdfDialog={showUrdfDialog}
      candidateDialogTitle={candidateDialogTitle}
      candidateDialogDescription={candidateDialogDescription}
      urdfCandidates={urdfCandidates}
      candidateGalleryPreviewByPath={studioCandidateGalleryPreviewByPath}
      candidateGalleryPublishedRepo={studioCandidateGalleryPublishedRepo}
      isLoadingCandidateGalleryPreviews={isLoadingStudioCandidateGalleryPreview}
      selectedCandidatePaths={selectedCandidatePaths}
      localSelectionFilesPresent={Boolean(localSelectionFiles && localSelectionFiles.length > 0)}
      xacroGateUnavailableSuffix={xacroGate.enabled ? "" : xacroGate.unavailableSuffix}
      xacroGateUnavailableMessage={xacroGateUnavailableMessage}
      hasSelectedPrimaryCandidate={Boolean(getSelectedPrimaryCandidate())}
      onGithubUrlChange={setGithubUrl}
      onGithubLoad={handleGithubLoad}
      onBrowseFolder={handleButtonClick}
      onBrowseFiles={handleLocalFilesButtonClick}
      onRobotSourceDragEnter={handleRobotSourceDragEnter}
      onRobotSourceDragOver={handleRobotSourceDragOver}
      onRobotSourceDragLeave={handleRobotSourceDragLeave}
      onRobotSourceDrop={handleRobotSourceDrop}
      onLoadRecentRepo={loadRecentRepo}
      onRemoveRecentRepo={handleRemoveRecentRepo}
      onClearLastLocalFolder={clearLastLocalFolder}
      onClearLoadedRobotSelection={clearLoadedRobotSelection}
      onClearStagedSetupRobot={clearStagedSetupRobot}
      onClearAssemblyQueue={clearAssemblyQueue}
      onOpenAssemblySource={handleOpenAssemblySource}
      onRemoveAssemblySource={handleRemoveAssemblySource}
      onRemoveAssemblyQueuedSelection={handleRemoveAssemblyQueuedSelection}
      onAssignSubstitutionTarget={handleAssignSubstitutionTarget}
      onClearSubstitutionTarget={handleClearSubstitutionTarget}
      onCloseUrdfDialog={closeUrdfSelectionDialog}
      onSelectAllAssemblyCandidates={handleSelectAllAssemblyCandidates}
      onClearAssemblyCandidates={clearSelectedCandidatePaths}
      onToggleAssemblyCandidate={toggleAssemblyCandidate}
      onSelectSingleCandidate={selectSingleCandidatePath}
      onAssemblyLoadSelected={handleAssemblyLoadSelected}
      onLoadRobotOnlyFromDialog={handleLoadRobotOnlyFromDialog}
      onSelectRobotForSetup={handleSelectRobotForSetup}
      onEditCandidateGalleryCards={() => {
        void openGalleryEditorForStudioSource();
      }}
    />
  );

  const handleOpenSubstitutionWorkspace = useCallback(async (): Promise<void> => {
    const hostSelection = substitutionQueuedSelections.host;
    const elementSelection = substitutionQueuedSelections.element;
    if (!hostSelection || !elementSelection) {
      toast.error("Assign both a host and an element from the queue before opening substitution.");
      return;
    }

    const hostFiles = await buildFileListForCandidate(
      getAssemblyQueuedSelectionSourceContext(hostSelection),
      hostSelection.source.candidatePath
    );
    const elementFiles = await buildFileListForCandidate(
      getAssemblyQueuedSelectionSourceContext(elementSelection),
      elementSelection.source.candidatePath
    );
    const launchPlan = buildSubstitutionWorkspaceLaunchPlan(
      {
        candidate: {
          path: hostSelection.source.candidatePath,
          name: hostSelection.name,
        },
        source:
          hostSelection.source.type === "github"
            ? {
                type: "github",
                owner: hostSelection.source.owner,
                repo: hostSelection.source.repo,
                path: hostSelection.source.path,
                branch: hostSelection.source.branch,
              }
            : {
                type: "local",
                folder: hostSelection.source.folderLabel || undefined,
              },
        files: hostFiles,
      },
      {
        candidate: {
          path: elementSelection.source.candidatePath,
          name: elementSelection.name,
        },
        source:
          elementSelection.source.type === "github"
            ? {
                type: "github",
                owner: elementSelection.source.owner,
                repo: elementSelection.source.repo,
                path: elementSelection.source.path,
                branch: elementSelection.source.branch,
              }
            : {
                type: "local",
                folder: elementSelection.source.folderLabel || undefined,
              },
        files: elementFiles,
      }
    );

    onWorkspaceModeChange?.("assembly");
    clearGitHubSource();
    await finalizeRobotLoad(createFileListFromFiles(launchPlan.files), { applyWorldLayout: false });
    setAssemblySelectedUrdfPaths(
      launchPlan.selectedPaths,
      launchPlan.namesByPath,
      launchPlan.sourceByPath,
      launchPlan.roleByPath
    );
    toast.success(
      `Opened substitution workspace with ${launchPlan.selectedPaths.length} robot${launchPlan.selectedPaths.length === 1 ? "" : "s"}.`
    );
  }, [
    buildFileListForCandidate,
    clearGitHubSource,
    finalizeRobotLoad,
    onWorkspaceModeChange,
    setAssemblySelectedUrdfPaths,
    substitutionQueuedSelections.element,
    substitutionQueuedSelections.host,
  ]);

  const renderSubstitutionStageCard = (target: SubstitutionTarget) => {
    const selection = substitutionQueuedSelections[target];
    return (
      <div className="rounded-md border border-border/70 bg-background/35 p-3">
        <div className="flex items-center gap-2">
          <Redo2 className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            {target === "host" ? "Host" : "Element"}
          </p>
        </div>
        {selection ? (
          <div className="mt-2 space-y-1">
            <p className="text-xs font-medium text-foreground">{selection.name}</p>
            <p className="text-xs text-muted-foreground">{selection.source.candidatePath}</p>
            <p className="text-[11px] text-muted-foreground">
              {getAssemblyQueuedSelectionSourceLabel(selection)}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Assign this from the shared queue below.
          </p>
        )}
      </div>
    );
  };
  const renderAssemblyWorkflowWorkspace = () => (
    <div className="space-y-4">
      <div className={ASSEMBLY_SUMMARY_CARD_CLASS}>
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Assembly</p>
          <h2 className="text-base font-semibold text-foreground">Multi-robot and substitution live together here</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Load sources once, queue robots for multi-robot assembly on the left, or stage a host and element for substitution on the right.
          </p>
        </div>
        <div className="space-y-3">
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">Multi-Robot Assembly</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use the shared source list and queue, then open one combined assembly workspace.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => {
                  void handleLoadAssemblyQueue();
                }}
                disabled={assemblyQueuedSelections.length === 0 || isLoadingGithub}
                size="sm"
                className={launcherActionButtonClass}
              >
                {isLoadingGithub ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                {`Open Assembly (${assemblyQueuedSelections.length})`}
              </Button>
            </div>
          </div>
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Redo2 className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">Substitution</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use the same queue. Mark one queued robot as `Host` and another as `Element`, then open substitution.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  void handleOpenSubstitutionWorkspace();
                }}
                disabled={!substitutionQueuedSelections.host || !substitutionQueuedSelections.element || isPreparingDroppedRobotSource}
                className={launcherActionButtonClass}
              >
                {isPreparingDroppedRobotSource ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                Open Substitution
              </Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {renderSubstitutionStageCard("host")}
              {renderSubstitutionStageCard("element")}
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        {renderRobotLoader(entryMode.robotLoaderTitle)}
      </div>
    </div>
  );
  const renderRecentLinkPanel = ({
    title,
    emptyLabel,
    entries,
    onLoadUrl,
    onRemoveUrl,
    removeSuccessMessage,
    lastLocalLabel,
    onBrowseLocal,
    onClearLocal,
    clearLocalSuccessMessage,
    disabled = false,
  }: {
    title: string;
    emptyLabel: string;
    entries: Array<{ url: string; label: string }>;
    onLoadUrl: (url: string) => void | Promise<unknown>;
    onRemoveUrl: (url: string) => void;
    removeSuccessMessage: string;
    lastLocalLabel: string | null;
    onBrowseLocal: () => void;
    onClearLocal: () => void;
    clearLocalSuccessMessage: string;
    disabled?: boolean;
  }) => (
    <div className="space-y-1">
      {entries.length === 0 && !lastLocalLabel ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{`${title.toLowerCase()}:`}</span>
          <span className="text-xs">{emptyLabel}</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{`${title.toLowerCase()}:`}</span>
          </div>
          {entries.map((entry) => (
            <div
              key={entry.url}
              className={`group relative flex w-fit max-w-full items-center gap-0.5 rounded-md border border-border/30 bg-background/14 px-1 py-0.5 transition-colors ${
                disabled
                  ? "cursor-not-allowed opacity-60"
                  : "cursor-pointer hover:border-border/45 hover:bg-background/22"
              }`}
              onClick={() => {
                if (!disabled) {
                  void onLoadUrl(entry.url);
                }
              }}
              title={entry.url}
            >
              <span className="max-w-[132px] truncate whitespace-nowrap text-[11px] font-medium text-muted-foreground">
                {entry.label}
              </span>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  if (!disabled) {
                    onRemoveUrl(entry.url);
                    toast.success(removeSuccessMessage);
                  }
                }}
                disabled={disabled}
                className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-muted-foreground transition-opacity hover:bg-destructive/20 hover:text-destructive"
                aria-label={`Remove recent ${title.toLowerCase()}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {lastLocalLabel && (
            <div
              className={`group relative flex w-fit max-w-full items-center gap-0.5 rounded-md border border-border/30 bg-background/14 px-1 py-0.5 transition-colors ${
                disabled
                  ? "cursor-not-allowed opacity-60"
                  : "cursor-pointer hover:border-border/45 hover:bg-background/22"
              }`}
              onClick={() => {
                if (!disabled) {
                  onBrowseLocal();
                }
              }}
              title={`Click to browse and select "${lastLocalLabel}" again`}
            >
              <Folder className="h-3 w-3 flex-shrink-0 text-muted-foreground/80" />
              <span className="max-w-[132px] truncate whitespace-nowrap text-[11px] font-medium text-muted-foreground">
                local · {lastLocalLabel}
              </span>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  if (!disabled) {
                    onClearLocal();
                    toast.success(clearLocalSuccessMessage);
                  }
                }}
                disabled={disabled}
                className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-muted-foreground transition-opacity hover:bg-destructive/20 hover:text-destructive"
                aria-label={`Clear last local ${title.toLowerCase()}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
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
    onDropFile,
    disabled = false,
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
    onDropFile: (file: File) => void | Promise<unknown>;
    disabled?: boolean;
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
          {isPreparing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
          <span>{localLabel}</span>
          <button
            type="button"
            onClick={() => {
              if (!disabled) {
                onBrowseLocal();
              }
            }}
            disabled={disabled}
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
            if (event.key === "Enter" && !isLoading && !disabled) {
              void onLoadRemote();
            }
          }}
          disabled={isLoading || disabled}
          className="min-w-0 flex-1 bg-background/80"
        />
        <Button
          type="button"
          onClick={() => {
            void onLoadRemote();
          }}
          disabled={loadDisabled || disabled}
          size="sm"
          className="h-6 w-[72px] shrink-0 justify-center border border-border bg-muted px-2 text-[10px] text-foreground hover:bg-muted/80"
        >
          {isLoading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Github className="mr-1.5 h-3.5 w-3.5" />
          )}
          Load
        </Button>
      </div>
    </div>
  );

  const renderCameraSetupLoader = (title: string) => (
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
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setCameraSourceDropActive(false);
        const file = event.dataTransfer.files?.[0];
        if (!file) {
          toast.error("No local file was dropped.");
          return;
        }
        void processCameraConfigFile(file);
      }}
    >
      <div className="flex items-center gap-2">
        <Camera className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{title}</p>
      </div>
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
        <p>Load a camera JSON/YAML with name, parent joint, pose, intrinsics.</p>
      </div>
      {renderCompactSourceIntake({
        isDropActive: cameraSourceDropActive,
        isPreparing: isLoadingCameraConfig,
        localLabel: "Drag camera JSON/YAML",
        onBrowseLocal: handleCameraConfigFileButtonClick,
        inputPlaceholder: "https://.../camera-config.json",
        inputValue: cameraConfigUrl,
        onInputValueChange: setCameraConfigUrl,
        onLoadRemote: importCameraConfigFromInput,
        loadDisabled: isLoadingCameraConfig || !cameraConfigUrl.trim(),
        isLoading: isLoadingCameraConfig,
        onDropFile: processCameraConfigFile,
        disabled: entryLoadInteractionsDisabled,
      })}
      {cameras.length > 0 ? (
        <div className="space-y-2 rounded-md border border-border/70 bg-background/40 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Camera className="h-3.5 w-3.5" />
              <span>Loaded Cameras ({cameras.length})</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                clearCameras();
                toast.success("Cleared all cameras");
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
                  onClick={() => handleDeleteCamera(camera.id, camera.name)}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                  aria-label={`Delete camera ${camera.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : renderRecentLinkPanel({
        title: "Recent Camera Configs",
        emptyLabel: "No recent camera configs yet.",
        entries: recentCameraConfigs,
        onLoadUrl: loadCameraConfigFromUrl,
        onRemoveUrl: (url) => removeRecentCameraConfig(url),
        removeSuccessMessage: "Removed from recent camera configs",
        lastLocalLabel: lastLocalCameraConfig,
        onBrowseLocal: handleCameraConfigFileButtonClick,
        onClearLocal: clearLastLocalCameraConfig,
        clearLocalSuccessMessage: "Cleared last camera config",
        disabled: entryLoadInteractionsDisabled,
      })}

    </div>
  );

  const renderRuntimePanel = () => (
    <FolderUploadRuntimePanel
      autocompleteRuntimeCommand={autocompleteRuntimeCommand}
      currentRuntimeAttestation={currentRuntimeAttestation}
      handleAllowRuntimeConnection={handleAllowRuntimeConnection}
      handleApproveRuntimeProvider={handleApproveRuntimeProvider}
      handleDumpRuntimeStats={handleDumpRuntimeStats}
      handleProveRuntimeSafety={handleProveRuntimeSafety}
      handleSendRuntimeCommand={handleSendRuntimeCommand}
      handleSetRuntimeDemoSpeedMode={handleSetRuntimeDemoSpeedMode}
      handleToggleRuntimeProviderRecording={handleToggleRuntimeProviderRecording}
      isApprovingRuntimeProvider={isApprovingRuntimeProvider}
      isProvingRuntimeSafety={isProvingRuntimeSafety}
      isSendingRuntimeCommand={isSendingRuntimeCommand}
      isTogglingRuntimeProviderRecording={isTogglingRuntimeProviderRecording}
      normalizedRuntimeRobotId={normalizedRuntimeRobotId}
      runtimeAdapterFamilies={runtimeAdapterFamilies}
      runtimeAdapterStatus={runtimeAdapterStatus}
      runtimeAttestationError={runtimeAttestationError}
      runtimeBackendDropReasonSummary={runtimeBackendDropReasonSummary}
      runtimeBackendStats={runtimeBackendStats}
      runtimeCommandError={runtimeCommandError}
      runtimeCommandMessages={runtimeCommandMessages}
      runtimeCommandText={runtimeCommandText}
      runtimeConnectionTargets={runtimeConnectionTargets}
      runtimeControlSummary={runtimeControlSummary}
      runtimeDemoEnabled={runtimeDemoEnabled}
      runtimeDemoObjectLabels={runtimeDemoObjectLabels}
      runtimeDemoSpeedMode={runtimeDemoSpeedMode}
      runtimeFleetSummary={runtimeFleetSummary}
      runtimeLastTrajectoryTarget={runtimeLastTrajectoryTarget}
      runtimeLayerCounts={runtimeLayerCounts}
      runtimeProofElapsedMs={runtimeProofElapsedMs}
      runtimeProofError={runtimeProofError}
      runtimeProofPhase={runtimeProofPhase}
      runtimeProofProgressPercent={runtimeProofProgressPercent}
      runtimeProofResult={runtimeProofResult}
      runtimeProviderError={runtimeProviderError}
      runtimeProviderSession={runtimeProviderSession}
      runtimeReceiverSummary={runtimeReceiverSummary}
      runtimeRobotId={runtimeRobotId}
      runtimeRestrictedAreaIds={runtimeRestrictedAreaIds}
      runtimeSessionId={runtimeSessionId}
      runtimeSessionToken={runtimeSessionToken}
      runtimeTelemetryChannels={runtimeTelemetryChannels}
      runtimeTraceSamples={runtimeTraceSamples}
      setRuntimeCommandText={setRuntimeCommandText}
      setRuntimeRobotId={setRuntimeRobotId}
      setRuntimeSessionId={setRuntimeSessionId}
      setRuntimeSessionToken={setRuntimeSessionToken}
    />
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-start bg-background px-4 py-6">
      <div className="w-full flex items-start justify-between pb-2">
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
            disabled={!onPlayDemoMotion}
            className="h-7 min-w-[170px] rounded-md border border-[#ff63d5]/25 bg-[#ff63d5]/[0.06] px-3 text-xs text-foreground hover:bg-[#ff63d5]/[0.1] disabled:border-border disabled:bg-muted/20 disabled:text-muted-foreground"
          >
            Play Sample Motion
          </Button>
          {FOLDER_UPLOAD_ROBOT_SHORTCUT_LIST.map((shortcut) => {
            const isLoadingShortcut = loadingRobotShortcutId === shortcut.id;
            return (
              <Button
                key={shortcut.id}
                onClick={() => {
                  void handleTryRobotShortcut(shortcut);
                }}
                size="sm"
                disabled={entryLoadInteractionsDisabled}
                className="h-7 min-w-[170px] rounded-md border border-emerald-500/30 bg-emerald-500/[0.08] px-3 text-xs text-foreground hover:bg-emerald-500/[0.14] disabled:border-border disabled:bg-muted/20 disabled:text-muted-foreground"
              >
                {isLoadingShortcut ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Bot className="mr-1.5 h-3.5 w-3.5" />
                )}
                {shortcut.buttonLabel}
              </Button>
            );
          })}
        </div>
      </div>
      <div className={`w-full ${compactContainerClass}`}>
        <input
          ref={worldLayoutFileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            void handleWorldLayoutFileSelect(e);
          }}
          className="hidden"
          aria-label="Select world layout JSON file"
        />
        <input
          ref={cameraConfigFileInputRef}
          type="file"
          accept=".json,.yaml,.yml,application/json,text/yaml,text/x-yaml"
          onChange={(event) => {
            void handleCameraConfigFileSelect(event);
          }}
          className="hidden"
          aria-label="Select camera configuration file"
        />
        <input
          ref={localFilesInputRef}
          type="file"
          multiple
          accept=".urdf,.xacro,.zip,.stl,.dae,.obj,.glb,.gltf,.mtl,.png,.jpg,.jpeg"
          onChange={(event) => {
            void handleLocalFilesSelect(event);
          }}
          className="hidden"
          aria-label="Select robot files or zip archive"
        />
        {/* Header Section */}
        <div className="space-y-3 text-center">
          <img
            src={logoUrl}
            alt="URDF Studio"
            className="mx-auto h-32 w-auto object-contain"
          />
        </div>
        {entryOption !== "gallery" ? (
          <div className="space-y-1 pt-1 text-center">
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Entry Mode</p>
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-1 rounded-md bg-muted/20 p-1">
                {entryOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      if (option.id === "training") {
                        if (onOpenTrainingMode) {
                          onOpenTrainingMode();
                          return;
                        }
                        window.location.assign(
                          buildUrdfOpsBrowserUrl({ tab: URDF_OPS_TABS.experiments }),
                        );
                        return;
                      }
                      setEntryOption(option.id);
                    }}
                    disabled={entryLoadInteractionsDisabled}
                    className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-all ${
                      entryOption === option.id
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    } px-4 py-1.5 text-sm`}
                    aria-pressed={entryOption === option.id}
                    aria-label={option.id === "studio" ? "Single" : option.label}
                    title={option.id === "studio" ? "Single" : option.label}
                  >
                    {option.id === "studio" ? <Sparkles className="h-4 w-4" /> : null}
                    {option.id === "studio" ? "Single" : option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        {entryMode.isRuntime ? renderRuntimePanel() : null}

        {entryMode.showLoaders && !entryMode.isAssembly && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">
              {activeLoaderDescription}
            </p>
            {entryMode.showWorldLoader ? (
              <Button
                onClick={() => {
                  void handleLoadSetup();
                }}
                disabled={!hasSetupSelection || entryLoadInteractionsDisabled}
                size="sm"
                className={launcherActionButtonClass}
              >
                <ArrowRight className="mr-2 h-4 w-4" />
                Load Setup
              </Button>
            ) : null}
          </div>
      )}
        <input
          ref={fileInputRef}
          type="file"
          {...({ webkitdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
          multiple
          onChange={handleFolderSelect}
          className="hidden"
          aria-label="Select robot simulation files folder"
        />
        {entryMode.showLoaders && (entryMode.isAssembly
          ? renderAssemblyWorkflowWorkspace()
          : entryOption === "gallery"
            ? renderGalleryLoader()
          : entryMode.showCameraLoader && entryMode.showWorldLoader
            ? (
              <div className={SETUP_ENTRY_PRIMARY_GRID_CLASS}>
                <div className={SETUP_ENTRY_STACK_CLASS}>
                  {renderRobotLoader(entryMode.robotLoaderTitle)}
                  {renderCameraSetupLoader("Camera")}
                </div>
                {renderWorldLayoutLoader("World")}
              </div>
            )
            : renderRobotLoader(entryMode.robotLoaderTitle))}
      </div>
    </div>
  );
});
