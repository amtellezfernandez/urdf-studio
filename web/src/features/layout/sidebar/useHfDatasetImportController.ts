import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import {
  analyzeHfDatasetTreatment,
  buildHfEpisodeCollectionContentSignature,
  buildDatasetTreatmentAdditionalFields,
  convertDatasetRowsToRecordedFrames,
  DEFAULT_INDEXED_REPRESENTATION_ID,
  DEFAULT_SEMANTIC_REPRESENTATION_ID,
  deriveNamingStatus,
  formatDatasetTreatmentWarningPreview,
  resolveDatasetTreatmentContext,
  resolveDatasetSignalBaseMode,
  resolveDatasetSignalProfile,
  resolveJointChannelNames,
  saveMapping,
  type DatasetTreatmentAnalysisResponse,
  type EmbodimentRef,
  type Episode,
  type EpisodeMetadata,
  type RecordedFrame,
} from "@/features/dataset";
import type {
  EpisodePipelineProgress,
  EpisodePipelineStage,
} from "@/features/dataset/episode-pipeline/types";
import { extractMeshReferencesFromUrdfContent } from "@/features/urdf/loader/useUrdfLoader";
import {
  resolvePreferredHfSignalField,
  resolveHfSignalFeatureNames,
  resolveHfSignalValuesFromRow,
  type HfSignalField,
} from "@/features/layout/sidebar/hfSignalSelection";
import {
  buildHfDatasetMappingState,
  HF_DATASET_TARGET_ZERO_SOURCE,
  resolveHfDatasetEpisodeFps,
  shouldApplyHfDatasetUrdf,
} from "@/features/layout/sidebar/hfDatasetLoadHelpers";
import { fetchHfResource } from "@/features/layout/sidebar/hfFetch";
import {
  buildHfMappingDialogData,
  computeHfJointRanges,
  DEFAULT_HF_DATASET_REPO,
  parseHfDatasetTargetInput,
  toHfDatasetNumericRows,
  toHfNumericValueArray,
  type HfDatasetPartitionOption,
  type HfMappingDialogData,
} from "@/features/layout/sidebar/hfDatasetImportHelpers";
import {
  consumeHfDatasetIndexRows,
  createHfLazyChunkCursor,
  enqueueDeferredRetryOffset,
  normalizeHfDatasetIndexedEpisodeEntries,
  type HfDatasetIndexedEpisodeEntry,
  type HfLazyChunkCursor,
} from "@/features/layout/sidebar/hfDatasetIndexing";
import {
  HF_DATASET_DEFAULT_FPS,
  HF_DATASET_FIRST_EPISODE_FETCH_BASE_DELAY_MS,
  HF_DATASET_FIRST_EPISODE_FETCH_INTER_BATCH_DELAY_MS,
  HF_DATASET_FIRST_EPISODE_FETCH_MAX_ATTEMPTS,
  HF_DATASET_INDEX_CHUNK_EPISODES,
  HF_DATASET_INDEX_DEFERRED_RETRY_DELAY_MS,
  HF_DATASET_INDEX_FETCH_BASE_DELAY_MS,
  HF_DATASET_INDEX_FETCH_MAX_ATTEMPTS,
  HF_DATASET_INDEX_FETCH_MAX_DELAY_MS,
  HF_DATASET_INDEX_INTER_BATCH_DELAY_MS,
  HF_DATASET_INDEX_MAX_DEFERRED_RETRIES,
  HF_DATASET_INDEX_MAX_FAILED_BATCHES,
  HF_DATASET_INDEX_PROGRESS_EMIT_INTERVAL,
  HF_DATASET_INDEX_PROGRESS_TOTAL_SYNC_INTERVAL,
  HF_DATASET_INDEX_RUNTIME_MS,
  HF_DATASET_ROWS_BATCH_SIZE,
} from "@/features/layout/sidebar/hfLazyEpisodeParams";
import {
  buildHfEpisodeVideosMetadata,
  collectHfVideoCameraKeysFromRows,
  computeEpisodeDurationSecFromFrames,
  computeGlobalVideoClipBoundsFromRows,
  extractHfVideoCameraKeysFromFeatures,
  extractHfVideoCameraKeysFromInfoJson,
  fetchJsonWithRetry,
  isRecord,
  sleep,
  toFiniteNumber,
  unwrapHfDatasetServerRow,
  type HfDatasetServerRow,
} from "@/features/layout/sidebar/sidebarHelpers";
import type {
  HfLazyEpisodeRef,
  HfLazyLoadContext,
} from "@/features/layout/sidebar/useHfLazyEpisodeLoader";
import {
  appendDatasetSourceRecord,
  type DatasetSourceRecord,
} from "@/features/layout/sidebar/datasetSourceHelpers";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import { isSupportedMeshExtension } from "@/shared/lib/urdfCore";
import { useJointStore } from "@/shared/store/useJointStore";
import type { JointLimitMode, JointMapping } from "@/shared/types/feature";

type LimitCorrectionReport = {
  totalViolations: number;
  totalClamped: number;
  [key: string]: unknown;
};

type ApplyLimitCorrections = (
  frames: RecordedFrame[],
  modeByJoint?: Record<string, JointLimitMode | undefined>,
  limitsOverride?: JointLimits
) => {
  frames: RecordedFrame[];
  report: LimitCorrectionReport | null;
};

type UseHfDatasetImportControllerParams = {
  activeEmbodimentId: string;
  availableJoints: string[];
  effectiveHfToken: string | null;
  hfTokenUnavailableReason: string;
  jointLimits: JointLimits;
  onVizUrdfChange?: (urdf: string) => void;
  setEpisodes: Dispatch<SetStateAction<Episode[]>>;
  setDatasetSources: Dispatch<SetStateAction<DatasetSourceRecord[]>>;
  setPipelineStage: (
    stage: EpisodePipelineStage,
    stageMessage?: string
  ) => void;
  setPipelineProgress: (patch: Partial<EpisodePipelineProgress>) => void;
  resetPipelineProgress: () => void;
  registerLazyLoadContext: (
    contextKey: string,
    context: HfLazyLoadContext
  ) => void;
  applyLimitCorrections: ApplyLimitCorrections;
  resolveHfEmbodimentRef: (
    datasetPath: string,
    partitionLabel: string,
    datasetJointNames: string[]
  ) => Promise<EmbodimentRef>;
};

const dismissToast = (toastId: string | number | undefined) => {
  if (toastId) {
    toast.dismiss(toastId);
  }
};

const cloneJointLimitsSnapshot = (jointLimits: JointLimits) =>
  Object.fromEntries(
    Object.entries(jointLimits ?? {}).map(([jointName, limit]) => [
      jointName,
      { ...limit },
    ])
  );

const formatPendingHfRemainderLabel = ({
  indexedEpisodesCount,
  sourceDisplayName,
  totalEpisodes,
  isComplete,
}: {
  indexedEpisodesCount: number;
  sourceDisplayName: string;
  totalEpisodes?: number;
  isComplete: boolean;
}) => {
  const boundedCount =
    typeof totalEpisodes === "number" && totalEpisodes > 0
      ? Math.min(indexedEpisodesCount, totalEpisodes)
      : indexedEpisodesCount;
  const countLabel =
    typeof totalEpisodes === "number" && totalEpisodes > 0
      ? `${boundedCount.toLocaleString()}/${totalEpisodes.toLocaleString()}`
      : `${boundedCount.toLocaleString()}`;
  return `${sourceDisplayName} • ${countLabel} indexed${
    isComplete
      ? " • complete"
      : ` • ready for next ${HF_DATASET_INDEX_CHUNK_EPISODES.toLocaleString()}`
  }`;
};

const createHfHeaders = (token: string | null) => {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

const createResolveMeshPath = (urdfDir: string) => (meshRef: string) => {
  const path = meshRef
    .replace(/^package:\/\/[^/]+\//, "")
    .replace(/^file:\/\//, "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  if (!path) return "";
  if (!urdfDir) return path.replace(/^\/+|\/+$/g, "");

  const urdfParts = urdfDir.split("/").filter(Boolean);
  const meshParts = path.split("/").filter(Boolean);
  const resolvedParts = [...urdfParts];

  for (const part of meshParts) {
    if (part === "..") {
      if (resolvedParts.length > 0) {
        resolvedParts.pop();
      }
    } else if (part !== "." && part !== "") {
      resolvedParts.push(part);
    }
  }

  return resolvedParts.join("/").replace(/^\/+|\/+$/g, "");
};

export const useHfDatasetImportController = ({
  activeEmbodimentId,
  availableJoints,
  effectiveHfToken,
  hfTokenUnavailableReason,
  jointLimits,
  onVizUrdfChange,
  setEpisodes,
  setDatasetSources,
  setPipelineStage,
  setPipelineProgress,
  resetPipelineProgress,
  registerLazyLoadContext,
  applyLimitCorrections,
  resolveHfEmbodimentRef,
}: UseHfDatasetImportControllerParams) => {
  const [isImportingFromHFDataset, setIsImportingFromHFDataset] = useState(false);
  const pendingHfRemainderLoadRef = useRef<(() => Promise<void>) | null>(null);
  const [pendingHfRemainderEpisodeId, setPendingHfRemainderEpisodeId] =
    useState<string | null>(null);
  const [pendingHfRemainderLabel, setPendingHfRemainderLabel] = useState<
    string | null
  >(null);
  const [isLoadingPendingHfRemainder, setIsLoadingPendingHfRemainder] =
    useState(false);
  const [showHfMappingDialog, setShowHfMappingDialog] = useState(false);
  const [hfMappingDialogData, setHfMappingDialogData] =
    useState<HfMappingDialogData | null>(null);
  const [hfMappingDialogMode, setHfMappingDialogMode] = useState<
    "first" | "remap"
  >("first");
  const [pendingHfRemapDialogData, setPendingHfRemapDialogData] =
    useState<HfMappingDialogData | null>(null);
  const pendingHfRemapApplyRef = useRef<
    ((mappings: JointMapping[], degToRad: boolean) => void) | null
  >(null);
  const [isHfPartitionDialogOpen, setIsHfPartitionDialogOpen] = useState(false);
  const [hfPartitionOptions, setHfPartitionOptions] = useState<
    HfDatasetPartitionOption[]
  >([]);
  const [selectedHfPartitionId, setSelectedHfPartitionId] = useState("");
  const hfPartitionResolverRef = useRef<
    ((option: HfDatasetPartitionOption | null) => void) | null
  >(null);
  const applyFirstEpisodeCallbackRef = useRef<
    ((mappings: JointMapping[], degToRad: boolean) => void) | null
  >(null);

  const clearPendingHfRemainderLoad = useCallback(() => {
    pendingHfRemainderLoadRef.current = null;
    setPendingHfRemainderLabel(null);
    setIsLoadingPendingHfRemainder(false);
  }, []);

  const clearPendingHfRemainderUi = useCallback(() => {
    clearPendingHfRemainderLoad();
    setPendingHfRemainderEpisodeId(null);
    setPendingHfRemapDialogData(null);
    pendingHfRemapApplyRef.current = null;
  }, [clearPendingHfRemainderLoad]);

  const resetHfMappingDialogUi = useCallback(() => {
    setShowHfMappingDialog(false);
    setHfMappingDialogData(null);
    setHfMappingDialogMode("first");
    applyFirstEpisodeCallbackRef.current = null;
  }, []);

  const closeMappingDialog = useCallback(() => {
    const toastId = hfMappingDialogData?.loadingToastId;
    resetHfMappingDialogUi();
    dismissToast(toastId);
    setIsImportingFromHFDataset(false);
  }, [hfMappingDialogData?.loadingToastId, resetHfMappingDialogUi]);

  const finishHfDatasetImportUi = useCallback(
    ({ closeDialog = false }: { closeDialog?: boolean } = {}) => {
      if (closeDialog) {
        dismissToast(hfMappingDialogData?.loadingToastId);
        resetHfMappingDialogUi();
      }
      setIsImportingFromHFDataset(false);
    },
    [hfMappingDialogData?.loadingToastId, resetHfMappingDialogUi]
  );

  const loadPendingHfRemainder = useCallback(() => {
    if (isLoadingPendingHfRemainder) {
      return;
    }
    const run = pendingHfRemainderLoadRef.current;
    if (!run) {
      toast.info("No pending HF episodes to load.");
      return;
    }
    setIsLoadingPendingHfRemainder(true);
    setPipelineStage("indexing", "Loading next episodes");
    void run().finally(() => {
      setIsLoadingPendingHfRemainder(false);
    });
  }, [isLoadingPendingHfRemainder, setPipelineStage]);

  const abortPendingHfRemainderLoad = useCallback(() => {
    clearPendingHfRemainderUi();
    toast.info("Aborted loading remaining episodes.");
    setPipelineStage("idle", "Remaining load aborted");
    resetPipelineProgress();
  }, [clearPendingHfRemainderUi, resetPipelineProgress, setPipelineStage]);

  const openPendingHfRemapDialog = useCallback(() => {
    if (!pendingHfRemapDialogData || !pendingHfRemapApplyRef.current) {
      toast.info("No pending mapping to remap.");
      return;
    }
    setHfMappingDialogMode("remap");
    setHfMappingDialogData({ ...pendingHfRemapDialogData });
    setShowHfMappingDialog(true);
  }, [pendingHfRemapDialogData]);

  const resolveHfPartitionSelection = useCallback(
    (option: HfDatasetPartitionOption | null) => {
      const resolver = hfPartitionResolverRef.current;
      hfPartitionResolverRef.current = null;
      setIsHfPartitionDialogOpen(false);
      setHfPartitionOptions([]);
      setSelectedHfPartitionId("");
      resolver?.(option);
    },
    []
  );

  const promptForHfPartitionSelection = useCallback(
    (
      options: HfDatasetPartitionOption[],
      defaultIndex: number
    ): Promise<HfDatasetPartitionOption | null> => {
      if (!Array.isArray(options) || options.length === 0) {
        return Promise.resolve(null);
      }

      if (hfPartitionResolverRef.current) {
        hfPartitionResolverRef.current(null);
        hfPartitionResolverRef.current = null;
      }

      const safeDefaultIndex = Math.min(
        Math.max(defaultIndex, 0),
        options.length - 1
      );
      setHfPartitionOptions(options);
      setSelectedHfPartitionId(options[safeDefaultIndex]?.id ?? "");
      setIsHfPartitionDialogOpen(true);

      return new Promise((resolve) => {
        hfPartitionResolverRef.current = resolve;
      });
    },
    []
  );

  const handleCancelHfPartitionSelection = useCallback(() => {
    resolveHfPartitionSelection(null);
  }, [resolveHfPartitionSelection]);

  const handleConfirmHfPartitionSelection = useCallback(() => {
    const selectedOption =
      hfPartitionOptions.find((option) => option.id === selectedHfPartitionId) ??
      hfPartitionOptions[0] ??
      null;
    resolveHfPartitionSelection(selectedOption);
  }, [hfPartitionOptions, resolveHfPartitionSelection, selectedHfPartitionId]);

  useEffect(
    () => () => {
      if (hfPartitionResolverRef.current) {
        hfPartitionResolverRef.current(null);
        hfPartitionResolverRef.current = null;
      }
    },
    []
  );

  const appendDatasetSource = useCallback(
    (sourceName: string) => {
      setDatasetSources((prev) =>
        appendDatasetSourceRecord(prev, "hf", sourceName)
      );
    },
    [setDatasetSources]
  );

  const handleMappingDialogApply = useCallback(
    (mappings: JointMapping[], degToRad: boolean) => {
      if (hfMappingDialogMode === "remap") {
        if (pendingHfRemapApplyRef.current) {
          pendingHfRemapApplyRef.current(mappings, degToRad);
        } else {
          toast.error("No pending remap target found.");
        }
        return;
      }
      applyFirstEpisodeCallbackRef.current?.(mappings, degToRad);
    },
    [hfMappingDialogMode]
  );

  const loadEpisodesFromHuggingFaceDataset = useCallback(async () => {
    if (isImportingFromHFDataset) return;

    clearPendingHfRemainderUi();
    setHfMappingDialogMode("first");
    setIsImportingFromHFDataset(true);
    setPipelineStage("indexing", "Loading dataset metadata");
    resetPipelineProgress();

    let loadingToastId: string | number | undefined;

    try {
      const input = window
        .prompt(
          `Enter the Hugging Face dataset path (owner/dataset). You can paste a full URL.\n\nRecommended:\n${DEFAULT_HF_DATASET_REPO}`,
          DEFAULT_HF_DATASET_REPO
        )
        ?.trim();

      if (!input) {
        setIsImportingFromHFDataset(false);
        return;
      }

      const parsedTarget = parseHfDatasetTargetInput(input);
      if (!parsedTarget) {
        toast.error("Dataset path must be in format: owner/dataset-name");
        setIsImportingFromHFDataset(false);
        return;
      }

      const parsedPath = parsedTarget.repoId;
      const headers = createHfHeaders(effectiveHfToken);

      loadingToastId = toast.loading("Loading dataset...", {
        duration: Infinity,
      });

      const treeUrl = `https://huggingface.co/api/datasets/${parsedPath}/tree/main`;
      const treeResponse = await fetchHfResource(treeUrl, { headers });

      if (!treeResponse.ok) {
        dismissToast(loadingToastId);
        if (treeResponse.status === 404) {
          toast.error(`Dataset ${parsedPath} not found or not accessible`);
        } else if (treeResponse.status === 401 || treeResponse.status === 403) {
          toast.error(
            effectiveHfToken
              ? "Hugging Face token has no access to this dataset."
              : hfTokenUnavailableReason
          );
        } else {
          toast.error((await treeResponse.text()) || "Failed to fetch dataset info");
        }
        setIsImportingFromHFDataset(false);
        return;
      }

      const treeItems = (await treeResponse.json()) as Array<{
        type: string;
        path: string;
      }>;

      const parquetUrls: string[] = [];
      const urdfUrls: Array<{ url: string; path: string }> = [];
      const meshUrls: Array<{ url: string; path: string }> = [];
      const foldersToExplore: string[] = [""];
      const exploredPaths = new Set<string>();

      for (const item of treeItems) {
        if (item.type === "directory" && item.path === "data") {
          foldersToExplore.push("data");
        }
      }

      while (foldersToExplore.length > 0) {
        const folder = foldersToExplore.shift();
        if (folder === undefined || exploredPaths.has(folder)) {
          continue;
        }
        exploredPaths.add(folder);

        const folderUrl = folder
          ? `https://huggingface.co/api/datasets/${parsedPath}/tree/main/${folder}`
          : treeUrl;
        const folderResponse = await fetchHfResource(folderUrl, { headers });
        if (!folderResponse.ok) {
          console.warn(
            `Failed to fetch folder ${folder}: ${folderResponse.status} ${folderResponse.statusText}`
          );
          continue;
        }

        const folderItems = (await folderResponse.json()) as Array<{
          type: string;
          path: string;
        }>;
        const isInDataFolder = folder === "data" || folder.startsWith("data/");

        for (const item of folderItems) {
          const fullPath =
            !item.path.includes("/") && folder ? `${folder}/${item.path}` : item.path;
          if (item.type === "directory") {
            foldersToExplore.push(fullPath);
            continue;
          }
          if (item.type !== "file") {
            continue;
          }

          const itemPath = fullPath.toLowerCase();
          const downloadUrl = `https://huggingface.co/datasets/${parsedPath}/resolve/main/${fullPath}`;
          if (itemPath.endsWith(".parquet")) {
            if (isInDataFolder || fullPath.startsWith("data/")) {
              parquetUrls.push(downloadUrl);
            }
            continue;
          }
          if (itemPath.endsWith(".urdf")) {
            urdfUrls.push({ url: downloadUrl, path: fullPath });
            continue;
          }
          if (isSupportedMeshExtension(itemPath)) {
            meshUrls.push({ url: downloadUrl, path: fullPath });
          }
        }
      }

      if (urdfUrls.length > 0) {
        const urdfToLoad = [...urdfUrls].sort((left, right) => {
          const leftDepth = left.path.split("/").length;
          const rightDepth = right.path.split("/").length;
          if (leftDepth !== rightDepth) {
            return leftDepth - rightDepth;
          }
          const leftIsRobot = left.path.toLowerCase().includes("robot");
          const rightIsRobot = right.path.toLowerCase().includes("robot");
          if (leftIsRobot && !rightIsRobot) return -1;
          if (!leftIsRobot && rightIsRobot) return 1;
          return 0;
        })[0];

        try {
          const urdfResponse = await fetchHfResource(urdfToLoad.url, { headers });
          if (urdfResponse.ok) {
            const urdfContent = await urdfResponse.text();
            const shouldLoadDatasetUrdf = shouldApplyHfDatasetUrdf({
              availableJointCount: availableJoints.length,
              hasUrdfLoadHandler: Boolean(onVizUrdfChange),
            });

            if (!shouldLoadDatasetUrdf) {
              if (onVizUrdfChange && availableJoints.length > 0) {
                toast.info(
                  "Dataset URDF found; keeping the current robot so replay uses the loaded target calibration."
                );
              }
            } else {
              onVizUrdfChange?.(urdfContent);

              const meshReferences = new Set<string>();
              extractMeshReferencesFromUrdfContent(urdfContent).forEach((filename) => {
                const normalized = filename
                  .replace(/^package:\/\/[^/]+\//, "")
                  .replace(/^file:\/\//, "")
                  .trim();
                if (normalized) {
                  meshReferences.add(normalized);
                }
              });

              if (meshReferences.size > 0 && meshUrls.length > 0) {
                const urdfDir =
                  urdfToLoad.path.substring(0, urdfToLoad.path.lastIndexOf("/")) || "";
                const resolveMeshPath = createResolveMeshPath(urdfDir);
                const normalizePath = (path: string) =>
                  path.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
                const loadedMeshes: Record<string, Blob> = {};

                for (const meshRef of meshReferences) {
                  const resolvedPath = resolveMeshPath(meshRef);
                  const filename = meshRef.split("/").pop() || meshRef;

                  for (const meshUrl of meshUrls) {
                    const meshPath = normalizePath(meshUrl.path);
                    const meshFilename = meshUrl.path.split("/").pop() || "";
                    if (
                      meshPath === resolvedPath ||
                      meshPath.endsWith(`/${resolvedPath}`) ||
                      meshFilename.toLowerCase() === filename.toLowerCase() ||
                      meshPath.toLowerCase().endsWith(`/${filename.toLowerCase()}`)
                    ) {
                      try {
                        const meshResponse = await fetchHfResource(meshUrl.url, { headers });
                        if (meshResponse.ok) {
                          const meshBlob = await meshResponse.blob();
                          loadedMeshes[filename] = meshBlob;
                          loadedMeshes[meshPath] = meshBlob;
                          loadedMeshes[`/${meshPath}`] = meshBlob;
                          loadedMeshes[resolvedPath] = meshBlob;
                          loadedMeshes[`/${resolvedPath}`] = meshBlob;
                          if (meshRef !== filename) {
                            loadedMeshes[meshRef] = meshBlob;
                          }
                        }
                      } catch (error) {
                        console.warn(`Failed to load mesh ${meshUrl.path}:`, error);
                      }
                      break;
                    }
                  }
                }

                if (Object.keys(loadedMeshes).length > 0) {
                  console.log(
                    `Loaded ${Object.keys(loadedMeshes).length} mesh file(s) for URDF`
                  );
                }
              }
            }
          }
        } catch (error) {
          console.warn("Failed to load URDF file:", error);
        }
      }

      if (parquetUrls.length === 0 && urdfUrls.length === 0) {
        dismissToast(loadingToastId);
        toast.error("No parquet files or URDF files found in dataset");
        return;
      }

      if (parquetUrls.length === 0) {
        dismissToast(loadingToastId);
        toast.success(`Loaded URDF from ${parsedPath}`, { duration: 2000 });
        return;
      }

      const batchSize = HF_DATASET_ROWS_BATCH_SIZE;
      let offset = 0;
      let totalRows = 0;
      let hasMore = true;
      let selectedConfig = "default";
      let selectedSplit = "train";
      let partitionCount = 0;
      let datasetServerInfo: {
        dataset_info?: Record<
          string,
          {
            splits?: Record<string, { num_examples?: number }>;
            features?: Record<string, unknown>;
          }
        >;
      } | null = null;

      const infoUrl = `https://datasets-server.huggingface.co/info?dataset=${encodeURIComponent(parsedPath)}`;
      try {
        const infoResponse = await fetchHfResource(infoUrl, { headers });
        if (infoResponse.ok) {
          datasetServerInfo = (await infoResponse.json()) as typeof datasetServerInfo;
          const datasetInfo = datasetServerInfo?.dataset_info ?? {};
          const partitionOptions: HfDatasetPartitionOption[] = [];

          Object.entries(datasetInfo).forEach(([configName, configInfo]) => {
            const splits = configInfo?.splits ?? {};
            Object.entries(splits).forEach(([splitName, splitInfo]) => {
              partitionOptions.push({
                id: `${configName}/${splitName}`,
                config: configName,
                split: splitName,
                numExamples:
                  typeof splitInfo?.num_examples === "number"
                    ? splitInfo.num_examples
                    : 0,
              });
            });
          });
          partitionCount = partitionOptions.length;

          if (partitionOptions.length > 0) {
            let defaultIndex = partitionOptions.findIndex(
              (option) => option.config === "default" && option.split === "train"
            );
            if (defaultIndex < 0) {
              defaultIndex = partitionOptions.findIndex(
                (option) => option.split === "train"
              );
            }
            if (defaultIndex < 0) {
              defaultIndex = 0;
            }

            const selectedPartition = await promptForHfPartitionSelection(
              partitionOptions,
              defaultIndex
            );
            if (!selectedPartition) {
              dismissToast(loadingToastId);
              toast.info("Cancelled dataset load");
              setIsImportingFromHFDataset(false);
              return;
            }

            selectedConfig = selectedPartition.config;
            selectedSplit = selectedPartition.split;
            totalRows = selectedPartition.numExamples;
          } else {
            const manualPartition = window
              .prompt(
                "Could not auto-detect dataset partitions. Enter config/split to load:",
                `${selectedConfig}/${selectedSplit}`
              )
              ?.trim();
            if (!manualPartition) {
              dismissToast(loadingToastId);
              toast.info("Cancelled dataset load");
              setIsImportingFromHFDataset(false);
              return;
            }
            const slashIndex = manualPartition.indexOf("/");
            if (slashIndex <= 0 || slashIndex >= manualPartition.length - 1) {
              dismissToast(loadingToastId);
              toast.error("Partition must be in format: config/split");
              setIsImportingFromHFDataset(false);
              return;
            }
            selectedConfig = manualPartition.slice(0, slashIndex).trim();
            selectedSplit = manualPartition.slice(slashIndex + 1).trim();
          }
        }
      } catch (error) {
        console.warn("Could not fetch dataset partition info:", error);
      }

      const partitionLabel = `${selectedConfig}/${selectedSplit}`;
      let firstEpisodeIndex: number | null = null;
      let firstEpisodeComplete = false;
      const firstEpisodeRows: Array<Record<string, unknown>> = [];
      const bufferedRowsAfterFirstEpisode: Array<Record<string, unknown>> = [];

      while (hasMore && !firstEpisodeComplete) {
        try {
          const rowsUrl = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(parsedPath)}&config=${encodeURIComponent(selectedConfig)}&split=${encodeURIComponent(selectedSplit)}&offset=${offset}&length=${batchSize}`;
          const data = await fetchJsonWithRetry<{ rows?: HfDatasetServerRow[] }>(
            rowsUrl,
            { headers },
            {
              maxAttempts: HF_DATASET_FIRST_EPISODE_FETCH_MAX_ATTEMPTS,
              baseDelayMs: HF_DATASET_FIRST_EPISODE_FETCH_BASE_DELAY_MS,
              fetcher: fetchHfResource,
              label: `First episode rows offset ${offset}`,
            }
          );
          const rows = (data.rows || []) as HfDatasetServerRow[];

          if (rows.length === 0) {
            hasMore = false;
            break;
          }

          for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const row = unwrapHfDatasetServerRow(rows[rowIndex]);
            if (!row) {
              continue;
            }
            const episodeIndex = toFiniteNumber(row.episode_index, 0);
            if (firstEpisodeIndex === null) {
              firstEpisodeIndex = episodeIndex;
            }
            if (episodeIndex !== firstEpisodeIndex) {
              firstEpisodeComplete = true;
              for (let bufferedIndex = rowIndex; bufferedIndex < rows.length; bufferedIndex += 1) {
                const bufferedRow = unwrapHfDatasetServerRow(rows[bufferedIndex]);
                if (bufferedRow) {
                  bufferedRowsAfterFirstEpisode.push(bufferedRow);
                }
              }
              break;
            }
            firstEpisodeRows.push(row);
          }

          offset += rows.length;
          hasMore = rows.length === batchSize && !firstEpisodeComplete;
          await sleep(HF_DATASET_FIRST_EPISODE_FETCH_INTER_BATCH_DELAY_MS);
        } catch (error) {
          console.error(`Error fetching rows at offset ${offset}:`, error);
          break;
        }
      }

      if (firstEpisodeRows.length === 0) {
        dismissToast(loadingToastId);
        toast.error("No data found in parquet files. Check console for details.");
        setIsImportingFromHFDataset(false);
        return;
      }
      if (firstEpisodeIndex === null) {
        dismissToast(loadingToastId);
        toast.error("Dataset rows are missing a valid episode index.");
        setIsImportingFromHFDataset(false);
        return;
      }

      let totalEpisodesFromInfo: number | undefined;
      let videoPathTemplate: string | undefined;
      let videoCameraKeysFromInfo: string[] = [];
      const hfLazyChunkCursorRef: { current: HfLazyChunkCursor | null } = {
        current: null,
      };
      try {
        const infoResponse = await fetchHfResource(
          `https://huggingface.co/datasets/${parsedPath}/raw/main/meta/info.json`,
          { headers }
        );
        if (infoResponse.ok) {
          const infoJsonUnknown: unknown = await infoResponse.json();
          if (isRecord(infoJsonUnknown)) {
            if (typeof infoJsonUnknown.video_path === "string") {
              videoPathTemplate = infoJsonUnknown.video_path;
            }
            videoCameraKeysFromInfo =
              extractHfVideoCameraKeysFromInfoJson(infoJsonUnknown);
            const totalEpisodes = toFiniteNumber(
              infoJsonUnknown.total_episodes,
              Number.NaN
            );
            if (Number.isFinite(totalEpisodes) && totalEpisodes >= 0) {
              totalEpisodesFromInfo = Math.trunc(totalEpisodes);
            }
          }
        }
      } catch (error) {
        console.warn("Could not fetch info.json for total_episodes:", error);
      }

      const buildLazyEpisodeIndexChunkOnDemand = async (options?: {
        chunkEpisodeLimit?: number;
        skipEpisodeIndex?: number;
        onProgress?: (progress: {
          processedBatches: number;
          episodes: number;
          scannedRows: number;
          failedBatches: number;
          currentOffset: number;
        }) => void;
      }) => {
        const chunkEpisodeLimit = Math.max(
          1,
          options?.chunkEpisodeLimit ?? HF_DATASET_INDEX_CHUNK_EPISODES
        );
        const cursor =
          hfLazyChunkCursorRef.current ??
          (() => {
            const initialCursor = createHfLazyChunkCursor({
              nextOffset: offset,
              bufferedRows: bufferedRowsAfterFirstEpisode,
            });
            hfLazyChunkCursorRef.current = initialCursor;
            return initialCursor;
          })();
        if (typeof options?.skipEpisodeIndex === "number") {
          cursor.loadedEpisodeIndices.add(options.skipEpisodeIndex);
        }
        if (cursor.done) {
          return {
            entries: [] as HfDatasetIndexedEpisodeEntry[],
            done: true,
            loadedEpisodeCount: cursor.loadedEpisodeIndices.size,
            deferredRetryCount: 0,
            stoppedEarly: false,
            selectedRowsByEpisode: new Map<number, Array<Record<string, unknown>>>(),
          };
        }

        const entriesByEpisode = new Map<number, HfDatasetIndexedEpisodeEntry>();
        const selectedEpisodeIndices = new Set<number>();
        const selectedRowsByEpisode = new Map<number, Array<Record<string, unknown>>>();
        let processedBatches = 0;
        let scannedRows = 0;
        let failedBatches = 0;
        let currentOffset = cursor.nextOffset;
        const deadline = Date.now() + HF_DATASET_INDEX_RUNTIME_MS;
        const emitProgress = (force = false) => {
          if (!options?.onProgress) return;
          if (
            !force &&
            processedBatches % HF_DATASET_INDEX_PROGRESS_EMIT_INTERVAL !== 0
          ) {
            return;
          }
          options.onProgress({
            processedBatches,
            episodes: entriesByEpisode.size,
            scannedRows,
            failedBatches,
            currentOffset,
          });
        };
        const markBatchProcessed = (rowsInBatch: number, offsetValue: number) => {
          processedBatches += 1;
          scannedRows += Math.max(0, rowsInBatch);
          currentOffset = Math.max(currentOffset, offsetValue);
          emitProgress(
            processedBatches % HF_DATASET_INDEX_PROGRESS_TOTAL_SYNC_INTERVAL === 0
          );
        };

        let shouldStop = false;
        if (!cursor.bufferedConsumed && cursor.bufferedRows.length > 0) {
          const bufferedResult = consumeHfDatasetIndexRows({
            rows: cursor.bufferedRows,
            batchOffset: cursor.bufferedStartOffset,
            loadedEpisodeIndices: cursor.loadedEpisodeIndices,
            selectedEpisodeIndices,
            entriesByEpisode,
            chunkEpisodeLimit,
            selectedRowsByEpisode,
          });
          markBatchProcessed(cursor.bufferedRows.length, cursor.bufferedStartOffset);
          cursor.bufferedConsumed = true;
          cursor.bufferedRows = [];
          if (bufferedResult.stopped && bufferedResult.resumeOffset !== null) {
            cursor.nextOffset = bufferedResult.resumeOffset;
            shouldStop = true;
          }
        }

        const fetchRowsAtOffset = async (offsetToFetch: number) => {
          const rowsUrl = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(parsedPath)}&config=${encodeURIComponent(selectedConfig)}&split=${encodeURIComponent(selectedSplit)}&offset=${offsetToFetch}&length=${batchSize}`;
          const data = await fetchJsonWithRetry<{ rows?: HfDatasetServerRow[] }>(
            rowsUrl,
            { headers },
            {
              maxAttempts: HF_DATASET_INDEX_FETCH_MAX_ATTEMPTS,
              baseDelayMs: HF_DATASET_INDEX_FETCH_BASE_DELAY_MS,
              maxDelayMs: HF_DATASET_INDEX_FETCH_MAX_DELAY_MS,
              fetcher: fetchHfResource,
              label: `Index rows offset ${offsetToFetch}`,
            }
          );
          return (data.rows || []) as HfDatasetServerRow[];
        };

        let stoppedEarly = false;
        let deferredRetriesProcessed = 0;
        while (
          deferredRetriesProcessed < HF_DATASET_INDEX_MAX_DEFERRED_RETRIES &&
          cursor.deferredRetryOffsets.length > 0 &&
          selectedEpisodeIndices.size < chunkEpisodeLimit &&
          Date.now() < deadline &&
          !shouldStop
        ) {
          const retryOffset = cursor.deferredRetryOffsets.shift();
          if (typeof retryOffset !== "number") {
            break;
          }
          try {
            const rows = await fetchRowsAtOffset(retryOffset);
            if (rows.length > 0) {
              const consumed = consumeHfDatasetIndexRows({
                rows,
                batchOffset: retryOffset,
                loadedEpisodeIndices: cursor.loadedEpisodeIndices,
                selectedEpisodeIndices,
                entriesByEpisode,
                chunkEpisodeLimit,
                selectedRowsByEpisode,
              });
              markBatchProcessed(rows.length, retryOffset);
              if (consumed.stopped && consumed.resumeOffset !== null) {
                cursor.nextOffset = Math.min(cursor.nextOffset, consumed.resumeOffset);
                shouldStop = true;
                break;
              }
            } else {
              markBatchProcessed(0, retryOffset);
            }
          } catch {
            failedBatches += 1;
            enqueueDeferredRetryOffset(cursor.deferredRetryOffsets, retryOffset);
            markBatchProcessed(0, retryOffset);
          }
          deferredRetriesProcessed += 1;
          await sleep(HF_DATASET_INDEX_DEFERRED_RETRY_DELAY_MS);
        }

        while (
          !shouldStop &&
          selectedEpisodeIndices.size < chunkEpisodeLimit &&
          (!totalRows || cursor.nextOffset < totalRows) &&
          Date.now() < deadline
        ) {
          const batchOffset = cursor.nextOffset;
          try {
            const rows = await fetchRowsAtOffset(batchOffset);
            if (rows.length === 0) {
              cursor.done = true;
              break;
            }
            const consumed = consumeHfDatasetIndexRows({
              rows,
              batchOffset,
              loadedEpisodeIndices: cursor.loadedEpisodeIndices,
              selectedEpisodeIndices,
              entriesByEpisode,
              chunkEpisodeLimit,
              selectedRowsByEpisode,
            });
            markBatchProcessed(rows.length, batchOffset);
            if (consumed.stopped && consumed.resumeOffset !== null) {
              cursor.nextOffset = consumed.resumeOffset;
              shouldStop = true;
              break;
            }
            cursor.nextOffset = batchOffset + rows.length;
          } catch {
            failedBatches += 1;
            enqueueDeferredRetryOffset(cursor.deferredRetryOffsets, batchOffset);
            cursor.nextOffset = batchOffset + batchSize;
            markBatchProcessed(0, batchOffset);
            if (failedBatches >= HF_DATASET_INDEX_MAX_FAILED_BATCHES) {
              stoppedEarly = true;
              break;
            }
          }
          await sleep(HF_DATASET_INDEX_INTER_BATCH_DELAY_MS);
        }

        if (Date.now() >= deadline) {
          stoppedEarly = true;
        }
        if (
          totalRows > 0 &&
          cursor.nextOffset >= totalRows &&
          cursor.deferredRetryOffsets.length === 0
        ) {
          cursor.done = true;
        }
        emitProgress(true);

        const normalizedEntries = normalizeHfDatasetIndexedEpisodeEntries(
          entriesByEpisode.values()
        );
        normalizedEntries.forEach((entry) =>
          cursor.loadedEpisodeIndices.add(entry.episodeIndex)
        );

        return {
          entries: normalizedEntries,
          done: cursor.done,
          loadedEpisodeCount: cursor.loadedEpisodeIndices.size,
          deferredRetryCount: cursor.deferredRetryOffsets.length,
          stoppedEarly,
          selectedRowsByEpisode,
        };
      };

      let featureNames: string[] = [];
      let datasetRobotTypeHint: string | undefined;
      const firstEpisodeSampleRow =
        (firstEpisodeRows[0] as Record<string, unknown> | undefined) ?? {};
      let selectedSignalField: HfSignalField | null =
        resolveHfSignalValuesFromRow(firstEpisodeSampleRow).field;

      try {
        let infoForJoints = datasetServerInfo;
        if (!infoForJoints) {
          const infoResponse = await fetchHfResource(infoUrl, { headers });
          if (infoResponse.ok) {
            infoForJoints = (await infoResponse.json()) as typeof datasetServerInfo;
          }
        }

        const datasetInfo = infoForJoints?.dataset_info;
        if (datasetInfo) {
          const selectedConfigInfo =
            datasetInfo[selectedConfig] ??
            datasetInfo[Object.keys(datasetInfo)[0] ?? ""];
          if (
            selectedConfigInfo &&
            typeof (selectedConfigInfo as { robot_type?: unknown }).robot_type ===
              "string"
          ) {
            datasetRobotTypeHint = (selectedConfigInfo as { robot_type: string })
              .robot_type;
          }

          if (selectedConfigInfo?.features) {
            const features = selectedConfigInfo.features as Record<string, unknown>;
            selectedSignalField =
              resolvePreferredHfSignalField({
                sampleRow: firstEpisodeSampleRow,
                features,
                availableJointNames: availableJoints,
                robotTypeHint: datasetRobotTypeHint ?? parsedPath,
                fallbackDatasetId: parsedPath,
              }) ?? selectedSignalField;

            const videoKeysFromDatasetServer =
              extractHfVideoCameraKeysFromFeatures(features);
            if (videoKeysFromDatasetServer.length > 0) {
              videoCameraKeysFromInfo = Array.from(
                new Set([...videoCameraKeysFromInfo, ...videoKeysFromDatasetServer])
              );
            }

            featureNames = resolveHfSignalFeatureNames(
              features,
              selectedSignalField
            );
          }
        }
      } catch (error) {
        console.warn("Could not fetch info from Dataset Server API:", error);
      }

      if (featureNames.length === 0) {
        try {
          const infoResponse = await fetchHfResource(
            `https://huggingface.co/datasets/${parsedPath}/raw/main/meta/info.json`,
            { headers }
          );
          if (infoResponse.ok) {
            const infoJsonUnknown: unknown = await infoResponse.json();
            if (!isRecord(infoJsonUnknown)) {
              throw new Error("Invalid info.json payload shape");
            }
            featureNames = resolveHfSignalFeatureNames(
              isRecord(infoJsonUnknown.features)
                ? infoJsonUnknown.features
                : undefined,
              selectedSignalField
            );
            if (typeof infoJsonUnknown.video_path === "string") {
              videoPathTemplate = infoJsonUnknown.video_path;
            }
            if (typeof infoJsonUnknown.robot_type === "string") {
              datasetRobotTypeHint = infoJsonUnknown.robot_type;
            }
            const fallbackVideoKeys =
              extractHfVideoCameraKeysFromInfoJson(infoJsonUnknown);
            if (fallbackVideoKeys.length > 0) {
              videoCameraKeysFromInfo = Array.from(
                new Set([...videoCameraKeysFromInfo, ...fallbackVideoKeys])
              );
            }
          }
        } catch (error) {
          console.warn("Could not fetch info.json directly:", error);
        }
      }

      const allVideoCameraKeys = Array.from(
        new Set([
          ...videoCameraKeysFromInfo,
          ...collectHfVideoCameraKeysFromRows(firstEpisodeRows),
        ])
      );
      const sampleValues = toHfNumericValueArray(firstEpisodeSampleRow, selectedSignalField);
      const signalProfile = resolveDatasetSignalProfile({
        featureNames,
        robotTypeHint: datasetRobotTypeHint ?? parsedPath,
        fallbackChannelCount: sampleValues.length,
      });
      const datasetJointNames = resolveJointChannelNames(signalProfile);
      const nonJointChannelCount =
        signalProfile.channels.length - signalProfile.jointChannels.length;
      if (nonJointChannelCount > 0) {
        toast.info(
          `${
            signalProfile.planarTwistChannels.complete
              ? "Detected planar base velocity channels and excluded them from joint mapping."
              : "Detected non-joint channels and excluded them from joint mapping."
          } (${nonJointChannelCount} channel${nonJointChannelCount === 1 ? "" : "s"})`
        );
      }
      const firstEpisodeJointRanges = computeHfJointRanges(
        firstEpisodeRows,
        signalProfile,
        selectedSignalField
      );
      const sortedFirstEpisodeRows = [...firstEpisodeRows].sort((left, right) => {
        const leftIndex = (left.frame_index as number) ?? 0;
        const rightIndex = (right.frame_index as number) ?? 0;
        return leftIndex - rightIndex;
      });
      const firstEpisodeContentSignature = buildHfEpisodeCollectionContentSignature({
        rows: sortedFirstEpisodeRows,
        signalProfile,
        preferredField: selectedSignalField,
      });
      const sourceName = `hf:${parsedPath}:${partitionLabel}`;
      const sourceDisplayName = `${parsedPath} [${partitionLabel}]`;
      const sourceEmbodimentRef = await resolveHfEmbodimentRef(
        parsedPath,
        partitionLabel,
        datasetJointNames
      );
      const sourceNamingStatus = deriveNamingStatus({
        joint_names: datasetJointNames,
      });
      const resolveDatasetTreatment = async (
        contentSignature: ReturnType<typeof buildHfEpisodeCollectionContentSignature>
      ) => {
        let nextDatasetTreatment: DatasetTreatmentAnalysisResponse | null = null;
        try {
          nextDatasetTreatment = await analyzeHfDatasetTreatment({
            repoId: parsedPath,
            datasetId: sourceName,
            embodimentId: sourceEmbodimentRef.embodiment_id,
            namingStatus: sourceNamingStatus,
            contentSignature,
          });
        } catch (error) {
          console.warn("Failed to fetch backend dataset treatment analysis:", error);
        }
        const {
          treatmentSource: nextTreatmentSource,
          treatmentAdditional: nextTreatmentAdditional,
          treatmentWarningCount,
        } = resolveDatasetTreatmentContext(
          nextDatasetTreatment,
          sourceName
        );
        if (nextDatasetTreatment && treatmentWarningCount > 0) {
          const warningPreview =
            formatDatasetTreatmentWarningPreview(nextDatasetTreatment);
          toast.warning(
            `Backend dataset treatment flagged ${treatmentWarningCount} issue${
              treatmentWarningCount === 1 ? "" : "s"
            }. ${warningPreview}`.trim()
          );
        }
        return {
          datasetTreatment: nextDatasetTreatment,
          treatmentSource: nextTreatmentSource,
          treatmentAdditional: nextTreatmentAdditional,
        };
      };
      const {
        datasetTreatment,
        treatmentSource,
        treatmentAdditional,
      } = await resolveDatasetTreatment(firstEpisodeContentSignature);
      const mappingSaveOptions = {
        sourceEmbodimentId: sourceEmbodimentRef.embodiment_id,
        sourceRepresentationId: DEFAULT_INDEXED_REPRESENTATION_ID,
        targetEmbodimentId: activeEmbodimentId,
        targetRepresentationId: DEFAULT_SEMANTIC_REPRESENTATION_ID,
        createdBy: "urdf-studio",
      };

      const validateDatasetJointCount = (toastId?: string | number) => {
        if (datasetJointNames.length <= availableJoints.length) {
          return true;
        }
        dismissToast(toastId);
        toast.error(
          `Dataset has ${datasetJointNames.length} joints but URDF has only ${availableJoints.length} joints. Cannot add episodes.`
        );
        setIsImportingFromHFDataset(false);
        return false;
      };

      const applyToWholeDataset = async (
        mappings: JointMapping[],
        degToRad: boolean,
        options?: {
          skipEpisodeIndex?: number;
          closeMappingDialog?: boolean;
        }
      ) => {
        let wholeDatasetLoadingToastId: string | number | undefined;

        try {
          wholeDatasetLoadingToastId = toast.loading(
            `Indexing episodes in ${partitionLabel} (stream mode)...`,
            { duration: Infinity }
          );
          const chunkResult = await buildLazyEpisodeIndexChunkOnDemand({
            chunkEpisodeLimit: HF_DATASET_INDEX_CHUNK_EPISODES,
            skipEpisodeIndex: options?.skipEpisodeIndex,
            onProgress: ({ episodes, scannedRows, failedBatches, currentOffset }) => {
              setPipelineProgress({
                partitionLabel,
                currentOffset,
                loadedEpisodes: episodes,
                deferredRetryCount: failedBatches,
              });
              if (!wholeDatasetLoadingToastId) return;
              const rowsSuffix =
                totalRows > 0
                  ? `${scannedRows.toLocaleString()}/${totalRows.toLocaleString()} rows`
                  : `${scannedRows.toLocaleString()} rows`;
              const retrySuffix =
                failedBatches > 0
                  ? ` • retries ${failedBatches.toLocaleString()}`
                  : "";
              toast.loading(
                `Indexing ${partitionLabel}: ${episodes.toLocaleString()} episodes • ${rowsSuffix} • offset ${currentOffset.toLocaleString()}${retrySuffix}`,
                {
                  id: wholeDatasetLoadingToastId,
                  duration: Infinity,
                }
              );
            },
          });
          const {
            entries: episodeIndexEntries,
            done: chunkDone,
            deferredRetryCount,
            stoppedEarly,
            loadedEpisodeCount,
            selectedRowsByEpisode,
          } = chunkResult;

          const {
            jointMapping,
            jointOffsets,
            jointInversions,
            limitModesByJoint,
          } = buildHfDatasetMappingState(mappings);

          saveMapping(
            sourceName,
            mappings,
            degToRad,
            firstEpisodeJointRanges,
            mappingSaveOptions
          );
          useJointStore
            .getState()
            .setDataZeroJointSource(HF_DATASET_TARGET_ZERO_SOURCE);

          if (!validateDatasetJointCount(wholeDatasetLoadingToastId)) {
            dismissToast(loadingToastId);
            return;
          }

          const handleEmptyChunk = (message: string) => {
            dismissToast(loadingToastId);
            dismissToast(wholeDatasetLoadingToastId);
            if (chunkDone) {
              toast.info("No remaining episodes to load.");
              clearPendingHfRemainderUi();
              finishHfDatasetImportUi({ closeDialog: true });
              return;
            }
            setPendingHfRemainderLabel(
              formatPendingHfRemainderLabel({
                indexedEpisodesCount: loadedEpisodeCount,
                sourceDisplayName,
                totalEpisodes: totalEpisodesFromInfo,
                isComplete: false,
              })
            );
            toast.info(message);
            finishHfDatasetImportUi({ closeDialog: false });
          };

          if (episodeIndexEntries.length === 0) {
            handleEmptyChunk(
              deferredRetryCount > 0 || stoppedEarly
                ? `No new episodes yet. Wait a few seconds, then click Load Next ${HF_DATASET_INDEX_CHUNK_EPISODES.toLocaleString()} again.`
                : "No episodes indexed in this chunk yet. Try loading the next chunk."
            );
            return;
          }

          const targetEpisodeIndexEntries =
            typeof options?.skipEpisodeIndex === "number"
              ? episodeIndexEntries.filter(
                  (entry) => entry.episodeIndex !== options.skipEpisodeIndex
                )
              : episodeIndexEntries;

          if (targetEpisodeIndexEntries.length === 0) {
            handleEmptyChunk(
              deferredRetryCount > 0 || stoppedEarly
                ? `No new episodes yet. Wait a few seconds, then click Load Next ${HF_DATASET_INDEX_CHUNK_EPISODES.toLocaleString()} again.`
                : `No new episodes in this chunk. Click Load Next ${HF_DATASET_INDEX_CHUNK_EPISODES.toLocaleString()} again.`
            );
            return;
          }

          const chunkContentSignature = buildHfEpisodeCollectionContentSignature({
            rows: targetEpisodeIndexEntries.flatMap(
              (entry) => selectedRowsByEpisode.get(entry.episodeIndex) ?? []
            ),
            signalProfile,
            preferredField: selectedSignalField,
          });
          const {
            datasetTreatment: chunkDatasetTreatment,
            treatmentSource: chunkTreatmentSource,
            treatmentAdditional: chunkTreatmentAdditional,
          } = await resolveDatasetTreatment(chunkContentSignature);

          const contextKey = `hf-lazy:${parsedPath}:${partitionLabel}:${Date.now()}`;
          registerLazyLoadContext(contextKey, {
            datasetPath: parsedPath,
            config: selectedConfig,
            split: selectedSplit,
            sourceDisplayName,
            signalField: selectedSignalField,
            signalProfile,
            signalBaseMode: resolveDatasetSignalBaseMode(signalProfile),
            jointMapping,
            jointOffsets,
            jointInversions,
            degToRad,
            jointLimitsSnapshot: cloneJointLimitsSnapshot(jointLimits),
            limitModesByJoint,
            videoCameraKeys: allVideoCameraKeys,
            videoPathTemplate,
          });

          const createdAt = Date.now();
          const lazyEpisodes: Episode[] = targetEpisodeIndexEntries.map((entry) => {
            const durationMs =
              entry.firstTimestamp !== null &&
              entry.lastTimestamp !== null &&
              entry.lastTimestamp > entry.firstTimestamp
                ? entry.lastTimestamp - entry.firstTimestamp
                : 0;
            const fps = resolveHfDatasetEpisodeFps({
              frameCount: entry.frameCount,
              durationMs,
              fallbackFps: HF_DATASET_DEFAULT_FPS,
            });
            const lazyRef: HfLazyEpisodeRef = {
              contextKey,
              episodeIndex: entry.episodeIndex,
              startOffset: entry.startOffset,
              endOffset: entry.endOffset,
              ranges: entry.ranges,
              frameCount: entry.frameCount,
              firstTimestamp: entry.firstTimestamp,
              lastTimestamp: entry.lastTimestamp,
            };

            const episodeMetadata: EpisodeMetadata = {
              episode_index: entry.episodeIndex,
              fps,
              joint_names: datasetJointNames,
              naming_status: chunkTreatmentSource?.naming_status ?? sourceNamingStatus,
              representation_id: DEFAULT_SEMANTIC_REPRESENTATION_ID,
              embodiment_ref: sourceEmbodimentRef,
              signal_profile_id: signalProfile.profileId,
              signal_profile_version: signalProfile.profileVersion,
              signal_base_mode: resolveDatasetSignalBaseMode(signalProfile),
              signal_mapping_report: signalProfile.report,
              num_frames: entry.frameCount,
              episode_length_sec: durationMs > 0 ? durationMs / 1000 : undefined,
              robot_type: sourceEmbodimentRef.robot_type ?? parsedPath,
              videos: buildHfEpisodeVideosMetadata(
                [],
                allVideoCameraKeys,
                videoPathTemplate
              ),
              ...(videoPathTemplate ? { video_path: videoPathTemplate } : {}),
              additional: buildDatasetTreatmentAdditionalFields({
                sourceType: "hf",
                sourceName: sourceDisplayName,
                hfDatasetRepo: parsedPath,
                canonicalSource: parsedPath,
                sourceId: `hf:${parsedPath}:${selectedConfig}:${selectedSplit}:${entry.episodeIndex}`,
                extraAdditional: {
                  hfConfig: selectedConfig,
                  hfSplit: selectedSplit,
                  hfSignalField: selectedSignalField ?? undefined,
                  video_clip_start_sec: entry.startOffset / Math.max(fps, 1),
                  video_clip_end_sec: (entry.endOffset + 1) / Math.max(fps, 1),
                  hfLazy: lazyRef as unknown as Record<string, unknown>,
                },
                treatmentAdditional: chunkTreatmentAdditional,
                treatmentManifest: chunkDatasetTreatment?.treatment_manifest as
                  | Record<string, unknown>
                  | undefined,
              }),
            };

            return {
              id: `hf-lazy-${parsedPath.replace("/", "-")}-${selectedConfig}-${selectedSplit}-${entry.episodeIndex}-${createdAt}`,
              number: 0,
              frames: [],
              createdAt,
              metadata: episodeMetadata,
            };
          });

          setEpisodes((prev) => {
            const startNumber = prev.length + 1;
            const normalized = lazyEpisodes.map((episode, index) => ({
              ...episode,
              number: startNumber + index,
            }));
            return [...prev, ...normalized];
          });
          appendDatasetSource(sourceDisplayName);

          dismissToast(loadingToastId);
          dismissToast(wholeDatasetLoadingToastId);

          if (chunkDone) {
            clearPendingHfRemainderUi();
            toast.success(
              `Indexed final ${lazyEpisodes.length} episode(s) from ${sourceDisplayName}.`,
              { duration: 3000 }
            );
            setPipelineStage("ready", "All indexed episodes loaded");
          } else {
            pendingHfRemainderLoadRef.current = async () => {
              await applyToWholeDataset(mappings, degToRad, {
                skipEpisodeIndex: options?.skipEpisodeIndex,
                closeMappingDialog: false,
              });
            };
            setPendingHfRemapDialogData(
              buildHfMappingDialogData({
                datasetJoints: datasetJointNames,
                jointRanges: firstEpisodeJointRanges,
                source: sourceName,
                datasetPath: parsedPath,
                signalField: selectedSignalField,
                signalProfile,
              })
            );
            pendingHfRemapApplyRef.current = (nextMappings, nextDegToRad) => {
              saveMapping(
                sourceName,
                nextMappings,
                nextDegToRad,
                firstEpisodeJointRanges,
                mappingSaveOptions
              );
              pendingHfRemainderLoadRef.current = async () => {
                await applyToWholeDataset(nextMappings, nextDegToRad, {
                  skipEpisodeIndex: options?.skipEpisodeIndex,
                  closeMappingDialog: false,
                });
              };
              setPendingHfRemainderLabel(
                formatPendingHfRemainderLabel({
                  indexedEpisodesCount: loadedEpisodeCount,
                  sourceDisplayName,
                  totalEpisodes: totalEpisodesFromInfo,
                  isComplete: false,
                })
              );
              finishHfDatasetImportUi({ closeDialog: true });
              toast.success(
                "Remapping applied. You can continue loading episodes."
              );
            };
            setPendingHfRemainderEpisodeId(
              lazyEpisodes[lazyEpisodes.length - 1]?.id ??
                lazyEpisodes[0]?.id ??
                null
            );
            setPendingHfRemainderLabel(
              formatPendingHfRemainderLabel({
                indexedEpisodesCount: loadedEpisodeCount,
                sourceDisplayName,
                totalEpisodes: totalEpisodesFromInfo,
                isComplete: false,
              })
            );
            toast.success(
              `Indexed ${lazyEpisodes.length} episode(s). ${
                deferredRetryCount > 0 || stoppedEarly
                  ? "Wait a few seconds, then"
                  : ""
              } load next ${HF_DATASET_INDEX_CHUNK_EPISODES} to continue.`,
              { duration: 3000 }
            );
            setPipelineStage("indexed", "Chunk indexed; load next batch when ready");
          }

          finishHfDatasetImportUi({
            closeDialog: options?.closeMappingDialog !== false,
          });
          return;
        } catch (error) {
          dismissToast(loadingToastId);
          dismissToast(wholeDatasetLoadingToastId);
          const message =
            error instanceof Error && error.message
              ? error.message
              : "Failed to fetch all episodes from Hugging Face";
          toast.error(message);
          setPipelineStage("error", message);
          setIsImportingFromHFDataset(false);
        }
      };

      const applyToFirstEpisodeOnly = (
        mappings: JointMapping[],
        degToRad: boolean
      ) => {
        const {
          jointMapping,
          jointOffsets,
          jointInversions,
          limitModesByJoint,
        } = buildHfDatasetMappingState(mappings);

        saveMapping(
          sourceName,
          mappings,
          degToRad,
          firstEpisodeJointRanges,
          mappingSaveOptions
        );
        useJointStore
          .getState()
          .setDataZeroJointSource(HF_DATASET_TARGET_ZERO_SOURCE);

        if (!validateDatasetJointCount(loadingToastId)) {
          return;
        }

        const converted = convertDatasetRowsToRecordedFrames(
          toHfDatasetNumericRows(sortedFirstEpisodeRows, selectedSignalField),
          {
            signalProfile,
            jointMapping,
            jointOffsets,
            jointInversions,
            degToRad,
            jointLimits,
          }
        );
        const { frames: correctedFrames, report } = applyLimitCorrections(
          converted.frames,
          limitModesByJoint
        );
        const replayFrames = correctedFrames;

        if (replayFrames.length === 0) {
          dismissToast(loadingToastId);
          toast.error("No episodes found in dataset");
          setIsImportingFromHFDataset(false);
          return;
        }

        const fps = resolveHfDatasetEpisodeFps({
          frameCount: replayFrames.length,
          durationMs:
            (replayFrames[replayFrames.length - 1]?.timestamp ?? 0) -
            (replayFrames[0]?.timestamp ?? 0),
          fallbackFps: HF_DATASET_DEFAULT_FPS,
        });
        const videoClipBounds = computeGlobalVideoClipBoundsFromRows(
          sortedFirstEpisodeRows,
          fps
        );
        const mappedJointNames = Object.keys(
          replayFrames[0]?.jointPositions ?? {}
        );
        const createdAt = Date.now();
        const episodeMetadata: EpisodeMetadata = {
          episode_index: firstEpisodeIndex,
          fps,
          joint_names: mappedJointNames,
          naming_status: treatmentSource?.naming_status ?? sourceNamingStatus,
          representation_id: DEFAULT_SEMANTIC_REPRESENTATION_ID,
          embodiment_ref: sourceEmbodimentRef,
          signal_profile_id: signalProfile.profileId,
          signal_profile_version: signalProfile.profileVersion,
          signal_base_mode: resolveDatasetSignalBaseMode(signalProfile),
          signal_mapping_report: signalProfile.report,
          num_frames: replayFrames.length,
          episode_length_sec: computeEpisodeDurationSecFromFrames(replayFrames),
          robot_type: sourceEmbodimentRef.robot_type ?? parsedPath,
          videos: buildHfEpisodeVideosMetadata(
            sortedFirstEpisodeRows,
            allVideoCameraKeys,
            videoPathTemplate
          ),
          ...(videoPathTemplate ? { video_path: videoPathTemplate } : {}),
          additional: buildDatasetTreatmentAdditionalFields({
            sourceType: "hf",
            sourceName: sourceDisplayName,
            hfDatasetRepo: parsedPath,
            canonicalSource: parsedPath,
            sourceId: `hf:${parsedPath}:${selectedConfig}:${selectedSplit}:${firstEpisodeIndex}`,
            extraAdditional: {
              hfConfig: selectedConfig,
              hfSplit: selectedSplit,
              hfSignalField: selectedSignalField ?? undefined,
              ...(videoClipBounds
                ? {
                    video_clip_start_sec: videoClipBounds.startSec,
                    video_clip_end_sec: videoClipBounds.endSec,
                  }
                : {}),
              ...(report ? { limitCorrections: report } : {}),
            },
            treatmentAdditional,
            treatmentManifest: datasetTreatment?.treatment_manifest as
              | Record<string, unknown>
              | undefined,
          }),
        };

        const loadedEpisode: Episode = {
          id: `hf-${parsedPath.replace("/", "-")}-${firstEpisodeIndex}-${createdAt}`,
          number: 0,
          frames: replayFrames,
          createdAt,
          metadata: episodeMetadata,
        };

        setEpisodes((prev) => [
          ...prev,
          {
            ...loadedEpisode,
            number: prev.length + 1,
          },
        ]);
        appendDatasetSource(sourceDisplayName);

        dismissToast(loadingToastId);
        toast.success(`Loaded first episode from ${sourceDisplayName}.`, {
          duration: 3000,
        });
        setPipelineStage("ready", "First episode ready");

        if (report && report.totalViolations > 0) {
          toast.warning(
            `Detected ${report.totalViolations} joint limit violation${
              report.totalViolations === 1 ? "" : "s"
            } during import${
              report.totalClamped > 0
                ? ` (${report.totalClamped} clamped)`
                : ""
            }`
          );
        }

        pendingHfRemainderLoadRef.current = async () => {
          await applyToWholeDataset(mappings, degToRad, {
            skipEpisodeIndex: firstEpisodeIndex ?? undefined,
            closeMappingDialog: false,
          });
        };
        setPendingHfRemainderEpisodeId(loadedEpisode.id);
        setPendingHfRemainderLabel(
          formatPendingHfRemainderLabel({
            indexedEpisodesCount: 1,
            sourceDisplayName,
            totalEpisodes: totalEpisodesFromInfo,
            isComplete: false,
          })
        );
        setPendingHfRemapDialogData(
          buildHfMappingDialogData({
            datasetJoints: datasetJointNames,
            jointRanges: firstEpisodeJointRanges,
            source: sourceName,
            datasetPath: parsedPath,
            signalField: selectedSignalField,
            signalProfile,
          })
        );
        pendingHfRemapApplyRef.current = (nextMappings, nextDegToRad) => {
          saveMapping(
            sourceName,
            nextMappings,
            nextDegToRad,
            firstEpisodeJointRanges,
            mappingSaveOptions
          );
          pendingHfRemainderLoadRef.current = async () => {
            await applyToWholeDataset(nextMappings, nextDegToRad, {
              skipEpisodeIndex: firstEpisodeIndex ?? undefined,
              closeMappingDialog: false,
            });
          };
          setPendingHfRemainderLabel(
            formatPendingHfRemainderLabel({
              indexedEpisodesCount: 1,
              sourceDisplayName,
              totalEpisodes: totalEpisodesFromInfo,
              isComplete: false,
            })
          );
          finishHfDatasetImportUi({ closeDialog: true });
          toast.success(
            "Remapping applied. You can now load the remaining episodes."
          );
        };

        toast.info(
          "First episode loaded. Use the action row under this episode to load rest, remap, or abort.",
          { duration: 6000 }
        );
        finishHfDatasetImportUi({ closeDialog: true });
      };

      if (datasetJointNames.length === 0 || availableJoints.length === 0) {
        applyToFirstEpisodeOnly([], false);
      } else {
        applyFirstEpisodeCallbackRef.current = applyToFirstEpisodeOnly;
        setHfMappingDialogData(
          buildHfMappingDialogData({
            datasetJoints: datasetJointNames,
            jointRanges: firstEpisodeJointRanges,
            source: sourceName,
            datasetPath: parsedPath,
            signalField: selectedSignalField,
            signalProfile,
            loadingToastId,
          })
        );
        setHfMappingDialogMode("first");
        setShowHfMappingDialog(true);
        toast.info(
          `Loaded partition ${partitionLabel}. Apply first episode, validate it, then load the remaining episodes.`,
          { duration: 4000 }
        );
      }
    } catch (error) {
      console.error("Failed to load from Hugging Face dataset:", error);
      dismissToast(loadingToastId);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to load from Hugging Face dataset";
      toast.error(message);
      setPipelineStage("error", message);
    } finally {
      setIsImportingFromHFDataset(false);
    }
  }, [
    activeEmbodimentId,
    appendDatasetSource,
    applyLimitCorrections,
    availableJoints,
    clearPendingHfRemainderUi,
    effectiveHfToken,
    finishHfDatasetImportUi,
    hfTokenUnavailableReason,
    isImportingFromHFDataset,
    jointLimits,
    onVizUrdfChange,
    promptForHfPartitionSelection,
    registerLazyLoadContext,
    resetPipelineProgress,
    resolveHfEmbodimentRef,
    setEpisodes,
    setPipelineProgress,
    setPipelineStage,
  ]);

  return {
    isImportingFromHFDataset,
    pendingHfRemainderEpisodeId,
    pendingHfRemainderLabel,
    isLoadingPendingHfRemainder,
    clearPendingHfRemainderUi,
    loadPendingHfRemainder,
    abortPendingHfRemainderLoad,
    openPendingHfRemapDialog,
    loadEpisodesFromHuggingFaceDataset,
    mappingDialog: {
      isOpen: showHfMappingDialog,
      mode: hfMappingDialogMode,
      data: hfMappingDialogData,
      onClose: closeMappingDialog,
      onApply: handleMappingDialogApply,
    },
    partitionDialog: {
      isOpen: isHfPartitionDialogOpen,
      options: hfPartitionOptions,
      selectedId: selectedHfPartitionId,
      onSelectedIdChange: setSelectedHfPartitionId,
      onCancel: handleCancelHfPartitionSelection,
      onConfirm: handleConfirmHfPartitionSelection,
    },
  };
};
