import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { toast } from "sonner";

import {
  createIluGalleryJob,
  generateIluGalleryJob,
  getIluGalleryJob,
  getIluGalleryJobBundleUrl,
  getIluGalleryPrDraft,
  publishIluGalleryJob,
  type IluGalleryEntry,
  type IluGalleryGenerateAssetKind,
  type IluGalleryJob,
  type IluGalleryJobProgress,
  type IluGalleryPrDraft,
  type IluGalleryPublishResult,
  type IluGalleryRepoMetadata,
  updateIluGalleryJobMetadata,
} from "@/features/dataset/iluGalleryApi";
import {
  GALLERY_GENERATE_ASSET_KINDS,
  GALLERY_JOB_POLL_INTERVAL_MS,
  GALLERY_LOADING_PROGRESS_TICK_MS,
  GALLERY_LOADING_SLOW_NOTICE_SECONDS,
  GALLERY_PROGRESS_COMPLETE_PERCENT,
  GALLERY_PROGRESS_STARTED_PERCENT,
  isGalleryJobActive,
  resolveGalleryStatusLabel,
  sanitizeGalleryErrorMessage,
} from "@/features/dataset/iluGalleryParams";
import {
  GALLERY_REPO_METADATA_VISIBLE_FIELDS,
  type GalleryRepoMetadataField,
} from "@/features/dataset/galleryRepoMetadataFields";
import {
  EMPTY_GALLERY_PENDING_PUBLISH_STATE,
  hasGalleryPendingPublishChanges,
  mergeGalleryRepoMetadataFieldLabels,
  upsertGalleryPendingRobotRename,
  withGalleryGeneratedAssetsChange,
  type GalleryPendingPublishState,
} from "@/features/dataset/galleryPublishState";
import {
  resolveGalleryEntryGenerateAction,
  resolveGalleryEntryMediaState,
} from "@/features/dataset/galleryEntryMedia";
import { buildGalleryRobotAttentionNotes } from "@/features/dataset/galleryRobotTraits";
import { resolveGalleryRepoMetadataDraft } from "@/features/dataset/galleryRepoOverview";
import { startVisiblePageInterval } from "@/shared/lib/pageVisibility";

export type StudioEntryLoadState =
  | { kind: "idle" }
  | { kind: "camera_config" }
  | { kind: "gallery_entry"; entryId: string }
  | { kind: "github_candidate" }
  | { kind: "local_candidate" }
  | { kind: "world_layout" };

export type GalleryGenerationProgressSnapshot = IluGalleryJobProgress;

export type GallerySourceInfo = {
  owner: string;
  repo: string;
  path?: string;
  branch?: string;
};

type GalleryMediaCounts = {
  imageMissing: number;
  videoMissing: number;
  mediaMissing: number;
};

type GalleryEditorState = {
  job: IluGalleryJob | null;
  isLoadingEntries: boolean;
  entriesError: string | null;
  inspectionStartedAt: number | null;
  inspectionElapsedSeconds: number;
  githubUrl: string;
  isGeneratingAssets: boolean;
  generationProgressStart: GalleryGenerationProgressSnapshot | null;
  isSavingMetadata: boolean;
  isLoadingPublishPreview: boolean;
  isPublishingPr: boolean;
  isEditingMetadata: boolean;
  activeInlineEditorId: string | null;
  selectedEntryIds: string[];
  publishPreview: IluGalleryPrDraft | null;
  pendingPublishState: GalleryPendingPublishState;
  publishedPr: IluGalleryPublishResult | null;
  repoMetadataDraft: IluGalleryRepoMetadata;
  itemTitleDrafts: Record<string, string>;
  activeGenerateEntryId: string | null;
  studioEntryLoadState: StudioEntryLoadState;
};

type RobotTitleChange = {
  id: string;
  previousTitle: string;
  nextTitle: string;
};

type GalleryEditorAction =
  | { type: "setGithubUrl"; value: string }
  | { type: "inspectionStarted"; startedAt: number }
  | { type: "inspectionSucceeded"; job: IluGalleryJob }
  | { type: "inspectionFailed"; message: string }
  | { type: "inspectionFinished" }
  | { type: "jobPolled"; job: IluGalleryJob }
  | { type: "jobPollFailed"; message: string }
  | { type: "inspectionElapsed"; elapsedSeconds: number }
  | { type: "generationStarted"; progress: GalleryGenerationProgressSnapshot | null }
  | { type: "generationSucceeded"; job: IluGalleryJob }
  | { type: "generationFailed"; message: string }
  | { type: "generationFinished" }
  | { type: "resetGenerationProgress" }
  | { type: "clearActiveGenerateEntry" }
  | { type: "setActiveGenerateEntry"; entryId: string | null }
  | { type: "setSelectedEntries"; entryIds: string[] }
  | { type: "toggleSelectedEntry"; entryId: string }
  | { type: "publishPreviewStarted" }
  | { type: "publishPreviewSucceeded"; draft: IluGalleryPrDraft }
  | { type: "publishPreviewFailed" }
  | { type: "publishPreviewFinished" }
  | { type: "clearPublishPreview" }
  | { type: "publishStarted" }
  | { type: "publishSucceeded"; result: IluGalleryPublishResult }
  | { type: "publishFailed" }
  | { type: "publishFinished" }
  | { type: "setEditingMetadata"; value: boolean }
  | { type: "repoMetadataDraftFieldChanged"; field: GalleryRepoMetadataField; value: string }
  | { type: "metadataSaveStarted" }
  | {
      type: "metadataSaveSucceeded";
      job: IluGalleryJob;
      changedRepoMetadataLabels: string[];
      changedRobotTitles: RobotTitleChange[];
    }
  | { type: "metadataSaveFailed"; message: string }
  | { type: "metadataSaveFinished" }
  | { type: "startInlineEditor"; entryId: string }
  | { type: "itemTitleDraftChanged"; entryId: string; value: string }
  | { type: "discardItemTitleDraft"; entryId: string }
  | { type: "itemTitleSaveStarted" }
  | { type: "itemTitleSaveSucceeded"; job: IluGalleryJob; change: RobotTitleChange; entryId: string }
  | { type: "itemTitleSaveFailed"; message: string }
  | { type: "itemTitleSaveFinished" }
  | { type: "studioEntryLoadStarted"; loadState: Exclude<StudioEntryLoadState, { kind: "idle" }> }
  | { type: "studioEntryLoadFinished" };

const IDLE_STUDIO_ENTRY_LOAD_STATE: StudioEntryLoadState = { kind: "idle" };

const toCompactCsv = (values: string[]): string => values.join(", ");

const parseCompactCsv = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const getGalleryRepoMetadataFieldInputValue = (
  metadata: IluGalleryRepoMetadata,
  field: GalleryRepoMetadataField
): string => {
  if (field.kind === "csv") {
    return toCompactCsv(metadata[field.key]);
  }
  return metadata[field.key];
};

const updateGalleryRepoMetadataField = (
  metadata: IluGalleryRepoMetadata,
  field: GalleryRepoMetadataField,
  value: string
): IluGalleryRepoMetadata => {
  if (field.kind === "csv") {
    return { ...metadata, [field.key]: parseCompactCsv(value) };
  }
  return { ...metadata, [field.key]: value };
};

const createEmptyGalleryRepoMetadata = (): IluGalleryRepoMetadata => ({
  org: "",
  summary: "",
  demo: "",
  tags: [],
  license: "",
  authorWebsite: "",
  authorX: "",
  authorLinkedin: "",
  authorGithub: "",
  contact: "",
  extra: "",
  hfDatasets: [],
});

const normalizeGalleryGenerationAssetKinds = (
  assetKinds: IluGalleryGenerateAssetKind[]
): IluGalleryGenerateAssetKind[] => {
  const normalized: IluGalleryGenerateAssetKind[] = [];
  for (const assetKind of assetKinds) {
    if (!normalized.includes(assetKind)) {
      normalized.push(assetKind);
    }
  }
  return normalized;
};

const resolveGalleryGenerationTargetCount = (
  entries: IluGalleryEntry[],
  mode: "repo" | "selected",
  itemIds: string[]
): number => {
  if (mode === "repo") {
    return entries.length;
  }
  const selectedIds = new Set(itemIds.map((itemId) => itemId.trim()).filter(Boolean));
  return entries.filter((entry) => {
    const sourcePath = entry.urdfPath?.trim();
    return selectedIds.has(entry.id) || (sourcePath ? selectedIds.has(sourcePath) : false);
  }).length || selectedIds.size;
};

const createGalleryGenerationProgressStart = (
  entries: IluGalleryEntry[],
  mode: "repo" | "selected",
  itemIds: string[],
  assetKinds: IluGalleryGenerateAssetKind[]
): GalleryGenerationProgressSnapshot | null => {
  const generationAssetKinds = normalizeGalleryGenerationAssetKinds(assetKinds);
  const targetCount = resolveGalleryGenerationTargetCount(entries, mode, itemIds);
  const total = targetCount * generationAssetKinds.length;
  if (total <= 0) {
    return null;
  }
  return {
    completed: 0,
    total,
    percent: GALLERY_PROGRESS_STARTED_PERCENT,
  };
};

const buildGalleryGenerationProgressLabel = (
  progress: GalleryGenerationProgressSnapshot,
  isComplete = false
): string => {
  const completed = Math.min(Math.max(progress.completed, 0), progress.total);
  const percent = Math.min(
    GALLERY_PROGRESS_COMPLETE_PERCENT,
    Math.max(0, progress.percent)
  );
  const prefix = isComplete ? "Generated" : "Generating";
  if (!isComplete && progress.currentLabel) {
    const currentStepLabel = progress.currentStep
      ? `step ${progress.currentStep}/${progress.total}; `
      : "";
    return `${progress.currentLabel} (${currentStepLabel}${completed}/${progress.total} assets done).`;
  }
  return `${prefix} gallery assets: ${percent}% progress (${completed}/${progress.total} assets done).`;
};

const buildGalleryGenerationButtonLabel = (
  progress: GalleryGenerationProgressSnapshot | null
): string => {
  if (!progress) {
    return "Generating...";
  }
  if (progress.currentStage === "preparing") {
    return "Preparing render...";
  }
  if (progress.currentStep && progress.total) {
    return `Rendering ${progress.currentStep}/${progress.total}`;
  }
  return `Generating ${progress.percent}%`;
};

const createItemTitleDrafts = (job: IluGalleryJob): Record<string, string> =>
  Object.fromEntries(job.items.map((item) => [item.id, item.title]));

const createRepoMetadataDraft = (job: IluGalleryJob): IluGalleryRepoMetadata =>
  resolveGalleryRepoMetadataDraft({
    repoMetadata: job.repoMetadata,
    publishedRepo: job.publishedRepo,
  }) ?? createEmptyGalleryRepoMetadata();

const createInitialGalleryEditorState = (): GalleryEditorState => ({
  job: null,
  isLoadingEntries: false,
  entriesError: null,
  inspectionStartedAt: null,
  inspectionElapsedSeconds: 0,
  githubUrl: "",
  isGeneratingAssets: false,
  generationProgressStart: null,
  isSavingMetadata: false,
  isLoadingPublishPreview: false,
  isPublishingPr: false,
  isEditingMetadata: false,
  activeInlineEditorId: null,
  selectedEntryIds: [],
  publishPreview: null,
  pendingPublishState: EMPTY_GALLERY_PENDING_PUBLISH_STATE,
  publishedPr: null,
  repoMetadataDraft: createEmptyGalleryRepoMetadata(),
  itemTitleDrafts: {},
  activeGenerateEntryId: null,
  studioEntryLoadState: IDLE_STUDIO_ENTRY_LOAD_STATE,
});

const galleryEditorReducer = (
  state: GalleryEditorState,
  action: GalleryEditorAction
): GalleryEditorState => {
  switch (action.type) {
    case "setGithubUrl":
      return { ...state, githubUrl: action.value };
    case "inspectionStarted":
      return {
        ...state,
        isLoadingEntries: true,
        entriesError: null,
        job: null,
        inspectionStartedAt: action.startedAt,
        inspectionElapsedSeconds: 0,
        selectedEntryIds: [],
        publishPreview: null,
        generationProgressStart: null,
        activeGenerateEntryId: null,
        pendingPublishState: EMPTY_GALLERY_PENDING_PUBLISH_STATE,
        publishedPr: null,
        isGeneratingAssets: false,
      };
    case "inspectionSucceeded":
    case "jobPolled":
      return {
        ...state,
        job: action.job,
        repoMetadataDraft: createRepoMetadataDraft(action.job),
        itemTitleDrafts: createItemTitleDrafts(action.job),
        activeInlineEditorId: null,
      };
    case "inspectionFailed":
      return {
        ...state,
        entriesError: action.message,
        inspectionStartedAt: null,
        inspectionElapsedSeconds: 0,
      };
    case "inspectionFinished":
      return { ...state, isLoadingEntries: false };
    case "jobPollFailed":
      return { ...state, entriesError: action.message };
    case "inspectionElapsed":
      return { ...state, inspectionElapsedSeconds: action.elapsedSeconds };
    case "generationStarted":
      return { ...state, generationProgressStart: action.progress, isGeneratingAssets: true };
    case "generationSucceeded":
      return {
        ...state,
        job: action.job,
        entriesError: null,
        publishedPr: null,
        pendingPublishState: withGalleryGeneratedAssetsChange(state.pendingPublishState),
        repoMetadataDraft: createRepoMetadataDraft(action.job),
        itemTitleDrafts: createItemTitleDrafts(action.job),
        activeInlineEditorId: null,
      };
    case "generationFailed":
      return {
        ...state,
        entriesError: action.message,
        generationProgressStart: null,
      };
    case "generationFinished":
      return { ...state, isGeneratingAssets: false };
    case "resetGenerationProgress":
      return { ...state, generationProgressStart: null };
    case "clearActiveGenerateEntry":
      return { ...state, activeGenerateEntryId: null };
    case "setActiveGenerateEntry":
      return { ...state, activeGenerateEntryId: action.entryId };
    case "setSelectedEntries":
      return { ...state, selectedEntryIds: action.entryIds };
    case "toggleSelectedEntry":
      return {
        ...state,
        selectedEntryIds: state.selectedEntryIds.includes(action.entryId)
          ? state.selectedEntryIds.filter((value) => value !== action.entryId)
          : [...state.selectedEntryIds, action.entryId],
      };
    case "publishPreviewStarted":
      return { ...state, isLoadingPublishPreview: true };
    case "publishPreviewSucceeded":
      return { ...state, publishPreview: action.draft };
    case "publishPreviewFailed":
      return { ...state, publishPreview: null };
    case "publishPreviewFinished":
      return { ...state, isLoadingPublishPreview: false };
    case "clearPublishPreview":
      return { ...state, publishPreview: null, isLoadingPublishPreview: false };
    case "publishStarted":
      return { ...state, isPublishingPr: true };
    case "publishSucceeded":
      return {
        ...state,
        publishedPr: action.result,
        pendingPublishState: EMPTY_GALLERY_PENDING_PUBLISH_STATE,
        publishPreview: null,
      };
    case "publishFailed":
      return state;
    case "publishFinished":
      return { ...state, isPublishingPr: false };
    case "setEditingMetadata":
      return { ...state, isEditingMetadata: action.value };
    case "repoMetadataDraftFieldChanged":
      return {
        ...state,
        repoMetadataDraft: updateGalleryRepoMetadataField(
          state.repoMetadataDraft,
          action.field,
          action.value
        ),
      };
    case "metadataSaveStarted":
    case "itemTitleSaveStarted":
      return { ...state, isSavingMetadata: true };
    case "metadataSaveSucceeded": {
      let nextPendingState = mergeGalleryRepoMetadataFieldLabels(
        state.pendingPublishState,
        action.changedRepoMetadataLabels
      );
      for (const change of action.changedRobotTitles) {
        nextPendingState = upsertGalleryPendingRobotRename(nextPendingState, change);
      }
      return {
        ...state,
        job: action.job,
        repoMetadataDraft: createRepoMetadataDraft(action.job),
        itemTitleDrafts: createItemTitleDrafts(action.job),
        isEditingMetadata: false,
        entriesError: null,
        publishedPr: null,
        pendingPublishState: nextPendingState,
        activeInlineEditorId: null,
      };
    }
    case "metadataSaveFailed":
    case "itemTitleSaveFailed":
      return { ...state, entriesError: action.message };
    case "metadataSaveFinished":
    case "itemTitleSaveFinished":
      return { ...state, isSavingMetadata: false };
    case "startInlineEditor":
      return { ...state, activeInlineEditorId: action.entryId };
    case "itemTitleDraftChanged":
      return {
        ...state,
        itemTitleDrafts: {
          ...state.itemTitleDrafts,
          [action.entryId]: action.value,
        },
      };
    case "discardItemTitleDraft": {
      const nextDrafts = { ...state.itemTitleDrafts };
      delete nextDrafts[action.entryId];
      return { ...state, itemTitleDrafts: nextDrafts, activeInlineEditorId: null };
    }
    case "itemTitleSaveSucceeded": {
      const nextDrafts = { ...state.itemTitleDrafts };
      delete nextDrafts[action.entryId];
      return {
        ...state,
        job: action.job,
        repoMetadataDraft: createRepoMetadataDraft(action.job),
        itemTitleDrafts: nextDrafts,
        entriesError: null,
        publishedPr: null,
        pendingPublishState: upsertGalleryPendingRobotRename(
          state.pendingPublishState,
          action.change
        ),
        activeInlineEditorId: null,
      };
    }
    case "studioEntryLoadStarted":
      return { ...state, studioEntryLoadState: action.loadState };
    case "studioEntryLoadFinished":
      return { ...state, studioEntryLoadState: IDLE_STUDIO_ENTRY_LOAD_STATE };
    default:
      return state;
  }
};

type UseIluGalleryEditorStateParams = {
  addRecentRepo: (owner: string, repo: string, path: string | undefined, url: string) => void;
  buildGitHubRepoUrl: (sourceInfo: GallerySourceInfo) => string;
};

export const useIluGalleryEditorState = ({
  addRecentRepo,
  buildGitHubRepoUrl,
}: UseIluGalleryEditorStateParams) => {
  const [state, dispatch] = useReducer(
    galleryEditorReducer,
    undefined,
    createInitialGalleryEditorState
  );
  const galleryInspectionOperationIdRef = useRef(0);
  const galleryGenerationOperationIdRef = useRef(0);
  const activeStudioEntryLoadOperationIdRef = useRef(0);
  const nextStudioEntryLoadOperationIdRef = useRef(0);
  const galleryActiveJobIdRef = useRef<string | null>(null);

  const entries = useMemo(() => state.job?.items ?? [], [state.job]);

  useEffect(() => {
    galleryActiveJobIdRef.current = state.job?.jobId ?? null;
  }, [state.job?.jobId]);

  const mediaCounts = useMemo(
    () =>
      entries.reduce<GalleryMediaCounts>(
        (counts, entry) => {
          const mediaState = resolveGalleryEntryMediaState(entry);
          if (!mediaState.hasImageAsset) {
            counts.imageMissing += 1;
          }
          if (!mediaState.hasMotionAsset) {
            counts.videoMissing += 1;
          }
          if (!mediaState.hasImageAsset || !mediaState.hasMotionAsset) {
            counts.mediaMissing += 1;
          }
          return counts;
        },
        {
          imageMissing: 0,
          videoMissing: 0,
          mediaMissing: 0,
        }
      ),
    [entries]
  );
  const missingMediaEntries = useMemo(
    () =>
      entries.filter((entry) => {
        const mediaState = resolveGalleryEntryMediaState(entry);
        return !mediaState.hasImageAsset || !mediaState.hasMotionAsset;
      }),
    [entries]
  );
  const repoNotCataloged = useMemo(
    () =>
      entries.length > 0 &&
      entries.every((entry) =>
        buildGalleryRobotAttentionNotes(entry).includes("repo not in gallery catalog")
      ),
    [entries]
  );
  const selectedEntries = useMemo(
    () => entries.filter((entry) => state.selectedEntryIds.includes(entry.id)),
    [entries, state.selectedEntryIds]
  );
  const missingTargets = useMemo(
    () =>
      missingMediaEntries
        .map((entry) => entry.urdfPath || entry.id)
        .filter(Boolean) as string[],
    [missingMediaEntries]
  );
  const selectedTargets = useMemo(
    () =>
      selectedEntries
        .map((entry) => entry.urdfPath || entry.id)
        .filter(Boolean) as string[],
    [selectedEntries]
  );
  const generationInFlight =
    state.isGeneratingAssets ||
    (state.job?.phase === "generate" && isGalleryJobActive(state.job.status));
  const generationCompleted = state.job?.phase === "generate" && state.job.status === "completed";
  const generationProgress =
    state.job?.phase === "generate"
      ? state.job.progress ??
        (isGalleryJobActive(state.job.status) ? state.generationProgressStart : null)
      : state.isGeneratingAssets
        ? state.generationProgressStart
        : null;
  const metadataDirty = useMemo(() => {
    if (!state.job) {
      return false;
    }
    const currentRepoMetadata = JSON.stringify(state.job.repoMetadata);
    const draftRepoMetadata = JSON.stringify(state.repoMetadataDraft);
    if (currentRepoMetadata !== draftRepoMetadata) {
      return true;
    }
    return state.job.items.some(
      (item) => (state.itemTitleDrafts[item.id] ?? item.title) !== item.title
    );
  }, [state.itemTitleDrafts, state.job, state.repoMetadataDraft]);
  const hasPendingPublishChanges = hasGalleryPendingPublishChanges(state.pendingPublishState);
  const isInspectionActive = state.job?.phase === "inspect" && isGalleryJobActive(state.job.status);
  const isSourceBusy = state.isLoadingEntries || isInspectionActive;
  const isLoadingVisible =
    !state.entriesError &&
    entries.length === 0 &&
    (state.isLoadingEntries || isInspectionActive || state.job?.status === "queued");

  useEffect(() => {
    if (!state.job || state.job.status === "completed" || state.job.status === "failed") {
      return undefined;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const nextJob = await getIluGalleryJob(state.job!.jobId);
        if (!cancelled) {
          dispatch({ type: "jobPolled", job: nextJob });
          if (nextJob.status === "failed" && nextJob.error) {
            const message = sanitizeGalleryErrorMessage(nextJob.error, nextJob.source);
            dispatch({ type: "jobPollFailed", message });
            toast.error(message);
          }
        }
      } catch (error) {
        if (!cancelled) {
          const message = sanitizeGalleryErrorMessage(
            error instanceof Error ? error.message : "Failed to poll gallery job",
            state.job!.source
          );
          dispatch({ type: "jobPollFailed", message });
        }
      }
    };

    const stopPolling = startVisiblePageInterval(() => {
      void poll();
    }, GALLERY_JOB_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [state.job]);

  useEffect(() => {
    const isGalleryInspectionBusy =
      state.isLoadingEntries || isGalleryJobActive(state.job?.status ?? "completed");
    if (!state.inspectionStartedAt || !isGalleryInspectionBusy) {
      return undefined;
    }

    const updateElapsedSeconds = () => {
      dispatch({
        type: "inspectionElapsed",
        elapsedSeconds: Math.max(
          0,
          Math.floor((Date.now() - state.inspectionStartedAt!) / 1000)
        ),
      });
    };

    updateElapsedSeconds();
    const timer = window.setInterval(updateElapsedSeconds, GALLERY_LOADING_PROGRESS_TICK_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [state.inspectionStartedAt, state.job?.status, state.isLoadingEntries]);

  useEffect(() => {
    if (state.isGeneratingAssets) {
      return;
    }
    if (state.job?.phase === "generate" && isGalleryJobActive(state.job.status)) {
      return;
    }
    dispatch({ type: "resetGenerationProgress" });
  }, [state.isGeneratingAssets, state.job?.phase, state.job?.status]);

  useEffect(() => {
    if (generationInFlight) {
      return;
    }
    dispatch({ type: "clearActiveGenerateEntry" });
  }, [generationInFlight]);

  useEffect(() => {
    if (!state.job || state.job.status !== "completed" || !hasPendingPublishChanges || metadataDirty) {
      dispatch({ type: "clearPublishPreview" });
      return undefined;
    }
    let cancelled = false;
    dispatch({ type: "publishPreviewStarted" });
    void getIluGalleryPrDraft(state.job.jobId)
      .then((draft) => {
        if (!cancelled) {
          dispatch({ type: "publishPreviewSucceeded", draft });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to load gallery publish preview";
        dispatch({ type: "publishPreviewFailed" });
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) {
          dispatch({ type: "publishPreviewFinished" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasPendingPublishChanges, metadataDirty, state.job]);

  const setGithubUrl = useCallback((value: string) => {
    dispatch({ type: "setGithubUrl", value });
  }, []);

  const startInspectionJob = useCallback(
    async (sourceInfo: GallerySourceInfo, sourceUrl?: string): Promise<IluGalleryJob | null> => {
      const operationId = galleryInspectionOperationIdRef.current + 1;
      galleryInspectionOperationIdRef.current = operationId;
      galleryGenerationOperationIdRef.current += 1;
      dispatch({ type: "inspectionStarted", startedAt: Date.now() });
      try {
        const job = await createIluGalleryJob(sourceInfo);
        if (galleryInspectionOperationIdRef.current !== operationId) {
          return null;
        }
        dispatch({ type: "inspectionSucceeded", job });
        addRecentRepo(
          sourceInfo.owner,
          sourceInfo.repo,
          sourceInfo.path,
          sourceUrl || buildGitHubRepoUrl(sourceInfo)
        );
        return job;
      } catch (error) {
        if (galleryInspectionOperationIdRef.current !== operationId) {
          return null;
        }
        const message = sanitizeGalleryErrorMessage(
          error instanceof Error ? error.message : "Failed to load source gallery",
          sourceInfo
        );
        dispatch({ type: "inspectionFailed", message });
        return null;
      } finally {
        if (galleryInspectionOperationIdRef.current === operationId) {
          dispatch({ type: "inspectionFinished" });
        }
      }
    },
    [addRecentRepo, buildGitHubRepoUrl]
  );

  const generateAssets = useCallback(
    async (
      mode: "repo" | "selected",
      itemIdsOverride?: string[],
      assetKinds = [...GALLERY_GENERATE_ASSET_KINDS]
    ): Promise<void> => {
      if (!state.job) {
        toast.error("Load a GitHub repo first.");
        return;
      }
      const itemIds = mode === "selected" ? (itemIdsOverride ?? selectedTargets) : [];
      if (mode === "selected" && itemIds.length === 0) {
        toast.error("Select at least one robot first.");
        return;
      }
      const jobId = state.job.jobId;
      const operationId = galleryGenerationOperationIdRef.current + 1;
      galleryGenerationOperationIdRef.current = operationId;
      const isCurrentGalleryGenerationOperation = () =>
        galleryGenerationOperationIdRef.current === operationId &&
        galleryActiveJobIdRef.current === jobId;
      dispatch({
        type: "generationStarted",
        progress: createGalleryGenerationProgressStart(entries, mode, itemIds, assetKinds),
      });
      try {
        const nextJob = await generateIluGalleryJob(jobId, { mode, itemIds, assetKinds });
        if (!isCurrentGalleryGenerationOperation()) {
          return;
        }
        dispatch({ type: "generationSucceeded", job: nextJob });
        toast.info("Gallery generation queued.");
      } catch (error) {
        if (!isCurrentGalleryGenerationOperation()) {
          return;
        }
        const message = sanitizeGalleryErrorMessage(
          error instanceof Error ? error.message : "Failed to generate gallery assets",
          state.job.source
        );
        dispatch({ type: "generationFailed", message });
        toast.error(message);
      } finally {
        if (isCurrentGalleryGenerationOperation()) {
          dispatch({ type: "generationFinished" });
        }
      }
    },
    [entries, selectedTargets, state.job]
  );

  const generateEntryAssets = useCallback(
    async (entry: IluGalleryEntry): Promise<void> => {
      const itemId = entry.urdfPath || entry.id;
      if (!itemId) {
        toast.error("This gallery entry is missing an asset identifier.");
        return;
      }
      const action = resolveGalleryEntryGenerateAction(entry);
      dispatch({ type: "setActiveGenerateEntry", entryId: entry.id });
      await generateAssets("selected", [itemId], action.assetKinds);
    },
    [generateAssets]
  );

  const toggleEntrySelection = useCallback((entryId: string): void => {
    dispatch({ type: "toggleSelectedEntry", entryId });
  }, []);

  const selectAllEntries = useCallback((): void => {
    dispatch({ type: "setSelectedEntries", entryIds: entries.map((entry) => entry.id) });
  }, [entries]);

  const selectMissingEntries = useCallback((): void => {
    dispatch({
      type: "setSelectedEntries",
      entryIds: missingMediaEntries.map((entry) => entry.id),
    });
  }, [missingMediaEntries]);

  const clearEntrySelection = useCallback((): void => {
    dispatch({ type: "setSelectedEntries", entryIds: [] });
  }, []);

  const downloadBundle = useCallback((): void => {
    if (!state.job) return;
    window.open(getIluGalleryJobBundleUrl(state.job.jobId), "_blank", "noopener,noreferrer");
  }, [state.job]);

  const publishPr = useCallback(async (): Promise<void> => {
    if (!state.job) {
      return;
    }
    if (metadataDirty) {
      toast.error("Save metadata edits before publishing a gallery PR.");
      return;
    }
    if (!hasPendingPublishChanges) {
      toast.error("No unpublished gallery changes are ready for PR creation.");
      return;
    }
    dispatch({ type: "publishStarted" });
    try {
      const published = await publishIluGalleryJob(state.job.jobId);
      dispatch({ type: "publishSucceeded", result: published });
      toast.success(
        published.reusedExistingPullRequest
          ? `Updated PR #${published.pullRequestNumber}.`
          : `Created PR #${published.pullRequestNumber}.`
      );
      window.open(published.pullRequestUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to publish gallery PR";
      dispatch({ type: "publishFailed" });
      toast.error(message);
    } finally {
      dispatch({ type: "publishFinished" });
    }
  }, [hasPendingPublishChanges, metadataDirty, state.job]);

  const setEditingMetadata = useCallback((value: boolean): void => {
    dispatch({ type: "setEditingMetadata", value });
  }, []);

  const toggleEditingMetadata = useCallback((): void => {
    dispatch({ type: "setEditingMetadata", value: !state.isEditingMetadata });
  }, [state.isEditingMetadata]);

  const updateRepoMetadataDraftField = useCallback(
    (field: GalleryRepoMetadataField, value: string): void => {
      dispatch({ type: "repoMetadataDraftFieldChanged", field, value });
    },
    []
  );

  const saveMetadata = useCallback(async (): Promise<void> => {
    if (!state.job) {
      return;
    }
    dispatch({ type: "metadataSaveStarted" });
    try {
      const changedRepoMetadataLabels = GALLERY_REPO_METADATA_VISIBLE_FIELDS
        .filter((field) =>
          JSON.stringify(state.job!.repoMetadata[field.key]) !==
          JSON.stringify(state.repoMetadataDraft[field.key])
        )
        .map((field) => field.label);
      const changedRobotTitles = state.job.items
        .map((item) => {
          const nextTitle = (state.itemTitleDrafts[item.id] ?? item.title).trim() || item.title;
          if (nextTitle === item.title) {
            return null;
          }
          return {
            id: item.id,
            previousTitle: item.title,
            nextTitle,
          };
        })
        .filter(Boolean) as RobotTitleChange[];
      const nextJob = await updateIluGalleryJobMetadata(state.job.jobId, {
        repoMetadata: state.repoMetadataDraft,
        items: state.job.items.map((item) => ({
          id: item.id,
          title: (state.itemTitleDrafts[item.id] ?? item.title).trim() || item.title,
        })),
      });
      dispatch({
        type: "metadataSaveSucceeded",
        job: nextJob,
        changedRepoMetadataLabels,
        changedRobotTitles,
      });
      toast.success("Gallery metadata saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save gallery metadata";
      dispatch({ type: "metadataSaveFailed", message });
      toast.error(message);
    } finally {
      dispatch({ type: "metadataSaveFinished" });
    }
  }, [state.itemTitleDrafts, state.job, state.repoMetadataDraft]);

  const startInlineEditor = useCallback((entryId: string): void => {
    dispatch({ type: "startInlineEditor", entryId });
  }, []);

  const setItemTitleDraft = useCallback((entryId: string, value: string): void => {
    dispatch({ type: "itemTitleDraftChanged", entryId, value });
  }, []);

  const keepItemTitleDraft = useCallback(
    async (entryId: string, savedTitle: string): Promise<void> => {
      if (!state.job) {
        return;
      }
      const draftValue = state.itemTitleDrafts[entryId];
      if (draftValue === undefined) {
        dispatch({ type: "discardItemTitleDraft", entryId });
        return;
      }
      const normalizedDraft = draftValue.trim();
      if (!normalizedDraft || normalizedDraft === savedTitle) {
        dispatch({ type: "discardItemTitleDraft", entryId });
        return;
      }

      dispatch({ type: "itemTitleSaveStarted" });
      try {
        const nextJob = await updateIluGalleryJobMetadata(state.job.jobId, {
          repoMetadata: state.job.repoMetadata,
          items: state.job.items.map((item) => ({
            id: item.id,
            title: item.id === entryId ? normalizedDraft : item.title,
          })),
        });
        dispatch({
          type: "itemTitleSaveSucceeded",
          job: nextJob,
          entryId,
          change: {
            id: entryId,
            previousTitle: savedTitle,
            nextTitle: normalizedDraft,
          },
        });
        toast.success("Card title saved.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save card title";
        dispatch({ type: "itemTitleSaveFailed", message });
        toast.error(message);
      } finally {
        dispatch({ type: "itemTitleSaveFinished" });
      }
    },
    [state.itemTitleDrafts, state.job]
  );

  const discardItemTitleDraft = useCallback((entryId: string): void => {
    dispatch({ type: "discardItemTitleDraft", entryId });
  }, []);

  const withStudioEntryLoad = useCallback(
    async <T,>(
      loadState: Exclude<StudioEntryLoadState, { kind: "idle" }>,
      action: () => Promise<T>
    ): Promise<T> => {
      if (activeStudioEntryLoadOperationIdRef.current !== 0) {
        throw new Error("A Studio load is already in progress.");
      }
      const operationId = nextStudioEntryLoadOperationIdRef.current + 1;
      nextStudioEntryLoadOperationIdRef.current = operationId;
      activeStudioEntryLoadOperationIdRef.current = operationId;
      dispatch({ type: "studioEntryLoadStarted", loadState });
      try {
        return await action();
      } finally {
        if (activeStudioEntryLoadOperationIdRef.current === operationId) {
          activeStudioEntryLoadOperationIdRef.current = 0;
          dispatch({ type: "studioEntryLoadFinished" });
        }
      }
    },
    []
  );

  const publishPreviewFilePaths = useMemo(
    () => state.publishPreview?.files.map((file) => file.path) ?? [],
    [state.publishPreview]
  );

  return {
    activeGenerateEntryId: state.activeGenerateEntryId,
    activeInlineEditorId: state.activeInlineEditorId,
    entries,
    entriesError: state.entriesError,
    generationButtonLabel: buildGalleryGenerationButtonLabel(generationProgress),
    generationCompleted,
    generationInFlight,
    generationProgress,
    generationProgressLabel: generationProgress
      ? buildGalleryGenerationProgressLabel(generationProgress, generationCompleted)
      : state.isGeneratingAssets
        ? "Generating gallery assets: waiting for progress..."
        : null,
    githubUrl: state.githubUrl,
    hasPendingPublishChanges,
    inspectionElapsedLabel:
      state.inspectionElapsedSeconds > 0
        ? `${state.inspectionElapsedSeconds}s elapsed`
        : "Starting scan...",
    isLoadingEntries: state.isLoadingEntries,
    isLoadingPublishPreview: state.isLoadingPublishPreview,
    isPublishingPr: state.isPublishingPr,
    isSavingMetadata: state.isSavingMetadata,
    isEditingMetadata: state.isEditingMetadata,
    itemTitleDrafts: state.itemTitleDrafts,
    job: state.job,
    loadingVisible: isLoadingVisible,
    mediaCounts,
    metadataDirty,
    missingMediaEntries,
    missingTargets,
    pendingPublishState: state.pendingPublishState,
    publishPreview: state.publishPreview,
    publishPreviewFilePaths,
    publishedPr: state.publishedPr,
    repoMetadataDraft: state.repoMetadataDraft,
    repoNotCataloged,
    selectedEntries,
    selectedEntryIds: state.selectedEntryIds,
    selectedTargets,
    sourceBusy: isSourceBusy,
    sourceLabel: state.job
      ? `${state.job.source.owner}/${state.job.source.repo}${
          state.job.source.path ? `/${state.job.source.path}` : ""
        }`
      : null,
    statusLabel: state.job
      ? resolveGalleryStatusLabel(state.job.status, state.job.phase)
      : "Enter a GitHub repo or folder above to generate cards.",
    studioEntryLoadState: state.studioEntryLoadState,
    activeGalleryEntryLoadId:
      state.studioEntryLoadState.kind === "gallery_entry"
        ? state.studioEntryLoadState.entryId
        : null,
    isStudioEntryLoadInFlight: state.studioEntryLoadState.kind !== "idle",
    showSlowNotice: state.inspectionElapsedSeconds >= GALLERY_LOADING_SLOW_NOTICE_SECONDS,
    clearEntrySelection,
    discardItemTitleDraft,
    downloadBundle,
    generateAssets,
    generateEntryAssets,
    keepItemTitleDraft,
    publishPr,
    saveMetadata,
    selectAllEntries,
    selectMissingEntries,
    setEditingMetadata,
    setGithubUrl,
    setItemTitleDraft,
    startInlineEditor,
    startInspectionJob,
    toggleEditingMetadata,
    toggleEntrySelection,
    updateRepoMetadataDraftField,
    withStudioEntryLoad,
  };
};
