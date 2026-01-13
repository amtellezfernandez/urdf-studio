import type React from "react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { NumberInput } from "@/components/ui/number-input";
import { Square, Download, GitCompare, RotateCw, Settings, Sliders, Upload, Play, GripVertical, ArrowUp, ArrowDown, Trash2, RotateCcw, List, Gauge, SkipBack, SkipForward, StepBack, StepForward, ChevronsLeft, ChevronsRight, Send, Eye, Circle, FolderOpen, Pause, Box, CloudDownload, GitBranch } from "lucide-react";
import { useJointStore } from "@/store/useJointStore";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { toast } from "sonner";
import type { JointAxisMap, JointLimits } from "@/features/urdf";
import { URDFComparison } from "@/components/URDFComparison";
import { type CollisionVisibility } from "@/components/LinkEditor";
import { BlenderPanel, BlenderPropertyRow } from "@/components/ui/blender-panel";
import { cn } from "@/lib/utils";
import {
  parseEpisodeCsv,
  parseEpisodeJson,
  serializeEpisodeJson,
  serializeEpisodeCollectionJson,
  type EpisodeJsonEpisode,
  type EpisodeMetadata,
  getMappingForSource,
  saveMapping,
} from "@/features/dataset";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { EpisodeViewer3DModal } from "@/components/EpisodeViewer3DModal";
import { RerunViewer3DModal } from "@/components/RerunViewer3DModal";
import { Badge } from "@/components/ui/badge";
import { JointMappingDialog } from "@/components/JointMappingDialog";
import { useCameraStore } from "@/store/useCameraStore";
import { EpisodeCameraPreview } from "@/components/EpisodeCameraPreview";
import type { JointMapping } from "@/features/types";
import { viewerPlayback } from "@/features/viewerPlayback";
import { useViewerPlaybackStore } from "@/store/useViewerPlaybackStore";
import {
  findNextPlayableEpisodeIndex,
  getPlaybackEndAction,
  type PlaybackMode,
} from "@/features/playback/episodeCoordinator";

export const DEFAULT_SIDEBAR_WIDTH = 220;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 320;

interface SidebarProps {
  isLoading?: boolean;
  availableJoints?: string[];
  jointLimits?: JointLimits;
  jointAxes?: JointAxisMap;
  originalJointAxes?: JointAxisMap;
  originalUrdf?: string;
  vizUrdf?: string;
  onJointChange?: (jointName: string, value: number) => void;
  onJointSelect?: (jointName: string | null) => void;
  selectedJoint?: string | null;
  onVizUrdfChange?: (newContent: string) => void;
  onJointAxisChange?: (jointName: string, axis: [number, number, number]) => void;
  onResetAxis?: (jointName: string) => void;
  onJointTypeChange?: (jointName: string, jointType: string, lowerLimit?: number, upperLimit?: number) => void;
  onJointNameChange?: (oldName: string, newName: string) => void;
  onDeleteJoint?: (jointName: string) => void;
  onJointLinkChange?: (jointName: string, parentLink: string, childLink: string) => void;
  deletedJoints?: Set<string>;
  getExportUrdf?: () => string;
  onMotionDataUpload?: (file: File) => void;
  onPlayAnimation?: () => void;
  isPlaying?: boolean;
  motionDataFileName?: string;
  hasAnimationFrames?: boolean;
  currentFrame?: number;
  totalFrames?: number;
  width?: number;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  meshFiles?: Record<string, Blob>;
  onCollisionVisibilityChange?: (visibility: CollisionVisibility) => void;
  rotationPlaneVisible?: boolean;
  onRotationPlaneVisibilityChange?: (visible: boolean) => void;
  onFrameChange?: (frame: number) => void;
  onUrdfEditorToggle?: (show: boolean) => void;
  showUrdfEditor?: boolean;
  viewerSplitView?: boolean;
  onViewerSplitViewChange?: (splitView: boolean) => void;
  onViewerEpisodeChange?: (episode: Episode | null) => void;
  onViewerOpenChange?: (open: boolean) => void;
  onEpisodeSaveHandlerChange?: (
    handler: ((episode: Episode, saveAsNew: boolean, newName?: string) => void) | undefined
  ) => void;
  onRotateRobot?: (axis: [number, number, number], angleRad: number) => void;
  onResetRotation?: () => void;
  hasRotationChanges?: boolean;
  onDatasetActionsReady?: (actions: {
    loadFromLocal: () => void;
    loadFromHuggingFace: () => void;
    exportToLocal: () => void;
    exportToHuggingFace: () => void;
    openRerunViewer: () => void;
    isImportingFromHF: boolean;
    isExportingDataset: boolean;
    isUploadingToHF: boolean;
    hasEpisodes: boolean;
    isRerunViewerOpen: boolean;
  }) => void;
  episodesViewHeight?: number;
  onEpisodesResizeStart?: (event: React.PointerEvent<HTMLDivElement>) => void;
}

interface RecordedFrame {
  timestamp: number;
  jointPositions: Record<string, number>;
}

type HfIdentity = {
  name: string;
  fullname?: string;
};

interface Episode {
  id: string;
  number: number;
  frames: RecordedFrame[];
  createdAt: number;
  metadata?: EpisodeMetadata;
}

type FileWithRelativePath = File & {
  webkitRelativePath?: string;
};

const normalizeInsertIndex = (length: number, insertPosition?: number) =>
  Math.max(0, Math.min(insertPosition ?? length, length));

const renumberEpisodes = (episodes: Episode[]) =>
  episodes.map((episode, index) => ({
    ...episode,
    number: index + 1,
    metadata: episode.metadata
      ? {
          ...episode.metadata,
          episodeNumber: index + 1,
          episode_index:
            episode.metadata.episode_index !== undefined
              ? episode.metadata.episode_index
              : index,
        }
      : undefined,
  }));

const createEpisode = (
  id: string,
  number: number,
  frames: RecordedFrame[],
  metadata?: EpisodeMetadata
): Episode => {
  const jointNames =
    Array.isArray(metadata?.joint_names) && metadata.joint_names.length > 0
      ? (metadata.joint_names as string[])
      : Array.from(
          new Set(frames.flatMap((frame) => Object.keys(frame.jointPositions)))
        );

  const normalizedMetadata = metadata
    ? {
        ...metadata,
        episodeNumber: number,
        episode_index:
          metadata.episode_index !== undefined
            ? metadata.episode_index
            : number - 1,
        joint_names: jointNames,
        createdAt: metadata.createdAt ?? Date.now(),
        num_frames: metadata.num_frames ?? frames.length,
      }
    : undefined;

  return {
    id,
    number,
    frames,
    createdAt: normalizedMetadata?.createdAt ?? Date.now(),
    metadata: normalizedMetadata,
  };
};

const toAnimationFrames = (episode: Episode) =>
  episode.frames.map((frame) => ({
    timestamp: frame.timestamp,
    joints: frame.jointPositions,
  }));

const FALLBACK_JOINTS = ["1", "2", "3", "4", "5"];
type HFSpaceVisibility = "public" | "private";

const RECORDING_INTERVAL_MS = 20;

// ============================================================================
// Common v3 Dataset Helper Functions
// ============================================================================

/**
 * Builds episode data structures and flattened rows for v3 dataset format
 */
interface BuildEpisodeDataResult {
  globalJointOrder: string[];
  flattenedRows: Array<Record<string, unknown>>;
  episodeSummaries: Array<Record<string, unknown>>;
  episodeIndexToTasks: Map<number, string[]>;
  tasksSet: Set<string>;
  totalFrames: number;
  representativeFps: number;
  representativeRobotType: string | undefined;
}

const buildEpisodeDataForV3 = (
  episodes: Episode[],
  robotBaseName: string | undefined,
  robotName?: string | undefined,
  urdfJointOrder?: string[] // URDF-defined joint order
): BuildEpisodeDataResult => {
  const globalJointSet = new Set<string>();
  let totalFrames = 0;
  let representativeFps = 0;
  let representativeRobotType: string | undefined;
  const tasksSet = new Set<string>();
  const flattenedRows: Array<Record<string, unknown>> = [];
  const episodeSummaries: Array<Record<string, unknown>> = [];
  const episodeIndexToTasks = new Map<number, string[]>();

  let runningDatasetIndex = 0;

  // First pass: collect all joints
  episodes.forEach((episode) => {
    episode.frames.forEach((frame) => {
      Object.keys(frame.jointPositions).forEach((joint) =>
        globalJointSet.add(joint)
      );
    });
  });

  // Determine global joint order: use URDF order if available, otherwise alphabetical
  let globalJointOrder: string[];
  if (urdfJointOrder && urdfJointOrder.length > 0) {
    // Use URDF order, filtering to only joints that appear in episodes
    globalJointOrder = urdfJointOrder.filter((joint) => globalJointSet.has(joint));
    // Add any joints from episodes that aren't in URDF order (shouldn't happen, but safety)
    const urdfSet = new Set(urdfJointOrder);
    const missingJoints = Array.from(globalJointSet).filter((joint) => !urdfSet.has(joint));
    if (missingJoints.length > 0) {
      // Sort missing joints alphabetically and append
      missingJoints.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      globalJointOrder = [...globalJointOrder, ...missingJoints];
    }
  } else {
    // Fallback to alphabetical sorting if no URDF order available
    globalJointOrder = Array.from(globalJointSet).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }

  // Second pass: build flattened rows and episode summaries
  episodes.forEach((episode) => {
    if (episode.frames.length === 0) {
      return;
    }

    const episodeIndex = episode.number - 1;
    const jointOrder =
      Array.isArray(episode.metadata?.joint_names) &&
      episode.metadata.joint_names.length > 0
        ? (episode.metadata.joint_names as string[])
        : globalJointOrder;

    const computedFps = (() => {
      if (episode.frames.length < 2) return 0;
      const start = episode.frames[0].timestamp;
      const end = episode.frames[episode.frames.length - 1].timestamp;
      if (end <= start) return 0;
      return (episode.frames.length - 1) / ((end - start) / 1000);
    })();

    const metadataFps =
      typeof episode.metadata?.fps === "number"
        ? episode.metadata.fps
        : undefined;
    const fps =
      metadataFps && metadataFps > 0
        ? metadataFps
        : computedFps > 0
        ? computedFps
        : 1000 / RECORDING_INTERVAL_MS;

    if (!representativeFps && fps) {
      representativeFps = fps;
    }

    const robotTypeRaw = episode.metadata?.robot_type;
    const robotType =
      typeof robotTypeRaw === "string" && robotTypeRaw.length > 0
        ? robotTypeRaw
        : (robotName ?? robotBaseName ?? "unknown");
    if (!representativeRobotType) {
      representativeRobotType = robotType;
    }

    const episodeTasks =
      (episode.metadata?.tasks as string[] | undefined) ?? [];
    episodeTasks.forEach((task) => {
      if (typeof task === "string" && task.length > 0) {
        tasksSet.add(task);
      }
    });

    // Store episode_index to tasks mapping
    episodeIndexToTasks.set(episodeIndex, episodeTasks);

    const startIndex = runningDatasetIndex;

    episode.frames.forEach((frame, frameIdx) => {
      const actionVector = jointOrder.map(
        (joint) => frame.jointPositions[joint] ?? 0
      );

      flattenedRows.push({
        index: runningDatasetIndex,
        episode_index: episodeIndex,
        frame_index: frameIdx,
        timestamp: frame.timestamp / 1000,
        action: actionVector,
        "observation.state": actionVector,
        robot_type: robotType,
      });

      runningDatasetIndex += 1;
    });

    const endIndex = runningDatasetIndex - 1;

    episodeSummaries.push({
      episode_index: episodeIndex,
      tasks: episodeTasks,
      length: episode.frames.length,
      dataset_from_index: startIndex,
      dataset_to_index: endIndex,
    });

    totalFrames += episode.frames.length;
  });

  // Use robot_type from episode metadata if available, otherwise use raw robotName (not sanitized)
  const finalRobotType = representativeRobotType ?? robotName ?? robotBaseName ?? "unknown";
  
  return {
    globalJointOrder,
    flattenedRows,
    episodeSummaries,
    episodeIndexToTasks,
    tasksSet,
    totalFrames,
    representativeFps: representativeFps || 1000 / RECORDING_INTERVAL_MS,
    representativeRobotType: finalRobotType,
  };
};

/**
 * Computes statistics for v3 dataset from flattened rows
 */
const computeV3Stats = (
  flattenedRows: Array<Record<string, unknown>>,
  episodeIndexToTasks: Map<number, string[]>,
  tasksSet: Set<string>
): Record<string, unknown> => {
  const frameIndices = flattenedRows.map((row) => row.frame_index as number);
  const timestamps = flattenedRows.map((row) => row.timestamp as number);
  const episodeIndices = flattenedRows.map((row) => row.episode_index as number);
  const observationStates = flattenedRows.map(
    (row) => row["observation.state"] as number[]
  );
  const actions = flattenedRows.map((row) => row.action as number[]);

  // Compute task_index stats from episode_index to tasks mapping
  const tasksList = Array.from(tasksSet);
  const taskIndexMap = new Map<string, number>();
  tasksList.forEach((task, index) => {
    taskIndexMap.set(task, index);
  });
  const taskIndices = flattenedRows.map((row) => {
    // Find task_index from episode_index
    const epIdx = row.episode_index as number;
    const episodeTasks = episodeIndexToTasks.get(epIdx);
    if (episodeTasks && episodeTasks.length > 0) {
      return taskIndexMap.get(episodeTasks[0]) ?? 0;
    }
    return 0;
  });

  const datasetIndices = flattenedRows.map((row) => row.index as number);

  return {
    frame_index: computeFieldStats(frameIndices, false),
    timestamp: computeFieldStats(timestamps, false),
    task_index: computeFieldStats(taskIndices, false),
    index: computeFieldStats(datasetIndices, false),
    episode_index: computeFieldStats(episodeIndices, false),
    "observation.state": computeFieldStats(observationStates, true),
    action: computeFieldStats(actions, true),
  };
};

/**
 * Generates v3 dataset structure in a JSZip archive
 */
const generateV3DatasetArchive = async (
  episodes: Episode[],
  robotBaseName: string | undefined,
  zip: JSZip,
  datasetName: string,
  robotName?: string | undefined,
  urdfJointOrder?: string[] // URDF-defined joint order
): Promise<void> => {
  const datasetFolder = zip.folder(datasetName);
  if (!datasetFolder) {
    throw new Error("Failed to initialize dataset archive");
  }

  const metaFolder = datasetFolder.folder("meta");
  const dataFolder = datasetFolder.folder("data");
  const videosRoot = datasetFolder.folder("videos");
  const episodesFolder = metaFolder?.folder("episodes");

  if (!metaFolder || !dataFolder || !videosRoot || !episodesFolder) {
    throw new Error("Failed to allocate dataset directories");
  }

  // Use common helper to build episode data
  const episodeData = buildEpisodeDataForV3(episodes, robotBaseName, robotName, urdfJointOrder);
  const {
    globalJointOrder,
    flattenedRows,
    episodeSummaries,
    episodeIndexToTasks,
    tasksSet,
    totalFrames,
    representativeFps,
    representativeRobotType,
  } = episodeData;

  // Compute statistics using common helper
  const statsJson = computeV3Stats(flattenedRows, episodeIndexToTasks, tasksSet);

  const infoJson = {
    codebase_version: "v3.0",
    robot_type: representativeRobotType,
    total_episodes: episodes.length,
    total_frames: totalFrames,
    total_tasks: tasksSet.size,
    chunks_size: 1000,
    data_files_size_in_mb: 0,
    video_files_size_in_mb: 0,
    fps: representativeFps,
    splits: {
      train: `0:${episodes.length}`,
    },
    data_path: "data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet",
    video_path: "videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4",
    features: {
      action: {
        dtype: "float32",
        names: globalJointOrder.map((name) => `${name}.pos`),
        shape: [globalJointOrder.length],
      },
      "observation.state": {
        dtype: "float32",
        names: globalJointOrder.map((name) => `${name}.pos`),
        shape: [globalJointOrder.length],
      },
      timestamp: {
        dtype: "float32",
        shape: [1],
        names: null,
      },
      frame_index: {
        dtype: "int64",
        shape: [1],
        names: null,
      },
      episode_index: {
        dtype: "int64",
        shape: [1],
        names: null,
      },
      index: {
        dtype: "int64",
        shape: [1],
        names: null,
      },
      task_index: {
        dtype: "int64",
        shape: [1],
        names: null,
      },
    },
  };

  // Write info.json (required)
  metaFolder.file("info.json", JSON.stringify(infoJson, null, 2));

  // Write stats.json (required for v3.0)
  metaFolder.file("stats.json", JSON.stringify(statsJson, null, 2));

  // Write tasks as parquet: meta/tasks.parquet
  const tasksList = Array.from(tasksSet);
  const tasksParquetContent = tasksList
    .map((task, index) => JSON.stringify({ task, task_index: index }))
    .join("\n");
  metaFolder.file("tasks.parquet", tasksParquetContent);

  // Write episodes as parquet chunk: meta/episodes/chunk-000.parquet
  const episodesChunkContent = episodeSummaries
    .map((ep) => JSON.stringify(ep))
    .join("\n");
  episodesFolder.file("chunk-000.parquet", episodesChunkContent);

  // Write data files in chunk/file structure: data/chunk-000/file-000.parquet
  const chunkFolder = dataFolder.folder("chunk-000");
  if (!chunkFolder) {
    throw new Error("Failed to create data/chunk-000 directory");
  }
  const flattenedContent = flattenedRows
    .map((row) => JSON.stringify(row))
    .join("\n");
  chunkFolder.file("file-000.parquet", flattenedContent);

  // Create video structure: videos/{video_key}/chunk-000/ (exact structure, even if empty)
  // Always create at least one video key folder structure to match reference format
  const videoCameras = new Set<string>();
  episodes.forEach((episode) => {
    if (episode.metadata?.videos && typeof episode.metadata.videos === "object") {
      Object.keys(episode.metadata.videos).forEach((camera) => {
        if (typeof camera === "string" && camera.length > 0) {
          videoCameras.add(camera);
        }
      });
    }
  });
  // Always create at least one video folder structure, even if no videos exist
  if (videoCameras.size === 0) {
    videoCameras.add("camera_default");
  }
  // Create exact video folder structure matching reference format
  videoCameras.forEach((videoKey) => {
    const videoKeyFolder = videosRoot.folder(videoKey);
    if (videoKeyFolder) {
      // Create chunk-000 folder structure (even if empty, structure must exist)
      videoKeyFolder.folder("chunk-000");
    }
  });
};

// Helper function to compute statistics for a field
const computeFieldStats = (
  values: number[] | number[][],
  isArray: boolean
): {
  min: number | number[];
  max: number | number[];
  mean: number | number[];
  std: number | number[];
  count: number | number[];
  q01: number | number[];
  q10: number | number[];
  q50: number | number[];
  q90: number | number[];
  q99: number | number[];
} => {
  if (isArray && values.length > 0 && Array.isArray(values[0])) {
    // Handle array fields (like observation.state, action)
    const arrayValues = values as number[][];
    const arrayLength = arrayValues[0].length;
    const stats: {
      min: number[];
      max: number[];
      mean: number[];
      std: number[];
      count: number[];
      q01: number[];
      q10: number[];
      q50: number[];
      q90: number[];
      q99: number[];
    } = {
      min: Array(arrayLength).fill(Infinity),
      max: Array(arrayLength).fill(-Infinity),
      mean: Array(arrayLength).fill(0),
      std: Array(arrayLength).fill(0),
      count: Array(arrayLength).fill(arrayValues.length),
      q01: Array(arrayLength).fill(0),
      q10: Array(arrayLength).fill(0),
      q50: Array(arrayLength).fill(0),
      q90: Array(arrayLength).fill(0),
      q99: Array(arrayLength).fill(0),
    };

    // Helper to get quantile value safely
    const getQuantile = (sorted: number[], percentile: number): number => {
      if (sorted.length === 0) return 0;
      const index = Math.floor(sorted.length * percentile);
      return sorted[Math.min(index, sorted.length - 1)] ?? 0;
    };

    // Compute min, max, mean for each dimension
    for (let i = 0; i < arrayLength; i++) {
      const dimensionValues = arrayValues.map((arr) => arr[i]).filter((v) => typeof v === "number");
      if (dimensionValues.length === 0) {
        stats.min[i] = 0;
        stats.max[i] = 0;
        stats.mean[i] = 0;
        stats.std[i] = 0;
        stats.q01[i] = 0;
        stats.q10[i] = 0;
        stats.q50[i] = 0;
        stats.q90[i] = 0;
        stats.q99[i] = 0;
        continue;
      }

      stats.min[i] = Math.min(...dimensionValues);
      stats.max[i] = Math.max(...dimensionValues);
      stats.mean[i] =
        dimensionValues.reduce((sum, val) => sum + val, 0) / dimensionValues.length;

      // Compute std
      const variance =
        dimensionValues.reduce((sum, val) => sum + Math.pow(val - stats.mean[i], 2), 0) /
        dimensionValues.length;
      stats.std[i] = Math.sqrt(variance);

      // Compute quantiles
      const sorted = [...dimensionValues].sort((a, b) => a - b);
      stats.q01[i] = getQuantile(sorted, 0.01);
      stats.q10[i] = getQuantile(sorted, 0.1);
      stats.q50[i] = getQuantile(sorted, 0.5);
      stats.q90[i] = getQuantile(sorted, 0.9);
      stats.q99[i] = getQuantile(sorted, 0.99);
    }

    return stats;
  } else {
    // Handle scalar fields - always return arrays
    const scalarValues = (values as number[]).filter((v) => typeof v === "number");
    if (scalarValues.length === 0) {
      return {
        min: [0],
        max: [0],
        mean: [0],
        std: [0],
        count: [0],
        q01: [0],
        q10: [0],
        q50: [0],
        q90: [0],
        q99: [0],
      };
    }

    const sorted = [...scalarValues].sort((a, b) => a - b);
    const min = Math.min(...scalarValues);
    const max = Math.max(...scalarValues);
    const mean = scalarValues.reduce((sum, val) => sum + val, 0) / scalarValues.length;
    const variance =
      scalarValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      scalarValues.length;
    const std = Math.sqrt(variance);
    const count = scalarValues.length;

    // Helper to get quantile value safely
    const getQuantile = (percentile: number): number => {
      const index = Math.floor(sorted.length * percentile);
      return sorted[Math.min(index, sorted.length - 1)] ?? 0;
    };

    return {
      min: [min],
      max: [max],
      mean: [mean],
      std: [std],
      count: [count],
      q01: [getQuantile(0.01)],
      q10: [getQuantile(0.1)],
      q50: [getQuantile(0.5)],
      q90: [getQuantile(0.9)],
      q99: [getQuantile(0.99)],
    };
  }
};

const sanitizeFilename = (name: string) => {
  const cleaned = Array.from(name, (char) => {
    const code = char.charCodeAt(0);
    if (code < 32 || /[<>:"/\\|?*]/.test(char)) {
      return "_";
    }
    return char;
  }).join("");

  return cleaned
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .trim()
    .replace(/^_+|_+$/g, "") || "robot";
};

const getSortedJointList = (availableJoints: string[]) => {
  if (!availableJoints || availableJoints.length === 0) {
    return FALLBACK_JOINTS;
  }

  return [...availableJoints].sort((a, b) => {
    const aNum = Number(a);
    const bNum = Number(b);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
      return aNum - bNum;
    }
    return a.localeCompare(b);
  });
};

const parseRobotName = (urdf: string) => {
  if (!urdf) return "robot";
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdf, "text/xml");
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      return "robot";
    }

    const robotName = xmlDoc.querySelector("robot")?.getAttribute("name");
    return robotName?.trim() || "robot";
  } catch {
    return "robot";
  }
};

const sanitizeSpaceName = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "urdfstudio-recordings";
};

const normalizeSpaceInput = (input: string) => {
  return input
    .trim()
    .replace(/^https?:\/\/huggingface\.co\/spaces\//i, "")
    .replace(/^spaces\//i, "");
};

const parseSpaceInput = (input: string, defaultOwner?: string) => {
  const normalized = normalizeSpaceInput(input);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { owner: parts[0], name: parts[1] };
  }
  if (parts.length === 1 && defaultOwner) {
    return { owner: defaultOwner, name: parts[0] };
  }
  return null;
};

export const Sidebar = ({
  isLoading = false,
  availableJoints = [],
  jointLimits = {},
  jointAxes = {},
  originalJointAxes = {},
  originalUrdf = "",
  vizUrdf = "",
  onJointChange,
  onJointSelect,
  selectedJoint,
  onVizUrdfChange,
  onJointAxisChange,
  onResetAxis,
  onJointTypeChange,
  onJointNameChange,
  onDeleteJoint,
  deletedJoints = new Set(),
  getExportUrdf,
  onRotateRobot,
  onResetRotation,
  hasRotationChanges = false,
  onMotionDataUpload: _onMotionDataUpload,
  onPlayAnimation,
  isPlaying = false,
  motionDataFileName,
  hasAnimationFrames = false,
  currentFrame = 0,
  totalFrames = 0,
  width = DEFAULT_SIDEBAR_WIDTH,
  isCollapsed = false,
  onToggleCollapse,
  meshFiles = {},
  onCollisionVisibilityChange,
  onFrameChange,
  onUrdfEditorToggle,
  showUrdfEditor = false,
  viewerSplitView = false,
  onViewerSplitViewChange,
  onViewerEpisodeChange,
  onViewerOpenChange,
  onEpisodeSaveHandlerChange,
  onDatasetActionsReady,
  episodesViewHeight = 0.4,
  onEpisodesResizeStart,
}: SidebarProps) => {
  const [collisionVisibility, setCollisionVisibility] = useState<CollisionVisibility>({});

  // Notify parent when collision visibility changes
  useEffect(() => {
    onCollisionVisibilityChange?.(collisionVisibility);
  }, [collisionVisibility, onCollisionVisibilityChange]);

  const storeJointValues = useJointStore((s) => s.jointValues);
  const setStoreJointValue = useJointStore((s) => s.setJointValue);
  const availableJointsStore = useJointStore((s) => s.availableJoints);
  const cameras = useCameraStore((s) => s.cameras);
  const [episodePreviewCameraId, setEpisodePreviewCameraId] = useState<string | null>(null);

  // Keep a stable selection for episode playback camera previews
  useEffect(() => {
    if (episodePreviewCameraId && cameras.some((c) => c.id === episodePreviewCameraId)) return;
    if (cameras.length > 0) {
      setEpisodePreviewCameraId(cameras[0].id);
    } else {
      setEpisodePreviewCameraId(null);
    }
  }, [cameras, episodePreviewCameraId]);
  const velocityLimitEnabled = useJointStore((s) => s.velocityLimitEnabled);
  const setVelocityLimitEnabled = useJointStore((s) => s.setVelocityLimitEnabled);
  const globalMaxJointVelocity = useJointStore((s) => s.globalMaxJointVelocity);
  const setGlobalMaxJointVelocity = useJointStore((s) => s.setGlobalMaxJointVelocity);
  const applyGlobalVelocityToAll = useJointStore((s) => s.applyGlobalVelocityToAll);
  const previewJointValue = useJointStore((s) => s.previewJointValue);
  const setIsAnimating = useJointStore((s) => s.setIsAnimating);

  const robotName = useMemo(() => parseRobotName(originalUrdf), [originalUrdf]);
  const robotBaseName = useMemo(() => sanitizeFilename(robotName), [robotName]);

  const [hfToken, setHfToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("urdfstudio:hfToken");
  });
  const [isUploadingToHF, setIsUploadingToHF] = useState(false);
  const [isImportingFromHF, setIsImportingFromHF] = useState(false);
  const [isImportingFromHFDataset, setIsImportingFromHFDataset] = useState(false);
  const [isExportingDataset, setIsExportingDataset] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hfToken) {
      localStorage.setItem("urdfstudio:hfToken", hfToken);
    } else {
      localStorage.removeItem("urdfstudio:hfToken");
    }
  }, [hfToken]);

  useEffect(() => {
    hfIdentityRef.current = null;
  }, [hfToken]);

  const ensureHfToken = useCallback(async () => {
    let token = hfToken;
    
    // Check for token from environment variable (set by setup script)
    if (!token && import.meta.env.VITE_HUGGINGFACE_TOKEN) {
      token = import.meta.env.VITE_HUGGINGFACE_TOKEN;
      setHfToken(token);
    }
    
    if (!token) {
      const tokenPrompt = window
        .prompt("Enter your Hugging Face access token (with write permissions).")
        ?.trim();
      if (!tokenPrompt) {
        toast.error("Hugging Face token is required for this action");
        return null;
      }
      token = tokenPrompt;
      setHfToken(tokenPrompt);
    }
    return token;
  }, [hfToken]);

  const fetchHfIdentity = useCallback(
    async (token: string): Promise<HfIdentity> => {
      if (hfIdentityRef.current) return hfIdentityRef.current;
      const response = await fetch("https://huggingface.co/api/whoami-v2", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Failed to fetch Hugging Face profile");
      }
      const data = (await response.json()) as HfIdentity;
      hfIdentityRef.current = data;
      return data;
    },
    []
  );

  const promptForSpace = useCallback(
    (action: "upload" | "download", defaultOwner?: string) => {
      const actionVerb = action === "upload" ? "upload recordings to" : "load recordings from";
      const defaultValue = defaultOwner ? `${defaultOwner}/` : "";
      const input = window
        .prompt(
          `Enter the Hugging Face Space to ${actionVerb} (format owner/space). You can paste a full URL.`,
          defaultValue
        )
        ?.trim();
      if (!input) {
        toast.info("Cancelled Hugging Face operation");
        return null;
      }
      const parsed = parseSpaceInput(input, defaultOwner);
      if (!parsed || !parsed.owner) {
        toast.error("Hugging Face Space must be provided as owner/space");
        return null;
      }
      return parsed;
    },
    []
  );

  const fetchHfSpaceInfo = useCallback(async (token: string | null, owner: string, space: string) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return fetch(
      `https://huggingface.co/api/spaces/${encodeURIComponent(owner)}/${encodeURIComponent(space)}`,
      { headers }
    );
  }, []);

  const getJointOrderForFrames = useCallback(
    (frames: RecordedFrame[]) => {
      if (availableJointsStore.length > 0) {
        // Use URDF order directly, filtering to only joints present in frames
        const jointsInFrames = new Set(
          frames.flatMap((frame) => Object.keys(frame.jointPositions))
        );
        // Preserve URDF order, don't sort
        return availableJointsStore.filter((joint) => jointsInFrames.has(joint));
      }

      // Fallback: if no URDF joints available, extract from frames and sort alphabetically
      const jointsFromFrames = Array.from(
        new Set(
          frames.flatMap((frame) => Object.keys(frame.jointPositions))
        )
      );
      jointsFromFrames.sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      );
      return jointsFromFrames;
    },
    [availableJointsStore]
  );

  const createHfSpace = useCallback(
    async (token: string, identityName: string | undefined, owner: string, space: string, visibility: HFSpaceVisibility) => {
      const body: Record<string, unknown> = {
        name: sanitizeSpaceName(space),
        type: "space",
        private: visibility === "private",
        sdk: "static",
      };
      if (identityName && owner !== identityName) {
        body.organization = owner;
      }

      const response = await fetch("https://huggingface.co/api/repos/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Failed to create Hugging Face Space");
      }
    },
    []
  );

  // Recording state - multiple episodes
  const [isRecording, setIsRecording] = useState(false);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentRecordingEpisodeId, setCurrentRecordingEpisodeId] = useState<string | null>(null);
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(null);
  const [currentPlayingEpisodeIndex, setCurrentPlayingEpisodeIndex] = useState<number | null>(null);
  const [recordingFps, setRecordingFps] = useState<number>(30); // Default FPS for recording
  const [recordingStats, setRecordingStats] = useState<{ frames: number; seconds: number }>({ frames: 0, seconds: 0 });
  const hfIdentityRef = useRef<HfIdentity | null>(null);
  const recordingStartTime = useRef<number>(0);
  const recordingIntervalRef = useRef<number | null>(null);
  const isPlayingAllRef = useRef<boolean>(false);
  const currentLoadedEpisodeRef = useRef<number | null>(null); // Track which episode is currently loaded in Viewer3D
  const previousViewerPlayingRef = useRef<boolean>(false);
  const playbackSpeed = useViewerPlaybackStore((state) => state.playbackSpeed);
  const setPlaybackSpeed = useViewerPlaybackStore((state) => state.setPlaybackSpeed);
  const [rerunViewerModalEpisode, setRerunViewerModalEpisode] = useState<Episode | null>(null);
  const [isRerunViewerModalOpen, setIsRerunViewerModalOpen] = useState(false);
  // Track dataset sources for future mixing
  const [datasetSources, setDatasetSources] = useState<Array<{ type: 'hf' | 'local' | 'github' | 'recorded'; name: string; timestamp: number }>>([]);

  const cloneEpisodeFrames = (frames: RecordedFrame[]) =>
    frames.map((frame) => ({
      timestamp: frame.timestamp,
      jointPositions: { ...frame.jointPositions },
    }));

  const resolveJointNames = (metadata: EpisodeMetadata | undefined, frames: RecordedFrame[]) => {
    if (Array.isArray(metadata?.joint_names) && metadata.joint_names.length > 0) {
      return metadata.joint_names as string[];
    }
    return Array.from(new Set(frames.flatMap((frame) => Object.keys(frame.jointPositions))));
  };

  const handleEpisodeSave = useCallback(
    (episodeToSave: Episode, saveAsNew: boolean, newName?: string) => {
      if (!episodeToSave || episodeToSave.frames.length === 0) {
        toast.error("Episode has no frames to save");
        return;
      }

      const trimmedName = newName?.trim();
      let savedEpisode: Episode | null = null;
      let errorMessage: string | null = null;

      setEpisodes((prevEpisodes) => {
        if (saveAsNew) {
          const newEpisodeNumber = prevEpisodes.length + 1;
          const now = Date.now();
          const newEpisode: Episode = {
            id: `episode-${now}-${Math.random().toString(36).slice(2, 10)}`,
            number: newEpisodeNumber,
            frames: cloneEpisodeFrames(episodeToSave.frames),
            createdAt: now,
            metadata: {
              ...episodeToSave.metadata,
              episodeNumber: newEpisodeNumber,
              episode_index: newEpisodeNumber - 1,
              joint_names: resolveJointNames(episodeToSave.metadata, episodeToSave.frames),
              num_frames: episodeToSave.frames.length,
              createdAt: now,
              additional: {
                ...episodeToSave.metadata?.additional,
                sourceType: episodeToSave.metadata?.additional?.sourceType ?? "edited",
                sourceName:
                  trimmedName ||
                  episodeToSave.metadata?.additional?.sourceName ||
                  `Episode ${newEpisodeNumber} (edited)`,
                parentEpisodeId: episodeToSave.id,
                isEdited: true,
                lastEditedAt: now,
              },
            },
          };

          const appended = [...prevEpisodes, newEpisode];
          const normalized = renumberEpisodes(appended);
          savedEpisode = normalized.find((ep) => ep.id === newEpisode.id) ?? newEpisode;
          return normalized;
        }

        const targetIndex = prevEpisodes.findIndex((ep) => ep.id === episodeToSave.id);
        if (targetIndex === -1) {
          errorMessage = "Episode no longer exists";
          return prevEpisodes;
        }

        const nextEpisodes = [...prevEpisodes];
        const existing = nextEpisodes[targetIndex];
        const now = Date.now();
        const mergedMetadata: EpisodeMetadata | undefined =
          existing.metadata || episodeToSave.metadata
            ? {
                ...existing.metadata,
                ...episodeToSave.metadata,
                episodeNumber: existing.number,
                episode_index: existing.number - 1,
                joint_names: resolveJointNames(
                  episodeToSave.metadata ?? existing.metadata,
                  episodeToSave.frames
                ),
                num_frames: episodeToSave.frames.length,
                createdAt: existing.metadata?.createdAt ?? existing.createdAt,
                additional: {
                  ...existing.metadata?.additional,
                  ...episodeToSave.metadata?.additional,
                  sourceType:
                    existing.metadata?.additional?.sourceType ??
                    episodeToSave.metadata?.additional?.sourceType ??
                    "edited",
                  sourceName:
                    trimmedName ||
                    existing.metadata?.additional?.sourceName ||
                    `Episode ${existing.number} (edited)`,
                  parentEpisodeId:
                    existing.metadata?.additional?.parentEpisodeId ?? episodeToSave.id,
                  isEdited: true,
                  lastEditedAt: now,
                },
              }
            : undefined;

        const updatedEpisode: Episode = {
          ...existing,
          frames: cloneEpisodeFrames(episodeToSave.frames),
          metadata: mergedMetadata,
        };

        nextEpisodes[targetIndex] = updatedEpisode;
        savedEpisode = updatedEpisode;
        return nextEpisodes;
      });

      if (errorMessage) {
        toast.error(errorMessage);
        return;
      }

      if (savedEpisode) {
        onViewerSplitViewChange?.(true);
        onViewerOpenChange?.(true);
        onViewerEpisodeChange?.(savedEpisode);

        if (saveAsNew) {
          setCurrentPlayingEpisodeIndex(savedEpisode.number - 1);
        }

        toast.success(
          saveAsNew
            ? `Saved ${trimmedName || `Episode ${savedEpisode.number}`}`
            : `Episode ${savedEpisode.number} updated`
        );
      }
    },
    [
      onViewerEpisodeChange,
      onViewerOpenChange,
      onViewerSplitViewChange,
      setEpisodes,
      setCurrentPlayingEpisodeIndex,
    ]
  );

  useEffect(() => {
    if (!onEpisodeSaveHandlerChange) return;
    onEpisodeSaveHandlerChange(handleEpisodeSave);
    return () => onEpisodeSaveHandlerChange(undefined);
  }, [handleEpisodeSave, onEpisodeSaveHandlerChange]);
  
  // Mapping dialog state for Hugging Face loading
  const [showHfMappingDialog, setShowHfMappingDialog] = useState(false);
  const [hfMappingDialogData, setHfMappingDialogData] = useState<{
    datasetJoints: string[];
    jointRanges: Record<string, { min: number; max: number }>;
    source: string;
    datasetPath: string;
    firstEpisodeRows: Array<Record<string, unknown>>;
    firstEpisodeMap: Map<number, Array<Record<string, unknown>>>;
    allEpisodesPromise: Promise<{ allRows: Array<Record<string, unknown>>; episodesMap: Map<number, Array<Record<string, unknown>>> }>;
    jointNames: string[];
    loadingToastId?: string | number;
  } | null>(null);
  const [canApplyToWholeDataset, setCanApplyToWholeDataset] = useState(false);
  const [totalEpisodesCount, setTotalEpisodesCount] = useState<number | undefined>(undefined);
  const [expectedTotalEpisodes, setExpectedTotalEpisodes] = useState<number | undefined>(undefined);
  const backgroundLoadingPromiseRef = useRef<Promise<{ allRows: Array<Record<string, unknown>>; episodesMap: Map<number, Array<Record<string, unknown>>> }> | null>(null);
  
  // Store callbacks for mapping dialog
  const [applyFirstEpisodeCallback, setApplyFirstEpisodeCallback] = useState<((mappings: JointMapping[], degToRad: boolean) => void) | null>(null);
  const [applyWholeDatasetCallback, setApplyWholeDatasetCallback] = useState<((mappings: JointMapping[], degToRad: boolean) => Promise<void>) | null>(null);

  // Dispatch custom event when frame changes to sync with EpisodeViewer3DModal
  useEffect(() => {
    if (currentFrame !== undefined && currentPlayingEpisodeIndex !== null) {
      const event = new CustomEvent('viewer3d:frameUpdate', {
        detail: {
          frame: currentFrame,
          episodeIndex: currentPlayingEpisodeIndex,
          totalFrames: totalFrames,
        },
      });
      window.dispatchEvent(event);
    }
  }, [currentFrame, currentPlayingEpisodeIndex, totalFrames]);

  // Auto-update viewer episode when currentPlayingEpisodeIndex changes
  useEffect(() => {
    if (currentPlayingEpisodeIndex !== null && episodes.length > 0) {
      const currentEpisode = episodes[currentPlayingEpisodeIndex];
      if (currentEpisode) {
        // Always enable split view and open viewer when an episode is selected
        onViewerSplitViewChange?.(true);
        onViewerOpenChange?.(true);
        onViewerEpisodeChange?.(currentEpisode);
      }
    }
  }, [currentPlayingEpisodeIndex, episodes, onViewerEpisodeChange, onViewerSplitViewChange, onViewerOpenChange]);


  // Stop animation when all episodes are deleted
  useEffect(() => {
    if (episodes.length === 0) {
      // Stop all playback
      setIsPlayingAll(false);
      isPlayingAllRef.current = false;
      setPlaybackMode(null);
      setCurrentPlayingEpisodeIndex(null);
      currentLoadedEpisodeRef.current = null;
      // Stop 3D viewer animation
      viewerPlayback.stopAnimation();
      viewerPlayback.playAnimation(false);
      // Reset frame to 0
      viewerPlayback.setFrame(0);
    }
  }, [episodes.length]);

  const handleJointChange = (jointName: string, value: number) => {
    const limited = previewJointValue(jointName, value);
    if (!onJointChange) {
      setStoreJointValue(jointName, limited);
      return;
    }
    onJointChange(jointName, limited);
  };


  const handleLinkNameChange = useCallback((oldName: string, newName: string): void => {
    if (newName === oldName || !vizUrdf) return;

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(vizUrdf, "text/xml");
      
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        toast.error("Invalid URDF XML");
        return;
      }

      // Check if new name already exists
      const existingLink = xmlDoc.querySelector(`link[name="${newName}"]`);
      if (existingLink) {
        toast.error(`Link "${newName}" already exists`);
        return;
      }

      // Find the link
      const link = xmlDoc.querySelector(`link[name="${oldName}"]`);
      if (!link) {
        toast.error(`Link "${oldName}" not found`);
        return;
      }

      // Update the link name attribute
      link.setAttribute("name", newName);

      // Update all joint references to this link (parent and child)
      const joints = xmlDoc.querySelectorAll("joint");
      joints.forEach((joint) => {
        const parent = joint.querySelector("parent");
        const child = joint.querySelector("child");
        
        if (parent && parent.getAttribute("link") === oldName) {
          parent.setAttribute("link", newName);
        }
        if (child && child.getAttribute("link") === oldName) {
          child.setAttribute("link", newName);
        }
      });

      // Serialize back
      const serializer = new XMLSerializer();
      const newContent = serializer.serializeToString(xmlDoc);
      
      onVizUrdfChange?.(newContent);
      toast.success(`Link renamed from "${oldName}" to "${newName}"`);
    } catch (error) {
      console.error("Error updating link name:", error);
      toast.error("Failed to update link name");
    }
  }, [vizUrdf, onVizUrdfChange]);

  const handleJointLinkChange = useCallback((jointName: string, parentLink: string, childLink: string): void => {
    if (!vizUrdf) return;

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(vizUrdf, "text/xml");
      
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        toast.error("Invalid URDF XML");
        return;
      }

      const joint = xmlDoc.querySelector(`joint[name="${jointName}"]`);
      if (!joint) {
        toast.error(`Joint "${jointName}" not found`);
        return;
      }

      // Preserve joint attributes - they must remain fixed
      const preservedName = joint.getAttribute("name");
      const preservedType = joint.getAttribute("type");

      // Update or create parent element
      let parentElement = joint.querySelector("parent");
      if (!parentElement) {
        parentElement = xmlDoc.createElement("parent");
        joint.insertBefore(parentElement, joint.firstChild);
      }
      parentElement.setAttribute("link", parentLink);

      // Update or create child element
      let childElement = joint.querySelector("child");
      if (!childElement) {
        childElement = xmlDoc.createElement("child");
        if (parentElement.nextSibling) {
          joint.insertBefore(childElement, parentElement.nextSibling);
        } else {
          joint.appendChild(childElement);
        }
      }
      childElement.setAttribute("link", childLink);

      // Explicitly restore preserved attributes to ensure they're not lost
      if (preservedName) {
        joint.setAttribute("name", preservedName);
      }
      if (preservedType) {
        joint.setAttribute("type", preservedType);
      }

      // Serialize back
      const serializer = new XMLSerializer();
      const newContent = serializer.serializeToString(xmlDoc);
      
      onVizUrdfChange?.(newContent);
      toast.success(`Updated links for joint "${jointName}"`);
    } catch (error) {
      console.error("Error updating joint links:", error);
      toast.error("Failed to update joint links");
    }
  }, [vizUrdf, onVizUrdfChange]);

  // Recording implementation using ref to store frames
  const recordingFramesRef = useRef<RecordedFrame[]>([]);
  const recordingMetadataRef = useRef<{
    episodeId: string;
    episodeNumber?: number;
    insertPosition?: number;
    metadata?: EpisodeMetadata;
  } | null>(null);

  const captureFrame = useCallback(() => {
    const timestamp = Date.now() - recordingStartTime.current;
    const currentJointValues = useJointStore.getState().jointValues;
    recordingFramesRef.current.push({
      timestamp,
      jointPositions: { ...currentJointValues },
    });
    // Update stats
    const seconds = timestamp / 1000;
    setRecordingStats({
      frames: recordingFramesRef.current.length,
      seconds: seconds,
    });
  }, [recordingFramesRef, recordingStartTime]);

  const clearRecordingInterval = useCallback(() => {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }, []);

  const beginRecording = useCallback(
    (
      options: {
        episodeNumber?: number;
        insertPosition?: number;
        metadata?: EpisodeMetadata;
        fps?: number;
      } = {}
    ) => {
      clearRecordingInterval();
      const episodeId = `episode-${Date.now()}`;
      const fps = options.fps ?? recordingFps;

      recordingMetadataRef.current = { 
        episodeId, 
        ...options,
        metadata: {
          ...options.metadata,
          fps,
        },
      };
      recordingFramesRef.current = [];
      recordingStartTime.current = Date.now();
      setIsRecording(true);
      setCurrentRecordingEpisodeId(episodeId);
      setRecordingStats({ frames: 0, seconds: 0 });

      // Calculate interval from FPS
      const intervalMs = fps > 0 ? 1000 / fps : RECORDING_INTERVAL_MS;
      recordingIntervalRef.current = window.setInterval(
        captureFrame,
        intervalMs
      );
      return episodeId;
    },
    [captureFrame, clearRecordingInterval, recordingFps]
  );

  const startRecording = useCallback(() => {
    // Stop all replay/playback
    viewerPlayback.stopAnimation();
    setIsPlayingAll(false);
    isPlayingAllRef.current = false;
    setPlaybackMode(null);
    setCurrentPlayingEpisodeIndex(null);
    
    // Reset frame counters to beginning
    viewerPlayback.setFrame(0);
    onFrameChange?.(0);
    
    // Ensure robot movement is enabled when starting recording
    // This is critical - robot must be movable when recording
    setIsAnimating(false);
    
    // Start recording
    beginRecording({ fps: recordingFps });
    toast.success(`Started recording episode at ${recordingFps} FPS`);
  }, [beginRecording, recordingFps, onFrameChange, setIsAnimating]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    clearRecordingInterval();
    setRecordingStats({ frames: 0, seconds: 0 });

    const metadata = recordingMetadataRef.current;
    recordingMetadataRef.current = null;

    const framesToPersist = recordingFramesRef.current.map((frame) => ({
      timestamp: frame.timestamp,
      jointPositions: { ...frame.jointPositions },
    }));
    recordingFramesRef.current = [];

    if (framesToPersist.length === 0) {
      setCurrentRecordingEpisodeId(null);
      toast.info("Recording cancelled - no frames captured");
      return;
    }

    const episodeId =
      metadata?.episodeId ??
      currentRecordingEpisodeId ??
      `episode-${Date.now()}`;

    let recordedEpisodeNumber =
      metadata?.episodeNumber ?? episodes.length + 1;

    setEpisodes((prev) => {
      const insertIndex = normalizeInsertIndex(
        prev.length,
        metadata?.insertPosition
      );
      const episodeNumber = insertIndex + 1;
      recordedEpisodeNumber = episodeNumber;

      const existingMetadata = metadata?.metadata ?? undefined;
      const jointNames =
        Array.isArray(existingMetadata?.joint_names) &&
        existingMetadata.joint_names.length > 0
          ? (existingMetadata.joint_names as string[])
          : getJointOrderForFrames(framesToPersist);

      const calculatedFps = (() => {
        if (framesToPersist.length < 2) return 0;
        const start = framesToPersist[0].timestamp;
        const end = framesToPersist[framesToPersist.length - 1].timestamp;
        if (end <= start) return 0;
        return (framesToPersist.length - 1) / ((end - start) / 1000);
      })();

      // Use FPS from recording metadata (set when recording started), otherwise use calculated or user-specified default
      const fps =
        existingMetadata?.fps ??
        (calculatedFps > 0
          ? calculatedFps
          : recordingFps);

      const episodeLengthSec =
        existingMetadata?.episode_length_sec ??
        (framesToPersist[framesToPersist.length - 1]?.timestamp ?? 0) /
          1000;

      const episodeMetadata: EpisodeMetadata = {
        ...existingMetadata,
        episodeNumber,
        episode_index:
          existingMetadata?.episode_index ?? episodeNumber - 1,
        joint_names: jointNames,
        tasks:
          Array.isArray(existingMetadata?.tasks) &&
          existingMetadata.tasks.length > 0
            ? existingMetadata.tasks
            : [],
        fps,
        robot_type: existingMetadata?.robot_type ?? robotBaseName,
        task_index: existingMetadata?.task_index ?? 0,
        videos: existingMetadata?.videos ?? {},
        recorded_at:
          existingMetadata?.recorded_at ?? new Date().toISOString(),
        episode_length_sec: episodeLengthSec,
        codebase_version:
          existingMetadata?.codebase_version ?? "v3-compatible",
        createdAt: existingMetadata?.createdAt ?? Date.now(),
        num_frames: framesToPersist.length,
        // Mark this episode as recorded in the simulator and store source info
        additional: {
          ...existingMetadata?.additional,
          isRecorded: true,
          sourceType: 'recorded',
          sourceName: `Recording ${recordedEpisodeNumber}`,
        },
      };

      const next = [...prev];
      next.splice(
        insertIndex,
        0,
        createEpisode(
          episodeId,
          episodeNumber,
          framesToPersist,
          episodeMetadata
        )
      );
      return renumberEpisodes(next);
    });

    setCurrentRecordingEpisodeId(null);
    
    // Track source for recorded episodes
    setDatasetSources(prev => [...prev, { type: 'recorded', name: `Recording ${recordedEpisodeNumber}`, timestamp: Date.now() }]);
    
    toast.success(
      `Stopped recording. Episode ${recordedEpisodeNumber} saved with ${framesToPersist.length} frames`
    );
  }, [clearRecordingInterval, currentRecordingEpisodeId, episodes.length, setEpisodes, getJointOrderForFrames, recordingFps, robotBaseName]);

  const loadEpisodesFromDataFile = useCallback(
    async (file: File, options?: { suppressToast?: boolean; sourceName?: string }) => {
      try {
        if (!file || file.size === 0) {
          if (!options?.suppressToast) {
            toast.error(`File ${file.name} is empty or invalid`);
          }
          return false;
        }
        
        const text = await file.text();
        
        if (!text || text.trim().length === 0) {
          if (!options?.suppressToast) {
            toast.error(`File ${file.name} appears to be empty`);
          }
          return false;
        }
        const allowedJoints =
          availableJointsStore.length > 0
            ? new Set(getSortedJointList(availableJointsStore))
            : undefined;

        const jsonResult = parseEpisodeJson(text, {
          allowedJoints,
        });

        const episodesToAdd: EpisodeJsonEpisode[] = [];

        if (jsonResult.episodes && jsonResult.episodes.length > 0) {
          episodesToAdd.push(...jsonResult.episodes);
        } else if (jsonResult.frames) {
          episodesToAdd.push({
            frames: jsonResult.frames,
            jointOrder:
              jsonResult.jointOrder ??
              Array.from(
                new Set(
                  jsonResult.frames.flatMap((frame) =>
                    Object.keys(frame.joints)
                  )
                )
              ),
            metadata: jsonResult.metadata,
          });
        } else {
          const csvResult = parseEpisodeCsv(text, {
            allowedJoints,
          });
          if (!csvResult.frames) {
            toast.error(
              jsonResult.error ?? csvResult.error ?? "Failed to parse animation data file"
            );
            return false;
          }

          episodesToAdd.push({
            frames: csvResult.frames,
            jointOrder:
              csvResult.jointOrder ??
              Array.from(
                new Set(
                  csvResult.frames.flatMap((frame) =>
                    Object.keys(frame.joints)
                  )
                )
              ),
          });
        }

        let totalFramesLoaded = 0;
        let episodesAdded = 0;

        setEpisodes((prev) => {
          const nextEpisodes = [...prev];
          for (const episode of episodesToAdd) {
            const frames: RecordedFrame[] = episode.frames.map((frame) => ({
              timestamp: frame.timestamp,
              jointPositions: frame.joints,
            }));
            if (frames.length === 0) continue;
            totalFramesLoaded += frames.length;
            episodesAdded += 1;

            const metadataNumber =
              episode.metadata?.episodeNumber ?? nextEpisodes.length + 1;

            const recordedAtRaw = episode.metadata?.recorded_at;
            const createdAt =
              episode.metadata?.createdAt ??
              (typeof recordedAtRaw === "string"
                ? (() => {
                    const parsed = Date.parse(recordedAtRaw);
                    return Number.isFinite(parsed) ? parsed : undefined;
                  })()
                : undefined);

            const jointNames =
              Array.isArray(episode.metadata?.joint_names) &&
              episode.metadata.joint_names.length > 0
                ? (episode.metadata.joint_names as string[])
                : episode.jointOrder;

            const episodeMetadata: EpisodeMetadata = {
              ...(episode.metadata ?? {}),
              episodeNumber: metadataNumber,
              episode_index:
                episode.metadata?.episode_index ?? metadataNumber - 1,
              joint_names: jointNames,
              tasks:
                Array.isArray(episode.metadata?.tasks) &&
                episode.metadata.tasks.length > 0
                  ? episode.metadata.tasks
                  : [],
              createdAt,
              num_frames: frames.length,
              // Preserve existing source info or add local source if not present
              additional: {
                ...episode.metadata?.additional,
                sourceType: episode.metadata?.additional?.sourceType || 'local',
                sourceName: episode.metadata?.additional?.sourceName || options?.sourceName || file.name,
              },
            };

            const newEpisode = createEpisode(
              `episode-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              metadataNumber,
              frames,
              episodeMetadata
            );

            const insertPositionHint =
              typeof episode.metadata?.episode_index === "number"
                ? episode.metadata.episode_index
                : typeof episode.metadata?.episodeNumber === "number"
                ? episode.metadata.episodeNumber - 1
                : undefined;

            const insertIndex = normalizeInsertIndex(
              nextEpisodes.length,
              insertPositionHint
            );

            nextEpisodes.splice(insertIndex, 0, newEpisode);
          }

          return renumberEpisodes(nextEpisodes);
        });

        if (totalFramesLoaded === 0) {
          toast.error("No valid frames found in the data file");
          return false;
        }

        if (!options?.suppressToast) {
          const episodeCount = episodesAdded;
          toast.success(
            `Loaded ${episodeCount} episode${
              episodeCount === 1 ? "" : "s"
            } (${totalFramesLoaded} frame${
              totalFramesLoaded === 1 ? "" : "s"
            }) from ${file.name}`
          );
        }

        return true;
      } catch (error) {
        console.error(`Error loading animation data from ${file.name}:`, error);
        if (!options?.suppressToast) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          toast.error(`Failed to read ${file.name}${errorMessage ? `: ${errorMessage}` : ""}`);
        }
        return false;
      }
    },
    [availableJointsStore, setEpisodes]
  );

  const loadEpisodesFromArchiveZip = useCallback(
    async (zip: JSZip) => {
      // Check if this is a v3 dataset format
      const infoJsonEntry = Object.values(zip.files).find(
        (entry) => entry.name.includes("meta/info.json") && !entry.dir
      );

      if (infoJsonEntry) {
        // This is a v3 dataset format
        try {
          const infoContent = await infoJsonEntry.async("text");
          const infoJson = JSON.parse(infoContent);
          
          // Check for v3 format by codebase_version or dataset_format_version
          const isV3Format = 
            infoJson.codebase_version === "v3.0" || 
            infoJson.dataset_format_version === "lerobot_dataset_v3";
          
          if (isV3Format) {
            // Load v3 dataset format
            const dataEntries = Object.values(zip.files).filter(
              (entry) =>
                !entry.dir &&
                entry.name.includes("data/chunk-") &&
                entry.name.endsWith(".parquet")
            );

            if (dataEntries.length === 0) {
              // Silently return if no data files - might be empty dataset
              return;
            }

            // Sort data entries
            dataEntries.sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { numeric: true })
            );

            let totalFramesLoaded = 0;
            let episodesAdded = 0;

            // Process each data file
            for (const dataEntry of dataEntries) {
              try {
                const content = await dataEntry.async("text");
                const lines = content.split("\n").filter((line) => line.trim().length > 0);
                
                const rows: Array<Record<string, unknown>> = [];
                for (const line of lines) {
                  try {
                    const row = JSON.parse(line);
                    rows.push(row);
                  } catch (e) {
                    console.warn(`Failed to parse line in ${dataEntry.name}:`, e);
                  }
                }

                // Group rows by episode_index
                const episodesMap = new Map<number, Array<Record<string, unknown>>>();
                for (const row of rows) {
                  const episodeIndex = row.episode_index as number;
                  if (!episodesMap.has(episodeIndex)) {
                    episodesMap.set(episodeIndex, []);
                  }
                  episodesMap.get(episodeIndex)!.push(row);
                }

                // Load episodes from info.json to get metadata
                const episodesEntry = Object.values(zip.files).find(
                  (entry) =>
                    !entry.dir &&
                    entry.name.includes("meta/episodes/chunk-") &&
                    entry.name.endsWith(".parquet")
                );

                type EpisodeSummary = {
                  episode_index: number;
                  tasks?: number[];
                } & Record<string, unknown>;

                const episodeSummariesMap = new Map<number, EpisodeSummary>();
                if (episodesEntry) {
                  try {
                    const episodesContent = await episodesEntry.async("text");
                    const episodeLines = episodesContent
                      .split("\n")
                      .filter((line) => line.trim().length > 0);
                    for (const line of episodeLines) {
                      try {
                        const summary = JSON.parse(line);
                        episodeSummariesMap.set(summary.episode_index, summary);
                      } catch (e) {
                        console.warn(`Failed to parse episode summary:`, e);
                      }
                    }
                  } catch (e) {
                    console.warn("Failed to load episode summaries:", e);
                  }
                }

                // Load tasks.parquet if available
                const tasksEntry = Object.values(zip.files).find(
                  (entry) =>
                    !entry.dir && entry.name.includes("meta/tasks.parquet")
                );
                const taskIndexToName = new Map<number, string>();
                if (tasksEntry) {
                  try {
                    const tasksContent = await tasksEntry.async("text");
                    const taskLines = tasksContent
                      .split("\n")
                      .filter((line) => line.trim().length > 0);
                    for (const line of taskLines) {
                      try {
                        const task = JSON.parse(line);
                        taskIndexToName.set(task.task_index, task.task);
                      } catch (e) {
                        console.warn(`Failed to parse task:`, e);
                      }
                    }
                  } catch (e) {
                    console.warn("Failed to load tasks:", e);
                  }
                }

                // Get joint names from info.json
                // Support both 'names' and 'fieldNames' for compatibility
                const rawJointNames =
                  infoJson.features?.action?.names ??
                  infoJson.features?.action?.fieldNames ??
                  infoJson.features?.["observation.state"]?.names ??
                  infoJson.features?.["observation.state"]?.fieldNames ??
                  [];
                
                // Strip .pos suffix from joint names if present
                const jointNames = rawJointNames.map((name: string) => {
                  if (typeof name === "string" && name.endsWith(".pos")) {
                    return name.slice(0, -4); // Remove ".pos"
                  }
                  return name;
                });

                // Collect all episodes first
                const newEpisodes: Episode[] = [];
                for (const [episodeIndex, episodeRows] of episodesMap.entries()) {
                  // Sort rows by frame_index
                  episodeRows.sort((a, b) => {
                    const aIdx = a.frame_index as number;
                    const bIdx = b.frame_index as number;
                    return aIdx - bIdx;
                  });

                  // Extract frames
                  const frames: RecordedFrame[] = episodeRows.map((row) => {
                    const action = row.action as number[] | undefined;
                    const observationState = row["observation.state"] as number[] | undefined;
                    const dataArray = action ?? observationState ?? [];
                    const timestamp = (row.timestamp as number) * 1000; // Convert to milliseconds
                    
                    // Convert action array to joint positions object
                    const actualJointNames =
                      jointNames.length > 0
                        ? jointNames
                        : dataArray.map((_, i) => `joint_${i}`);
                    
                    const jointPositions: Record<string, number> = {};
                    actualJointNames.forEach((name: string, idx: number) => {
                      jointPositions[name] = dataArray[idx] ?? 0;
                    });

                    return {
                      timestamp,
                      jointPositions,
                    };
                  });

                  if (frames.length === 0) continue;

                  totalFramesLoaded += frames.length;
                  episodesAdded += 1;

                  const summary = episodeSummariesMap.get(episodeIndex);
                  const tasks = Array.isArray(summary?.tasks) ? summary.tasks : [];
                  const taskNames = tasks
                    .map((taskIdx: number) => taskIndexToName.get(taskIdx))
                    .filter((name: string | undefined) => name !== undefined) as string[];

                  // Get actual joint names from first frame if available
                  const firstFrame = frames[0];
                  const firstFrameJointNames = firstFrame
                    ? Object.keys(firstFrame.jointPositions)
                    : [];
                  const actualJointNamesForMetadata =
                    jointNames.length > 0
                      ? jointNames
                      : firstFrameJointNames.length > 0
                      ? firstFrameJointNames
                      : [];

                  const episodeMetadata: EpisodeMetadata = {
                    episodeNumber: episodeIndex + 1,
                    episode_index: episodeIndex,
                    task_index: tasks[0] ?? 0,
                    tasks: taskNames,
                    robot_type: infoJson.robot_type ?? robotBaseName,
                    fps: infoJson.fps ?? 1000 / RECORDING_INTERVAL_MS,
                    joint_names: actualJointNamesForMetadata,
                    codebase_version: infoJson.codebase_version ?? "v3-compatible",
                    num_frames: frames.length,
                    episode_length_sec: (frames[frames.length - 1]?.timestamp ?? 0) / 1000,
                    // Preserve existing source info or add local source if not present
                    additional: {
                      sourceType: 'local',
                      sourceName: 'local_dataset',
                    },
                  };

                  const newEpisode = createEpisode(
                    `episode-${Date.now()}-${Math.random().toString(36).slice(2)}-${episodeIndex}`,
                    episodeIndex + 1,
                    frames,
                    episodeMetadata
                  );

                  newEpisodes.push(newEpisode);
                }

                // Add all episodes at once
                if (newEpisodes.length > 0) {
                  setEpisodes((prev) => {
                    const nextEpisodes = [...prev];
                    // Sort by episode_index for proper insertion
                    newEpisodes.sort((a, b) => {
                      const aIdx = a.metadata?.episode_index ?? a.number - 1;
                      const bIdx = b.metadata?.episode_index ?? b.number - 1;
                      return aIdx - bIdx;
                    });
                    for (const episode of newEpisodes) {
                      const episodeIndex = episode.metadata?.episode_index ?? episode.number - 1;
                      const insertIndex = normalizeInsertIndex(
                        nextEpisodes.length,
                        episodeIndex
                      );
                      nextEpisodes.splice(insertIndex, 0, episode);
                    }
                    return renumberEpisodes(nextEpisodes);
                  });
                }
              } catch (error) {
                console.error(`Failed to load ${dataEntry.name} from archive:`, error);
              }
            }

            if (episodesAdded > 0) {
              toast.success(
                `Loaded v3 dataset: ${episodesAdded} episode${
                  episodesAdded === 1 ? "" : "s"
                } (${totalFramesLoaded} frame${totalFramesLoaded === 1 ? "" : "s"})`
              );
            }
            return;
          }
        } catch (error) {
          // Silently fall through to legacy format handling
          // Don't log error - might not be v3 format
        }
      }

      // Legacy format handling (manifest.json or individual files)
      const entries = Object.values(zip.files).filter(
        (entry) =>
          !entry.dir &&
          (entry.name.toLowerCase().endsWith(".json") ||
            entry.name.toLowerCase().endsWith(".csv") ||
            entry.name.toLowerCase().endsWith(".pos"))
      );

      if (entries.length === 0) {
        // Silently return if no entries found
        return;
      }

      entries.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      );

      const manifestEntry = entries.find((entry) =>
        entry.name.toLowerCase().endsWith("manifest.json")
      );

      let loadedCount = 0;

      const processEntry = async (entry: JSZip.JSZipObject) => {
        try {
          const content = await entry.async("blob");
          const fileName = entry.name.split("/").pop() ?? entry.name;
          const type = fileName.toLowerCase().endsWith(".json")
            ? "application/json"
            : "text/csv";
          const file = new File([content], fileName, { type });
          const success = await loadEpisodesFromDataFile(file, {
            suppressToast: true,
          });
          if (success) {
            loadedCount += 1;
          }
        } catch (error) {
          console.error(`Failed to load ${entry.name} from archive:`, error);
        }
      };

      if (manifestEntry) {
        await processEntry(manifestEntry);
      }

      for (const entry of entries) {
        if (manifestEntry && entry.name === manifestEntry.name) continue;
        if (manifestEntry && entry.name.toLowerCase().endsWith(".json")) {
          // Manifest already contains JSON data; skip individual JSON files to prevent duplicates.
          continue;
        }
        await processEntry(entry);
      }

      if (loadedCount > 0) {
        toast.success(
          `Loaded ${loadedCount} data file${loadedCount > 1 ? "s" : ""} from archive`
        );
      }
    },
    [loadEpisodesFromDataFile, setEpisodes, robotBaseName]
  );

  const exportEpisodeToDataFile = useCallback((episode: Episode) => {
    if (episode.frames.length === 0) {
      toast.error("No recorded data to export");
      return;
    }

    const joints =
      Array.isArray(episode.metadata?.joint_names) &&
      episode.metadata.joint_names.length > 0
        ? (episode.metadata.joint_names as string[])
        : getJointOrderForFrames(episode.frames);

    const computedFps = (() => {
      if (episode.frames.length < 2) return 0;
      const start = episode.frames[0].timestamp;
      const end = episode.frames[episode.frames.length - 1].timestamp;
      if (end <= start) return 0;
      return (episode.frames.length - 1) / ((end - start) / 1000);
    })();

    const metadata: EpisodeMetadata = {
      ...(episode.metadata ?? {}),
      episodeNumber: episode.number,
      episode_index:
        episode.metadata?.episode_index ?? episode.number - 1,
      task_index: episode.metadata?.task_index ?? 0,
      robot_type: episode.metadata?.robot_type ?? robotBaseName,
      fps:
        episode.metadata?.fps ??
        (computedFps > 0
          ? computedFps
          : 1000 / RECORDING_INTERVAL_MS),
      joint_names: joints,
      videos: episode.metadata?.videos ?? {},
      recorded_at:
        episode.metadata?.recorded_at ??
        new Date(episode.createdAt).toISOString(),
      episode_length_sec:
        episode.metadata?.episode_length_sec ??
        (episode.frames[episode.frames.length - 1]?.timestamp ?? 0) /
          1000,
      codebase_version:
        episode.metadata?.codebase_version ?? "v3-compatible",
      createdAt: episode.metadata?.createdAt ?? episode.createdAt,
    };

    const exportContent = serializeEpisodeJson(
      episode.frames.map((frame) => ({
        timestamp: frame.timestamp,
        joints: frame.jointPositions,
      })),
      joints,
      metadata
    );

    const blob = new Blob([exportContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const filename = `${robotBaseName}_episode_${String(episode.number).padStart(3, "0")}.json`;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);

    toast.success(`Exported Episode ${episode.number} to ${filename}`);
  }, [getJointOrderForFrames, robotBaseName]);

  // Handle file upload for dataset loading
  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files) as FileWithRelativePath[];
    
    // Check if this is a v3 dataset folder structure
    const hasInfoJson = fileArray.some((file) => {
      const path = file.webkitRelativePath || file.name;
      return path.includes("meta/info.json") || path.endsWith("info.json");
    });

    if (hasInfoJson) {
      // This is a v3 dataset folder - convert to zip and load
      try {
        const zip = new JSZip();
        const infoJsonFile = fileArray.find((file) => {
          const path = file.webkitRelativePath || file.name;
          return path.includes("meta/info.json") || path.endsWith("info.json");
        });
        
        if (!infoJsonFile) return;

        // Determine base path
        const infoPath = infoJsonFile.webkitRelativePath || infoJsonFile.name;
        let basePath = "";
        if (infoPath.includes("/")) {
          const parts = infoPath.split("/");
          if (parts.length > 2) {
            basePath = parts.slice(0, -2).join("/") + "/";
          }
        }
        
        // Add all files to zip preserving folder structure
        for (const file of fileArray) {
          const path = file.webkitRelativePath || file.name;
          let normalizedPath = path;
          if (basePath && path.startsWith(basePath)) {
            normalizedPath = path.slice(basePath.length);
          }
          if (normalizedPath && !normalizedPath.endsWith("/")) {
            const content = await file.arrayBuffer();
            zip.file(normalizedPath, content);
          }
        }
        
        // Track source name before loading
        const folderName = fileArray[0]?.webkitRelativePath?.split('/')[0] || fileArray[0]?.name || 'local_dataset';
        
        // Load episodes
        await loadEpisodesFromArchiveZip(zip);
        
        // Update source info for episodes loaded from this archive
        setEpisodes(prev => prev.map(ep => {
          // Only update if source info is missing (newly loaded episodes)
          if (!ep.metadata?.additional?.sourceType || ep.metadata.additional.sourceName === 'local_dataset') {
            return {
              ...ep,
              metadata: {
                ...ep.metadata,
                additional: {
                  ...ep.metadata?.additional,
                  sourceType: 'local',
                  sourceName: folderName,
                },
              },
            };
          }
          return ep;
        }));
        
        setDatasetSources(prev => [...prev, { type: 'local', name: folderName, timestamp: Date.now() }]);
      } catch (error) {
        console.error("Failed to load v3 dataset folder:", error);
      }
      return;
    }

    // Legacy format: individual data files
    const motionDataFiles = fileArray
      .filter((file) => {
        const name = file.name.toLowerCase();
        return name.endsWith(".json") || name.endsWith(".csv") || name.endsWith(".pos");
      })
      .sort((a, b) => {
        const pathA = a.webkitRelativePath || a.name;
        const pathB = b.webkitRelativePath || b.name;
        return pathA.localeCompare(pathB);
      });

    if (motionDataFiles.length === 0) return;

    const suppressIndividualToasts = motionDataFiles.length > 1;
    let successfulLoads = 0;
    const failedFiles: string[] = [];

    for (const file of motionDataFiles) {
      try {
        const loaded = await loadEpisodesFromDataFile(file, { 
          suppressToast: suppressIndividualToasts,
          sourceName: file.name,
        });
        if (loaded) {
          successfulLoads += 1;
        } else {
          failedFiles.push(file.name);
        }
      } catch (error) {
        console.error(`Failed to load ${file.name}:`, error);
        failedFiles.push(file.name);
      }
    }

    if (suppressIndividualToasts && successfulLoads > 0) {
      const message = failedFiles.length > 0
        ? `Loaded ${successfulLoads} episode file${successfulLoads > 1 ? "s" : ""} (${failedFiles.length} failed)`
        : `Loaded ${successfulLoads} episode file${successfulLoads > 1 ? "s" : ""}`;
      toast.success(message);
    }

    // Track source if files were loaded
    if (successfulLoads > 0) {
      const sourceName = motionDataFiles.length === 1 
        ? motionDataFiles[0].name 
        : `${motionDataFiles.length} files`;
      setDatasetSources(prev => [...prev, { type: 'local', name: sourceName, timestamp: Date.now() }]);
    }
  }, [loadEpisodesFromArchiveZip, loadEpisodesFromDataFile]);

  const uploadEpisodesToHuggingFace = useCallback(async () => {
    if (isUploadingToHF) return;
    if (episodes.length === 0) {
      toast.error("No episodes available for upload");
      return;
    }

    setIsUploadingToHF(true);
    try {
      const token = await ensureHfToken();
      if (!token) return;

      let identity: HfIdentity | null = null;
      try {
        identity = await fetchHfIdentity(token);
      } catch (error) {
        console.error("Failed to fetch Hugging Face identity:", error);
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "Failed to fetch Hugging Face profile"
        );
        return;
      }

      const targetSpace = promptForSpace("upload", identity?.name);
      if (!targetSpace) return;

      const infoResponse = await fetchHfSpaceInfo(token, targetSpace.owner, targetSpace.name);
      if (infoResponse.status === 404) {
        const shouldCreate = window.confirm(
          `Hugging Face Space ${targetSpace.owner}/${targetSpace.name} does not exist. Create it now?`
        );
        if (!shouldCreate) {
          toast.error("Space not found. Please create it on Hugging Face first.");
          return;
        }
        const visibilityPrompt = window
          .prompt("Set visibility for the new space (public/private).", "private")
          ?.trim()
          .toLowerCase();
        const visibility: HFSpaceVisibility = visibilityPrompt === "public" ? "public" : "private";
        try {
          await createHfSpace(token, identity?.name, targetSpace.owner, targetSpace.name, visibility);
          toast.success(
            `Created Hugging Face Space ${targetSpace.owner}/${targetSpace.name} (${visibility})`
          );
        } catch (error) {
          console.error("Failed to create Hugging Face Space:", error);
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : "Failed to create Hugging Face Space"
          );
          return;
        }
      } else if (!infoResponse.ok) {
        const message = await infoResponse.text();
        toast.error(message || "Failed to access Hugging Face Space");
        return;
      }

      // Generate v3 dataset format using common helper
      const datasetName = `${robotBaseName}_v3`;
      const zip = new JSZip();
      await generateV3DatasetArchive(episodes, robotBaseName, zip, datasetName, robotName, availableJointsStore);
      const blob = await zip.generateAsync({ type: "blob" });
      
      // Get total frames for success message
      const episodeData = buildEpisodeDataForV3(episodes, robotBaseName, robotName, availableJointsStore);
      const { totalFrames } = episodeData;
      const formData = new FormData();
      formData.append("file", blob, `${datasetName}.zip`);

      toast.info(
        `Uploading v3 dataset to Hugging Face Space ${targetSpace.owner}/${targetSpace.name}...`
      );

      const response = await fetch(
        `https://huggingface.co/api/spaces/${encodeURIComponent(targetSpace.owner)}/${encodeURIComponent(targetSpace.name)}/upload?path=${encodeURIComponent(`${datasetName}.zip`)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Upload failed");
      }

      toast.success(
        `Uploaded v3 dataset (${episodes.length} episodes, ${totalFrames} frames) to Hugging Face Space ${targetSpace.owner}/${targetSpace.name}`
      );
    } catch (error) {
      console.error("Failed to upload dataset to Hugging Face:", error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to upload dataset to Hugging Face"
      );
    } finally {
      setIsUploadingToHF(false);
    }
  }, [
    createHfSpace,
    ensureHfToken,
    fetchHfIdentity,
    fetchHfSpaceInfo,
    isUploadingToHF,
    promptForSpace,
    episodes,
    robotBaseName,
    robotName,
    availableJointsStore,
  ]);

  const exportDatasetToLeRobotFormat = useCallback(async () => {
    if (episodes.length === 0) {
      toast.error("No episodes available for dataset export");
      return;
    }

    setIsExportingDataset(true);
    try {
      const datasetName = `${robotBaseName}_v3`;
      const zip = new JSZip();
      await generateV3DatasetArchive(episodes, robotBaseName, zip, datasetName, robotName, availableJointsStore);
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${datasetName}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("LeRobotDataset v3 archive generated");
    } catch (error) {
      console.error(error);
      toast.error("Failed to export LeRobotDataset archive");
    } finally {
      setIsExportingDataset(false);
    }
  }, [episodes, robotBaseName, robotName, availableJointsStore]);

  // Helper function to export current episodes as blob for dataset mixing
  const exportCurrentEpisodesAsBlob = useCallback(async (): Promise<Blob> => {
    if (episodes.length === 0) {
      throw new Error("No episodes to export");
    }

    const datasetName = `temp_mix_${Date.now()}`;
    const zip = new JSZip();
    await generateV3DatasetArchive(
      episodes,
      robotBaseName,
      zip,
      datasetName,
      robotName,
      availableJointsStore
    );

    const blob = await zip.generateAsync({ type: "blob" });
    return blob;
  }, [episodes, robotBaseName, robotName, availableJointsStore]);

  const loadEpisodesFromHuggingFace = useCallback(async () => {
    if (isImportingFromHF) return;

    setIsImportingFromHF(true);
    try {
      const token = await ensureHfToken();
      if (token === null) return;

      let identity: HfIdentity | null = null;
      if (token) {
        try {
          identity = await fetchHfIdentity(token);
        } catch (error) {
          console.warn("Failed to fetch Hugging Face identity, continuing without default owner:", error);
          identity = null;
        }
      }

      const targetSpace = promptForSpace("download", identity?.name);
      if (!targetSpace) return;

      const infoResponse = await fetchHfSpaceInfo(token, targetSpace.owner, targetSpace.name);
      if (!infoResponse.ok) {
        if (infoResponse.status === 404) {
          toast.error(`Hugging Face Space ${targetSpace.owner}/${targetSpace.name} was not found`);
        } else {
          const message = await infoResponse.text();
          toast.error(message || "Failed to access Hugging Face Space");
        }
        return;
      }

      const defaultArchiveName = `${robotBaseName}_episodes.zip`;
      const archivePrompt = window
        .prompt(
          "Enter the recordings archive filename stored in the Space (e.g. robot_episodes.zip).",
          defaultArchiveName
        )
        ?.trim();

      if (!archivePrompt) {
        toast.info("Cancelled loading from Hugging Face");
        return;
      }

      toast.info(`Downloading recordings from ${targetSpace.owner}/${targetSpace.name}...`);

      const response = await fetch(
        `https://huggingface.co/api/spaces/${encodeURIComponent(targetSpace.owner)}/${encodeURIComponent(targetSpace.name)}/files/download?filename=${encodeURIComponent(archivePrompt)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/zip",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Download failed");
      }

      const blob = await response.blob();
      const zip = await JSZip.loadAsync(blob);
      await loadEpisodesFromArchiveZip(zip);
    } catch (error) {
      console.error("Failed to load recordings from Hugging Face:", error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to load recordings from Hugging Face"
      );
    } finally {
      setIsImportingFromHF(false);
    }
  }, [
    ensureHfToken,
    fetchHfIdentity,
    fetchHfSpaceInfo,
    isImportingFromHF,
    loadEpisodesFromArchiveZip,
    promptForSpace,
    robotBaseName,
  ]);

  const loadEpisodesFromHuggingFaceDataset = useCallback(async () => {
    if (isImportingFromHFDataset) return;

    setIsImportingFromHFDataset(true);
    let loadingToastId: string | number | undefined;
    try {
      // Prompt for dataset path
      const datasetPath = window
        .prompt(
          "Enter the Hugging Face dataset path (e.g., amtellezfernandez/robot-learning-tutorial-data).\nYou can paste a full URL.",
          ""
        )
        ?.trim();

      if (!datasetPath) {
        setIsImportingFromHFDataset(false);
        return;
      }

      // Show persistent loading indicator
      loadingToastId = toast.loading("Loading dataset...", {
        duration: Infinity,
      });

      // Parse the dataset path (handle full URLs)
      let parsedPath = datasetPath;
      if (datasetPath.includes("huggingface.co/datasets/")) {
        const match = datasetPath.match(/huggingface\.co\/datasets\/([^/]+\/[^/\s?#]+)/);
        if (match) {
          parsedPath = match[1];
        }
      }

      // Validate format
      if (!parsedPath.includes("/") || parsedPath.split("/").length !== 2) {
        if (loadingToastId) {
          toast.dismiss(loadingToastId);
        }
        toast.error("Dataset path must be in format: owner/dataset-name");
        setIsImportingFromHFDataset(false);
        return;
      }

      // Silent loading - no toast for initial fetch

      const headers: Record<string, string> = { Accept: "application/json" };
      if (hfToken) {
        headers.Authorization = `Bearer ${hfToken}`;
      }

      // Fetch the repository file tree to find parquet files
      const treeUrl = `https://huggingface.co/api/datasets/${parsedPath}/tree/main`;
      const treeResponse = await fetch(treeUrl, { headers });

      if (!treeResponse.ok) {
        if (loadingToastId) {
          toast.dismiss(loadingToastId);
        }
        if (treeResponse.status === 404) {
          toast.error(`Dataset ${parsedPath} not found or not accessible`);
        } else if (treeResponse.status === 401 || treeResponse.status === 403) {
          toast.error("Dataset requires authentication. Please set your HF token first.");
        } else {
          const errorText = await treeResponse.text();
          toast.error(errorText || "Failed to fetch dataset info");
        }
        setIsImportingFromHFDataset(false);
        return;
      }

      const treeItems = await treeResponse.json();

      // Find all parquet files in data/ directory and URDF/mesh files in the dataset
      // We need to recursively explore the entire dataset structure
      const parquetUrls: string[] = [];
      const urdfUrls: Array<{ url: string; path: string }> = [];
      const meshUrls: Array<{ url: string; path: string }> = [];
      const foldersToExplore: string[] = [];
      const exploredPaths = new Set<string>();

      // Start by exploring root level for URDF/mesh files
      foldersToExplore.push("");

      // First pass: find data folder for parquet files
      for (const item of treeItems) {
        if (item.type === "directory" && item.path === "data") {
          foldersToExplore.push("data");
        }
      }

      // Recursively explore all folders
      while (foldersToExplore.length > 0) {
        const folder = foldersToExplore.shift()!;
        if (exploredPaths.has(folder)) continue;
        exploredPaths.add(folder);

        const folderUrl = folder 
          ? `https://huggingface.co/api/datasets/${parsedPath}/tree/main/${folder}`
          : `https://huggingface.co/api/datasets/${parsedPath}/tree/main`;
        const folderResponse = await fetch(folderUrl, { headers });

        if (!folderResponse.ok) {
          console.warn(`Failed to fetch folder ${folder}: ${folderResponse.status} ${folderResponse.statusText}`);
          continue;
        }

        const folderItems = await folderResponse.json();
        // Check if we're currently exploring within the data folder
        const isInDataFolder = folder === "data" || folder.startsWith("data/");
        
        for (const item of folderItems) {
          // HuggingFace API returns absolute paths from root, but handle both cases
          // If path doesn't contain "/" and we're in a folder, construct full path
          const fullPath = (!item.path.includes("/") && folder) 
            ? `${folder}/${item.path}`
            : item.path;
          
          if (item.type === "directory") {
            foldersToExplore.push(fullPath);
          } else if (item.type === "file") {
            const itemPath = fullPath.toLowerCase();
            if (itemPath.endsWith(".parquet")) {
              // Build the download URL for the parquet file (only from data/ folder)
              // Check if file is in data folder by checking current folder or file path
              if (isInDataFolder || fullPath.startsWith("data/")) {
                const downloadUrl = `https://huggingface.co/datasets/${parsedPath}/resolve/main/${fullPath}`;
                parquetUrls.push(downloadUrl);
                console.log(`Found parquet file: ${fullPath}`);
              }
            } else if (itemPath.endsWith(".urdf")) {
              // Found URDF file
              const downloadUrl = `https://huggingface.co/datasets/${parsedPath}/resolve/main/${fullPath}`;
              urdfUrls.push({ url: downloadUrl, path: fullPath });
            } else if (itemPath.endsWith(".stl")) {
              // Found STL mesh file
              const downloadUrl = `https://huggingface.co/datasets/${parsedPath}/resolve/main/${fullPath}`;
              meshUrls.push({ url: downloadUrl, path: fullPath });
            }
          }
        }
      }

      // Load URDF and mesh files if found
      if (urdfUrls.length > 0) {
        // Silent loading - no intermediate toast
        
        // Use the first URDF file found (prioritize root level or common locations)
        const urdfToLoad = urdfUrls.sort((a, b) => {
          // Prioritize files in root or common locations
          const aDepth = a.path.split("/").length;
          const bDepth = b.path.split("/").length;
          if (aDepth !== bDepth) return aDepth - bDepth;
          // Prefer files named "robot.urdf" or similar
          const aIsRobot = a.path.toLowerCase().includes("robot");
          const bIsRobot = b.path.toLowerCase().includes("robot");
          if (aIsRobot && !bIsRobot) return -1;
          if (!aIsRobot && bIsRobot) return 1;
          return 0;
        })[0];

        try {
          const urdfResponse = await fetch(urdfToLoad.url, { headers });
          if (urdfResponse.ok) {
            const urdfContent = await urdfResponse.text();
            
            // Update URDF content
            if (onVizUrdfChange) {
              onVizUrdfChange(urdfContent);
            }

            // Extract mesh references from URDF
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
            const meshReferences = new Set<string>();
            const meshElements = xmlDoc.querySelectorAll("mesh");
            meshElements.forEach((mesh) => {
              const filename = mesh.getAttribute("filename");
              if (filename) {
                // Normalize mesh reference
                const normalized = filename
                  .replace(/^package:\/\/[^/]+\//, "")
                  .replace(/^file:\/\//, "")
                  .trim();
                if (normalized) {
                  meshReferences.add(normalized);
                }
              }
            });

            // Load mesh files that match URDF references
            if (meshReferences.size > 0 && meshUrls.length > 0) {
              const urdfDir = urdfToLoad.path.substring(0, urdfToLoad.path.lastIndexOf("/")) || "";
              const loadedMeshes: Record<string, Blob> = {};

              // Helper to normalize path
              const normalizePath = (path: string): string => {
                return path.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
              };

              // Helper to resolve mesh path relative to URDF
              const resolveMeshPath = (urdfDir: string, meshRef: string): string => {
                const path = meshRef
                  .replace(/^package:\/\/[^/]+\//, "")
                  .replace(/^file:\/\//, "")
                  .trim()
                  .replace(/\\/g, "/")
                  .replace(/^\/+/, "");

                if (!path) return "";

                if (!urdfDir) return normalizePath(path);

                const urdfParts = urdfDir.split("/").filter(Boolean);
                const meshParts = path.split("/").filter(Boolean);
                const resolvedParts = [...urdfParts];

                for (const part of meshParts) {
                  if (part === "..") {
                    if (resolvedParts.length > 0) resolvedParts.pop();
                  } else if (part !== "." && part !== "") {
                    resolvedParts.push(part);
                  }
                }

                return normalizePath(resolvedParts.join("/"));
              };

              // Match mesh files to URDF references
              for (const meshRef of meshReferences) {
                const resolvedPath = resolveMeshPath(urdfDir, meshRef);
                const filename = meshRef.split("/").pop() || meshRef;

                // Try to find matching mesh file
                for (const meshUrl of meshUrls) {
                  const meshPath = normalizePath(meshUrl.path);
                  const meshFilename = meshUrl.path.split("/").pop() || "";

                  // Check various path matches
                  if (
                    meshPath === resolvedPath ||
                    meshPath.endsWith("/" + resolvedPath) ||
                    meshFilename.toLowerCase() === filename.toLowerCase() ||
                    meshPath.toLowerCase().endsWith("/" + filename.toLowerCase())
                  ) {
                    try {
                      const meshResponse = await fetch(meshUrl.url, { headers });
                      if (meshResponse.ok) {
                        const meshBlob = await meshResponse.blob();
                        // Store with multiple path variations for compatibility
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

              // Note: We can't directly update meshFiles from Sidebar, but we've loaded them
              // The URDF will be updated and can reference these meshes if they're available
              if (Object.keys(loadedMeshes).length > 0) {
                console.log(`Loaded ${Object.keys(loadedMeshes).length} mesh file(s) for URDF`);
              }
            }

            // URDF loaded silently
          }
        } catch (error) {
          console.warn("Failed to load URDF file:", error);
          console.warn("Found URDF file but failed to load it");
        }
      }

      // Continue with parquet file loading (don't return early if parquet files are missing but URDF was found)
      console.log(`Found ${parquetUrls.length} parquet files, ${urdfUrls.length} URDF files, ${meshUrls.length} mesh files`);
      if (parquetUrls.length === 0 && urdfUrls.length === 0) {
        toast.error("No parquet files or URDF files found in dataset");
        return;
      }

      // Only process parquet files if they exist
      if (parquetUrls.length > 0) {
        // Silent loading - no intermediate toast

        // Use HF Dataset Server API to fetch data as JSON (avoids parquet parsing)
        const allRows: Array<Record<string, unknown>> = [];
        const batchSize = 100; // HF API max is 100 rows per request
        let offset = 0;
        let totalRows = 0;
        let hasMore = true;

        // First, get total row count
        const infoUrl = `https://datasets-server.huggingface.co/info?dataset=${encodeURIComponent(parsedPath)}`;
        try {
          const infoResponse = await fetch(infoUrl, { headers });
          if (infoResponse.ok) {
            const infoData = await infoResponse.json();
            // Extract total rows from dataset info
            const datasetInfo = infoData.dataset_info;
            if (datasetInfo) {
              const firstConfig = Object.keys(datasetInfo)[0];
              if (firstConfig && datasetInfo[firstConfig]?.splits?.train) {
                totalRows = datasetInfo[firstConfig].splits.train.num_examples || 0;
              }
            }
          }
        } catch (error) {
          console.warn("Could not fetch dataset info:", error);
        }

        // Silent progress - no toast for row count

        // STEP 1: Load first episode first, then open mapping dialog, then load all episodes in background
        // First, load only enough rows to complete the first episode
        let firstEpisodeIndex: number | null = null;
        let firstEpisodeComplete = false;
        const firstEpisodeRows: Array<Record<string, unknown>> = [];
        
        // Fetch first episode data
        while (hasMore && !firstEpisodeComplete) {
          try {
            const rowsUrl = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(parsedPath)}&config=default&split=train&offset=${offset}&length=${batchSize}`;
            console.log(`Fetching first episode rows ${offset} to ${offset + batchSize}...`);

            const response = await fetch(rowsUrl, { headers });
            if (!response.ok) {
              console.warn(`Failed to fetch rows at offset ${offset}: ${response.status} ${response.statusText}`);
              break;
            }

            const data = await response.json();
            const rows = data.rows || [];

            if (rows.length === 0) {
              hasMore = false;
              break;
            }

            // Extract row data and check for first episode completion
            for (const rowWrapper of rows) {
              const row = rowWrapper.row || rowWrapper;
              const episodeIndex = (row.episode_index as number) ?? 0;
              
              // Determine first episode index from first row
              if (firstEpisodeIndex === null) {
                firstEpisodeIndex = episodeIndex;
              }
              
              // If we've moved to a different episode, first episode is complete
              if (episodeIndex !== firstEpisodeIndex) {
                firstEpisodeComplete = true;
                break;
              }
              
              firstEpisodeRows.push(row);
              allRows.push(row);
            }

            console.log(`Loaded ${firstEpisodeRows.length} rows for first episode (total so far: ${allRows.length})`);

            offset += batchSize;
            hasMore = rows.length === batchSize && !firstEpisodeComplete;
          } catch (error) {
            console.error(`Error fetching rows at offset ${offset}:`, error);
            break;
          }
        }

        if (firstEpisodeRows.length === 0) {
          console.error("No rows were loaded from parquet files. Check console for details.");
          if (loadingToastId) {
            toast.dismiss(loadingToastId);
          }
          toast.error("No data found in parquet files. Check console for details.");
          setIsImportingFromHFDataset(false);
          return;
        }

        // Group first episode rows
        const firstEpisodeMap = new Map<number, Array<Record<string, unknown>>>();
        firstEpisodeMap.set(firstEpisodeIndex!, firstEpisodeRows);

        // Fetch total_episodes from meta/info.json early (before background loading starts)
        let totalEpisodesFromInfo: number | undefined = undefined;
        try {
          const infoUrl = `https://huggingface.co/datasets/${parsedPath}/raw/main/meta/info.json`;
          const infoResponse = await fetch(infoUrl, { headers });
          if (infoResponse.ok) {
            const infoJson = await infoResponse.json();
            // Extract total_episodes if available
            if (infoJson.total_episodes !== undefined) {
              totalEpisodesFromInfo = infoJson.total_episodes;
              console.log(`Found total_episodes in info.json: ${totalEpisodesFromInfo}`);
              setExpectedTotalEpisodes(totalEpisodesFromInfo);
            }
          }
        } catch (error) {
          console.warn("Could not fetch info.json for total_episodes:", error);
        }

        // STEP 2: Start loading ALL episodes in background (fire and forget)
        const loadAllEpisodesInBackground = async () => {
          const backgroundAllRows: Array<Record<string, unknown>> = [...firstEpisodeRows];
          let backgroundOffset = offset;
          // Always start as true - don't rely on hasMore flag which becomes false when first episode completes
          let backgroundHasMore = true;
          const discoveredEpisodes = new Set<number>();
          
          // Add first episode to discovered episodes
          discoveredEpisodes.add(firstEpisodeIndex!);
          setTotalEpisodesCount(1); // Start with 1 episode (the first one)
          
          console.log(`Starting background loading of all episodes from offset ${backgroundOffset}...`);
          if (totalEpisodesFromInfo) {
            console.log(`Expected total episodes: ${totalEpisodesFromInfo}`);
          }
          if (totalRows > 0) {
            console.log(`Expected total rows: ${totalRows}`);
          }
          
          while (backgroundHasMore) {
            try {
              // Check if we've loaded all expected rows
              if (totalRows > 0 && backgroundAllRows.length >= totalRows) {
                console.log(`Background loading complete: reached expected total rows (${totalRows})`);
                break;
              }
              
              // Check if we've discovered all expected episodes
              if (totalEpisodesFromInfo && discoveredEpisodes.size >= totalEpisodesFromInfo) {
                console.log(`Background loading complete: discovered all expected episodes (${totalEpisodesFromInfo})`);
                break;
              }
              
              const rowsUrl = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(parsedPath)}&config=default&split=train&offset=${backgroundOffset}&length=${batchSize}`;
              const response = await fetch(rowsUrl, { headers });
              if (!response.ok) {
                console.log(`Background loading stopped: response not ok (${response.status})`);
                break;
              }

              const data = await response.json();
              const rows = data.rows || [];
              if (rows.length === 0) {
                console.log(`Background loading complete: no more rows at offset ${backgroundOffset}`);
                break;
              }

              // Track unique episodes as we load rows
              for (const rowWrapper of rows) {
                const row = rowWrapper.row || rowWrapper;
                backgroundAllRows.push(row);
                
                const episodeIndex = (row.episode_index as number) ?? 0;
                if (!discoveredEpisodes.has(episodeIndex)) {
                  discoveredEpisodes.add(episodeIndex);
                  // Update count in real-time as we discover new episodes
                  setTotalEpisodesCount(discoveredEpisodes.size);
                }
              }

              console.log(`Background loading: loaded ${rows.length} rows (total: ${backgroundAllRows.length}, episodes: ${discoveredEpisodes.size}${totalEpisodesFromInfo ? `/${totalEpisodesFromInfo}` : ''})`);
              
              // Increment offset by actual number of rows loaded, not batchSize
              // This ensures we don't skip or duplicate rows
              backgroundOffset += rows.length;
              
              // Continue loading - only stop when we get 0 rows or reach expected totals
              // Don't stop just because we got less than a full batch (that might just be the last partial batch)
              backgroundHasMore = rows.length > 0;
            } catch (error) {
              console.error(`Error fetching background rows:`, error);
              break;
            }
          }

          console.log(`Background loading complete: ${backgroundAllRows.length} total rows, ${discoveredEpisodes.size} episodes`);

          // Group all rows by episode_index
          const backgroundEpisodesMap = new Map<number, Array<Record<string, unknown>>>();
          for (const row of backgroundAllRows) {
            const episodeIndex = (row.episode_index as number) ?? 0;
            if (!backgroundEpisodesMap.has(episodeIndex)) {
              backgroundEpisodesMap.set(episodeIndex, []);
            }
            backgroundEpisodesMap.get(episodeIndex)!.push(row);
          }

          // Mark as complete - this will enable the "Apply to Whole Dataset" button
          const totalEpisodes = backgroundEpisodesMap.size;
          setCanApplyToWholeDataset(true);
          setTotalEpisodesCount(totalEpisodes); // Final count (should match discoveredEpisodes.size)

          return { allRows: backgroundAllRows, episodesMap: backgroundEpisodesMap };
        };

        // Start background loading (don't await - fire and forget, but store promise)
        const backgroundLoadingPromise = loadAllEpisodesInBackground();
        backgroundLoadingPromiseRef.current = backgroundLoadingPromise;

        // Group rows by episode_index for first episode only
        const episodesMap = new Map<number, Array<Record<string, unknown>>>();
        episodesMap.set(firstEpisodeIndex!, firstEpisodeRows);

        // Try to fetch info.json for joint names using Dataset Server API (avoids CORS)
        let jointNames: string[] = [];
        try {
          // Use Dataset Server API which has proper CORS headers
          const infoApiUrl = `https://datasets-server.huggingface.co/info?dataset=${encodeURIComponent(parsedPath)}`;
          const infoResponse = await fetch(infoApiUrl, { headers });
          if (infoResponse.ok) {
            const infoData = await infoResponse.json();
            // Extract joint names from dataset info
            const datasetInfo = infoData.dataset_info;
            if (datasetInfo) {
              const firstConfig = Object.keys(datasetInfo)[0];
              if (firstConfig && datasetInfo[firstConfig]?.features) {
                const features = datasetInfo[firstConfig].features;
                // Look for action or observation.state feature
                const actionFeature = features.action || features["action"];
                const observationFeature = features["observation.state"];

                // Extract names from feature (structure varies by dataset)
                let rawJointNames: string[] = [];

                // Try different property paths for joint names
                if (actionFeature?.feature?.names) {
                  rawJointNames = actionFeature.feature.names;
                } else if (actionFeature?.names) {
                  rawJointNames = actionFeature.names;
                } else if (observationFeature?.feature?.names) {
                  rawJointNames = observationFeature.feature.names;
                } else if (observationFeature?.names) {
                  rawJointNames = observationFeature.names;
                }

                // Strip .pos suffix from joint names if present
                jointNames = rawJointNames.map((name: string) => {
                  if (typeof name === "string" && name.endsWith(".pos")) {
                    return name.slice(0, -4);
                  }
                  return name;
                });
                console.log("Joint names from Dataset Server API:", jointNames);
              }
            }
          }
        } catch (error) {
          console.warn("Could not fetch info from Dataset Server API:", error);
        }

        // Fallback: Try direct fetch with /raw/ endpoint for joint names if not already found
        if (jointNames.length === 0) {
          try {
            const infoUrl = `https://huggingface.co/datasets/${parsedPath}/raw/main/meta/info.json`;
            const infoResponse = await fetch(infoUrl, { headers });
            if (infoResponse.ok) {
              const infoJson = await infoResponse.json();
              const rawJointNames =
                infoJson.features?.action?.names ??
                infoJson.features?.action?.fieldNames ??
                infoJson.features?.["observation.state"]?.names ??
                infoJson.features?.["observation.state"]?.fieldNames ??
                [];

              // Strip .pos suffix from joint names if present
              jointNames = rawJointNames.map((name: string) => {
                if (typeof name === "string" && name.endsWith(".pos")) {
                  return name.slice(0, -4);
                }
                return name;
              });
              console.log("Joint names from raw info.json:", jointNames);
            }
          } catch (error) {
            console.warn("Could not fetch info.json directly:", error);
          }
        }

        console.log("Available joints in URDF:", availableJointsStore);

        // Prepare dataset joints and compute ranges from first episode only
        const firstRow = firstEpisodeRows[0];
        const sampleValues = (firstRow?.action as number[]) ?? (firstRow?.["observation.state"] as number[]) ?? [];
        
        // Determine dataset joint names - use names from info.json if available, otherwise infer from data
        const datasetJointNames = jointNames.length > 0
          ? jointNames
          : sampleValues.map((_, idx) => `joint_${idx}`);

        // Compute joint ranges from first episode only (for mapping dialog display)
        const firstEpisodeJointRanges: Record<string, { min: number; max: number }> = {};
        datasetJointNames.forEach((jointName, idx) => {
          let min = Infinity;
          let max = -Infinity;
          for (const row of firstEpisodeRows) {
            const values = (row.action as number[]) ?? (row["observation.state"] as number[]) ?? [];
            const value = values[idx];
            if (typeof value === 'number') {
              min = Math.min(min, value);
              max = Math.max(max, value);
            }
          }
          if (isFinite(min) && isFinite(max)) {
            firstEpisodeJointRanges[jointName] = { min, max };
          }
        });

        // Check for saved mapping
        const sourceName = `hf:${parsedPath}`;
        const savedMapping = getMappingForSource(sourceName);

        // Create callback for applying to first episode only
        const applyToFirstEpisodeOnly = (mappings: JointMapping[], degToRad: boolean) => {
          // Convert mappings to record format
          const jointMapping: Record<string, string> = {};
          const jointOffsets: Record<string, number> = {};
          const jointInversions: Record<string, boolean> = {};
          for (const mapping of mappings) {
            if (mapping.urdfJoint && mapping.urdfJoint !== "?") {
              jointMapping[mapping.datasetJoint] = mapping.urdfJoint;
              if (mapping.offset !== undefined) {
                jointOffsets[mapping.datasetJoint] = mapping.offset;
              }
              if (mapping.inverted !== undefined && mapping.inverted) {
                jointInversions[mapping.datasetJoint] = true;
              }
            }
          }

          // Save mapping for future use
          saveMapping(sourceName, mappings, degToRad, firstEpisodeJointRanges);

          // Check if dataset has more joints than URDF
          if (datasetJointNames.length > availableJointsStore.length) {
            if (loadingToastId) {
              toast.dismiss(loadingToastId);
            }
            toast.error(`Dataset has ${datasetJointNames.length} joints but URDF has only ${availableJointsStore.length} joints. Cannot add episodes.`);
            setIsImportingFromHFDataset(false);
            return;
          }

          console.log("Convert degrees to radians:", degToRad);
          console.log("Final joint mapping:", jointMapping);

          // Convert ONLY the first episode
          const newEpisodes: Episode[] = [];
          const degToRadConst = Math.PI / 180;

          // Process only first episode
          for (const [episodeIndex, episodeRows] of firstEpisodeMap.entries()) {
            // Sort rows by frame_index
            episodeRows.sort((a, b) => {
              const aIdx = (a.frame_index as number) ?? 0;
              const bIdx = (b.frame_index as number) ?? 0;
              return aIdx - bIdx;
            });

            // Extract frames
            const frames: RecordedFrame[] = episodeRows.map((row) => {
              const action = row.action as number[] | undefined;
              const observationState = row["observation.state"] as number[] | undefined;
              const dataArray = action ?? observationState ?? [];
              const timestamp = ((row.timestamp as number) ?? 0) * 1000; // Convert to milliseconds

              // Convert action array to joint positions object
              const actualJointNames =
                jointNames.length > 0
                  ? jointNames
                  : dataArray.map((_, i) => `joint_${i}`);

              const jointPositions: Record<string, number> = {};
              // Store joints with optional mapping to URDF names
              actualJointNames.forEach((name: string, idx: number) => {
                // Apply mapping if available, otherwise use original name
                const mappedName = jointMapping[name] || name;
                let value = dataArray[idx] ?? 0;

                // Apply offset if available
                if (jointOffsets[name] !== undefined) {
                  value = value + jointOffsets[name];
                }

                // Apply inversion if needed
                if (jointInversions[name]) {
                  value = -value;
                }

                // Convert degrees to radians if needed
                if (degToRad) {
                  value = value * degToRadConst;
                }

                if (mappedName && mappedName !== "?") {
                  jointPositions[mappedName] = value;
                }
              });

              return {
                timestamp,
                jointPositions,
              };
            });

            if (frames.length === 0) continue;

            // Calculate FPS from timestamps
            let fps = 30; // default
            if (frames.length > 1) {
              const totalDuration = frames[frames.length - 1].timestamp - frames[0].timestamp;
              if (totalDuration > 0) {
                fps = Math.round(((frames.length - 1) / totalDuration) * 1000);
              }
            }

            const episodeMetadata: EpisodeMetadata = {
              episode_index: episodeIndex,
              fps,
              joint_names: Object.keys(frames[0]?.jointPositions ?? {}),
              num_frames: frames.length,
              robot_type: "unknown",
              additional: {
                sourceType: 'hf',
                sourceName: parsedPath,
              },
            };

            const episode: Episode = {
              id: `hf-${parsedPath.replace("/", "-")}-${episodeIndex}-${Date.now()}`,
              number: episodes.length + newEpisodes.length + 1,
              frames,
              createdAt: Date.now(),
              metadata: episodeMetadata,
            };

            newEpisodes.push(episode);
          }

          if (newEpisodes.length === 0) {
            if (loadingToastId) {
              toast.dismiss(loadingToastId);
            }
            toast.error("No episodes found in dataset");
            setIsImportingFromHFDataset(false);
            return;
          }

          setEpisodes((prev) => [...prev, ...newEpisodes]);
          
          // Track source
          setDatasetSources(prev => [...prev, { type: 'hf', name: parsedPath, timestamp: Date.now() }]);

          // Dismiss loading and show success
          if (loadingToastId) {
            toast.dismiss(loadingToastId);
          }
          toast.success(
            `Loaded first episode from ${parsedPath}. Other episodes are loading in background.`,
            { duration: 3000 }
          );

          // Close dialog and reset state
          setShowHfMappingDialog(false);
          setHfMappingDialogData(null);
          setCanApplyToWholeDataset(false);
          setTotalEpisodesCount(undefined);
          backgroundLoadingPromiseRef.current = null;
          setIsImportingFromHFDataset(false);
        };

        // Create callback for applying to whole dataset
        const applyToWholeDataset = async (mappings: JointMapping[], degToRad: boolean) => {
          // Wait for background loading to complete
          const { allRows: allEpisodesRows, episodesMap: allEpisodesMap } = await backgroundLoadingPromise!;

          // Compute joint ranges from ALL episodes (for accurate processing)
          const fullDatasetJointRanges: Record<string, { min: number; max: number }> = {};
          datasetJointNames.forEach((jointName, idx) => {
            let min = Infinity;
            let max = -Infinity;
            for (const row of allEpisodesRows) {
              const values = (row.action as number[]) ?? (row["observation.state"] as number[]) ?? [];
              const value = values[idx];
              if (typeof value === 'number') {
                min = Math.min(min, value);
                max = Math.max(max, value);
              }
            }
            if (isFinite(min) && isFinite(max)) {
              fullDatasetJointRanges[jointName] = { min, max };
            }
          });

          // Convert mappings to record format
          const jointMapping: Record<string, string> = {};
          const jointOffsets: Record<string, number> = {};
          const jointInversions: Record<string, boolean> = {};
          for (const mapping of mappings) {
            if (mapping.urdfJoint && mapping.urdfJoint !== "?") {
              jointMapping[mapping.datasetJoint] = mapping.urdfJoint;
              if (mapping.offset !== undefined) {
                jointOffsets[mapping.datasetJoint] = mapping.offset;
              }
              if (mapping.inverted !== undefined && mapping.inverted) {
                jointInversions[mapping.datasetJoint] = true;
              }
            }
          }

          // Save mapping for future use (using full dataset ranges)
          saveMapping(sourceName, mappings, degToRad, fullDatasetJointRanges);

          // Check if dataset has more joints than URDF
          if (datasetJointNames.length > availableJointsStore.length) {
            if (loadingToastId) {
              toast.dismiss(loadingToastId);
            }
            toast.error(`Dataset has ${datasetJointNames.length} joints but URDF has only ${availableJointsStore.length} joints. Cannot add episodes.`);
            setIsImportingFromHFDataset(false);
            return;
          }

          console.log("Convert degrees to radians:", degToRad);
          console.log("Final joint mapping:", jointMapping);

          // Convert ALL episodes
          const newEpisodes: Episode[] = [];
          const degToRadConst = Math.PI / 180;

          // Process all episodes
          for (const [episodeIndex, episodeRows] of allEpisodesMap.entries()) {
            // Sort rows by frame_index
            episodeRows.sort((a, b) => {
              const aIdx = (a.frame_index as number) ?? 0;
              const bIdx = (b.frame_index as number) ?? 0;
              return aIdx - bIdx;
            });

            // Extract frames
            const frames: RecordedFrame[] = episodeRows.map((row) => {
              const action = row.action as number[] | undefined;
              const observationState = row["observation.state"] as number[] | undefined;
              const dataArray = action ?? observationState ?? [];
              const timestamp = ((row.timestamp as number) ?? 0) * 1000; // Convert to milliseconds

              // Convert action array to joint positions object
              const actualJointNames =
                jointNames.length > 0
                  ? jointNames
                  : dataArray.map((_, i) => `joint_${i}`);

              const jointPositions: Record<string, number> = {};
              // Store joints with optional mapping to URDF names
              actualJointNames.forEach((name: string, idx: number) => {
                // Apply mapping if available, otherwise use original name
                const mappedName = jointMapping[name] || name;
                let value = dataArray[idx] ?? 0;

                // Apply offset if available
                if (jointOffsets[name] !== undefined) {
                  value = value + jointOffsets[name];
                }

                // Apply inversion if needed
                if (jointInversions[name]) {
                  value = -value;
                }

                // Convert degrees to radians if needed
                if (degToRad) {
                  value = value * degToRadConst;
                }

                if (mappedName && mappedName !== "?") {
                  jointPositions[mappedName] = value;
                }
              });

              return {
                timestamp,
                jointPositions,
              };
            });

            if (frames.length === 0) continue;

            // Calculate FPS from timestamps
            let fps = 30; // default
            if (frames.length > 1) {
              const totalDuration = frames[frames.length - 1].timestamp - frames[0].timestamp;
              if (totalDuration > 0) {
                fps = Math.round(((frames.length - 1) / totalDuration) * 1000);
              }
            }

            const episodeMetadata: EpisodeMetadata = {
              episode_index: episodeIndex,
              fps,
              joint_names: Object.keys(frames[0]?.jointPositions ?? {}),
              num_frames: frames.length,
              robot_type: "unknown",
              additional: {
                sourceType: 'hf',
                sourceName: parsedPath,
              },
            };

            const episode: Episode = {
              id: `hf-${parsedPath.replace("/", "-")}-${episodeIndex}-${Date.now()}`,
              number: episodes.length + newEpisodes.length + 1,
              frames,
              createdAt: Date.now(),
              metadata: episodeMetadata,
            };

            newEpisodes.push(episode);
          }

          if (newEpisodes.length === 0) {
            if (loadingToastId) {
              toast.dismiss(loadingToastId);
            }
            toast.error("No episodes found in dataset");
            setIsImportingFromHFDataset(false);
            return;
          }

          setEpisodes((prev) => [...prev, ...newEpisodes]);
          
          // Track source
          setDatasetSources(prev => [...prev, { type: 'hf', name: parsedPath, timestamp: Date.now() }]);

          // Dismiss loading and show success
          if (loadingToastId) {
            toast.dismiss(loadingToastId);
          }
          toast.success(
            `Loaded ${newEpisodes.length} episode(s) from ${parsedPath}`,
            { duration: 2000 }
          );

          // Close dialog and reset state
          setShowHfMappingDialog(false);
          setHfMappingDialogData(null);
          setCanApplyToWholeDataset(false);
          setTotalEpisodesCount(undefined);
          backgroundLoadingPromiseRef.current = null;
          setIsImportingFromHFDataset(false);
        };

        // Open mapping dialog immediately with first episode data
        if (datasetJointNames.length === 0 || availableJointsStore.length === 0) {
          // No joints to map, skip dialog and process directly
          applyToFirstEpisodeOnly([], false);
        } else {
          // Store callbacks
          setApplyFirstEpisodeCallback(() => applyToFirstEpisodeOnly);
          setApplyWholeDatasetCallback(() => applyToWholeDataset);
          
          // Initialize episode count to 1 (first episode) so button appears immediately
          setTotalEpisodesCount(1);
          
          setHfMappingDialogData({
            datasetJoints: datasetJointNames,
            jointRanges: firstEpisodeJointRanges,
            source: sourceName,
            datasetPath: parsedPath,
            firstEpisodeRows,
            firstEpisodeMap,
            allEpisodesPromise: backgroundLoadingPromise,
            jointNames,
            loadingToastId,
          });
          setShowHfMappingDialog(true);
          toast.info("Loading first episode and opening mapping window. All episodes are loading in the background...", { duration: 4000 });
        }
      } else if (urdfUrls.length > 0) {
        // Only URDF was found, no parquet files
        if (loadingToastId) {
          toast.dismiss(loadingToastId);
        }
        toast.success(`Loaded URDF from ${parsedPath}`, { duration: 2000 });
      }
    } catch (error) {
      console.error("Failed to load from Hugging Face dataset:", error);
      // Dismiss loading and show error
      if (loadingToastId) {
        toast.dismiss(loadingToastId);
      }
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to load from Hugging Face dataset"
      );
    } finally {
      setIsImportingFromHFDataset(false);
    }
  }, [
    availableJointsStore,
    episodes.length,
    hfToken,
    isImportingFromHFDataset,
    onVizUrdfChange,
    setEpisodes,
  ]);

  // Expose dataset actions to parent component
  useEffect(() => {
    if (onDatasetActionsReady) {
      onDatasetActionsReady({
        loadFromLocal: () => {
          document.getElementById("motion-upload-episodes")?.click();
        },
        loadFromHuggingFace: loadEpisodesFromHuggingFaceDataset,
        exportToLocal: exportDatasetToLeRobotFormat,
        exportToHuggingFace: uploadEpisodesToHuggingFace,
        openRerunViewer: () => {
          const activeIndex = currentPlayingEpisodeIndex ?? 0;
          if (episodes.length > 0 && episodes[activeIndex]) {
            setRerunViewerModalEpisode(episodes[activeIndex]);
            setIsRerunViewerModalOpen(true);
          }
        },
        isImportingFromHF: isImportingFromHFDataset,
        isExportingDataset,
        isUploadingToHF,
        hasEpisodes: episodes.length > 0,
        isRerunViewerOpen: isRerunViewerModalOpen,
      });
    }
  }, [
    onDatasetActionsReady,
    loadEpisodesFromHuggingFaceDataset,
    exportDatasetToLeRobotFormat,
    uploadEpisodesToHuggingFace,
    isImportingFromHFDataset,
    isExportingDataset,
    isUploadingToHF,
    episodes,
    episodes.length,
    currentPlayingEpisodeIndex,
    isRerunViewerModalOpen,
  ]);

  const deleteEpisode = useCallback((episodeId: string) => {
    // Block robot movement during episode deletion
    setIsAnimating(true);
    
    // Check if the episode being deleted is currently playing
    const episodeToDelete = episodes.find((ep) => ep.id === episodeId);
    const isCurrentlyPlaying = 
      currentPlayingEpisodeIndex !== null && 
      episodes[currentPlayingEpisodeIndex]?.id === episodeId;
    const willBeEmpty = episodes.length === 1;

    // If currently playing OR if we're in the middle of sequential playback, stop everything
    if (isCurrentlyPlaying || isPlayingAllRef.current || willBeEmpty) {
      setIsPlayingAll(false);
      isPlayingAllRef.current = false;
      setPlaybackMode(null);
      setCurrentPlayingEpisodeIndex(null);
      viewerPlayback.stopAnimation();
      viewerPlayback.playAnimation(false);
      if (willBeEmpty) {
        // Reset frame to 0 when deleting the last episode
        viewerPlayback.setFrame(0);
      }
      if (isCurrentlyPlaying) {
        toast.info("Stopped playback - episode deleted");
      }
    }

    setEpisodes((prev) => {
      const filtered = prev.filter((episode) => episode.id !== episodeId);
      const renumbered = renumberEpisodes(filtered);
      
      // If we deleted the currently playing episode, clear the index
      if (isCurrentlyPlaying) {
        setCurrentPlayingEpisodeIndex(null);
      }
      
      return renumbered;
    });
    
    // Re-enable robot movement after deletion is complete
    setIsAnimating(false);
    toast.success("Episode deleted");
  }, [episodes, currentPlayingEpisodeIndex, setIsAnimating]);

  const retakeEpisode = useCallback(
    (episodeId: string) => {
      // Block robot movement during episode retake
      setIsAnimating(true);
      
      const episodeIndex = episodes.findIndex((ep) => ep.id === episodeId);
      if (episodeIndex === -1) {
        setIsAnimating(false);
        return;
      }

      const episodeNumber = episodes[episodeIndex].number;
      const existingMetadata = episodes[episodeIndex].metadata;

      setEpisodes((prev) =>
        renumberEpisodes(prev.filter((episode) => episode.id !== episodeId))
      );

      // Re-enable robot movement when starting recording
      setIsAnimating(false);
      
      beginRecording({
        episodeNumber,
        insertPosition: episodeIndex,
        metadata: existingMetadata,
      });
      toast.info(`Recording Episode ${episodeNumber} (retake)`);
    },
    [beginRecording, episodes, setEpisodes, setIsAnimating]
  );

  const moveEpisode = useCallback((episodeId: string, direction: "up" | "down") => {
    // Block robot movement during episode reordering
    setIsAnimating(true);
    
    setEpisodes((prev) => {
      const index = prev.findIndex((episode) => episode.id === episodeId);
      if (index === -1) {
        setIsAnimating(false);
        return prev;
      }

      const newIndex = direction === "up" ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prev.length) {
        setIsAnimating(false);
        return prev;
      }

      const next = [...prev];
      [next[index], next[newIndex]] = [next[newIndex], next[index]];
      
      // Re-enable robot movement after reordering
      setIsAnimating(false);
      
      return renumberEpisodes(next);
    });
  }, [setIsAnimating]);

  // Centralized function to stop all playback
  // This ensures consistent stopping behavior and prevents race conditions
  const stopAllPlayback = useCallback(() => {
    isPlayingAllRef.current = false;
    setIsPlayingAll(false);
    setPlaybackMode(null);

    viewerPlayback.stopAnimation();

    // CRITICAL: Clear the loaded episode ref so that when resuming playback,
    // setEpisodeAndFrame knows it needs to reload the episode frames
    // This prevents flickering from frame 0 → scrubbed frame
    currentLoadedEpisodeRef.current = null;

    // DO NOT reset frame to 0 - we already captured and preserved the position above
    // viewerPlayback.setFrame(0);
  }, []);

  // Complete reset of all playback state - used when all episodes finish
  // This ensures clean state after a full loop, since episodes can be added/deleted
  const resetAllPlaybackState = useCallback(() => {
    // Stop all playback first
    stopAllPlayback();
    
    // Reset all playback-related state to 0
    // Set episode index to 0 (or null if no episodes) so next playback starts from beginning
    setCurrentPlayingEpisodeIndex(episodes.length > 0 ? 0 : null);
    
    // Reset frame to 0 via callback if available
    onFrameChange?.(0);
    
    // Clear any stored frame information
    // This ensures next playback starts fresh from episode 0, frame 0
    currentLoadedEpisodeRef.current = null;
    
    // If there are episodes, set the first episode as the current one
    if (episodes.length > 0) {
      const firstEpisode = episodes[0];
      if (firstEpisode && firstEpisode.frames && firstEpisode.frames.length > 0) {
        const frames = toAnimationFrames(firstEpisode);
        viewerPlayback.playEpisode(frames, { autoplay: false, startFrame: 0 });
        onFrameChange?.(0);
      }
    }
  }, [stopAllPlayback, onFrameChange, episodes]);
  
  // Helper function to set episode and frame consistently
  // This ensures all playback operations use the same logic regardless of speed
  const setEpisodeAndFrame = useCallback((episodeIndex: number, frameIndex: number) => {
    if (episodeIndex < 0 || episodeIndex >= episodes.length) return;
    
    const episode = episodes[episodeIndex];
    if (!episode || !episode.frames || episode.frames.length === 0) return;
    
    const clampedFrame = Math.max(0, Math.min(frameIndex, episode.frames.length - 1));
    const shouldAutoplay = isPlayingAllRef.current;
    
    // Always use the same order: episode (only if different) -> frame -> update state
    // Only reload episode if it's different from what's currently loaded
    // This prevents frame resets when resuming the same episode
    // However, if frames were cleared (e.g., by stopAllPlayback), we need to reload them
    const isNewEpisode = currentLoadedEpisodeRef.current !== episodeIndex;
    const needsReload = isNewEpisode || currentLoadedEpisodeRef.current === null;
    
    if (needsReload) {
      const frames = toAnimationFrames(episode);
      viewerPlayback.playEpisode(frames, {
        autoplay: shouldAutoplay,
        startFrame: clampedFrame,
      });
      currentLoadedEpisodeRef.current = episodeIndex;
    } else {
      // Same episode - just update frame position
      viewerPlayback.setFrame(clampedFrame);
      onFrameChange?.(clampedFrame);
      if (shouldAutoplay) {
        viewerPlayback.playAnimation(true);
      }
    }
    
    setCurrentPlayingEpisodeIndex(episodeIndex);
  }, [episodes, onFrameChange]);

  const playEpisode = useCallback(
    (episode: Episode) => {
      if (!episode || !episode.frames || episode.frames.length === 0) {
        toast.error("Episode has no frames or no longer exists");
        stopAllPlayback();
        return;
      }

      const episodeIndex = episodes.findIndex((ep) => ep.id === episode.id);
      if (episodeIndex === -1) {
        toast.info("Episode no longer exists - stopping playback");
        stopAllPlayback();
        return;
      }

      const isCurrentlyPlaying =
        currentPlayingEpisodeIndex === episodeIndex && isPlayingAll;

      if (isCurrentlyPlaying) {
        setIsPlayingAll(false);
        isPlayingAllRef.current = false;
        viewerPlayback.stopAnimation();
        return;
      }

      onViewerSplitViewChange?.(true);
      onViewerOpenChange?.(true);
      onViewerEpisodeChange?.(episode);

      setPlaybackMode("single");
      setIsPlayingAll(true);
      isPlayingAllRef.current = true;

      setEpisodeAndFrame(episodeIndex, 0);
    },
    [
      currentPlayingEpisodeIndex,
      episodes,
      isPlayingAll,
      onViewerOpenChange,
      onViewerEpisodeChange,
      onViewerSplitViewChange,
      setEpisodeAndFrame,
      stopAllPlayback,
    ]
  );

  const playAllEpisodes = useCallback((overrideFrame?: number) => {
    if (episodes.length === 0) {
      toast.error('No episodes to play');
      return;
    }

    if (isPlayingAll) {
      stopAllPlayback();
      return;
    }

    setPlaybackMode("all");
    setIsPlayingAll(true);
    isPlayingAllRef.current = true;

    const startIndex =
      currentPlayingEpisodeIndex !== null ? currentPlayingEpisodeIndex : 0;
    const startFrame =
      overrideFrame !== undefined ? overrideFrame : (currentFrame ?? 0);

    setEpisodeAndFrame(startIndex, startFrame);
  }, [
    currentFrame,
    currentPlayingEpisodeIndex,
    episodes,
    isPlayingAll,
    setEpisodeAndFrame,
    stopAllPlayback,
  ]);

  useEffect(() => {
    const wasPlaying = previousViewerPlayingRef.current;
    previousViewerPlayingRef.current = isPlaying;

    if (!wasPlaying || isPlaying) {
      return;
    }
    if (!isPlayingAllRef.current) {
      return;
    }

    const action = getPlaybackEndAction({
      mode: playbackMode,
      currentFrame: currentFrame ?? 0,
      totalFrames: totalFrames ?? 0,
      currentEpisodeIndex: currentPlayingEpisodeIndex,
      episodes,
    });

    if (action.type === "advance") {
      setPlaybackMode("all");
      setIsPlayingAll(true);
      isPlayingAllRef.current = true;
      setEpisodeAndFrame(action.nextIndex, 0);
      return;
    }

    if (action.type === "stop") {
      stopAllPlayback();
    }
  }, [
    currentFrame,
    currentPlayingEpisodeIndex,
    episodes,
    isPlaying,
    playbackMode,
    setEpisodeAndFrame,
    stopAllPlayback,
    totalFrames,
  ]);

  // Cleanup recording interval on unmount
  useEffect(() => {
    return () => {
      clearRecordingInterval();
    };
  }, [clearRecordingInterval]);

  return (
    <div
      className="sidebar-panel flex flex-col fixed left-0 bg-[hsl(var(--sidebar-bg))] transition-transform duration-200 ease-out shadow-xl z-30"
      style={{
        width,
        minWidth: SIDEBAR_MIN_WIDTH,
        top: "28px",
        height: "calc(100vh - 28px)",
        transform: isCollapsed ? "translateX(-100%)" : undefined,
        pointerEvents: isCollapsed ? "none" : "auto",
      }}
      aria-hidden={isCollapsed}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        {isLoading && (
          <div className="flex-shrink-0 border-b border-border/30">
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span>Loading robot model...</span>
              </div>
            </div>
          </div>
        )}

        {/* Top Section - Recording Controls (shrinks when episode viewer grows) */}
        <div
          className="overflow-hidden flex flex-col p-1.5 border-b border-border/20"
          style={{
            flex: `0 0 ${((1 - (episodesViewHeight ?? 0.4)) * 100)}%`,
            minHeight: '50px'
          }}
        >
          <div className="flex-1 overflow-y-auto blender-scrollbar">
            {/* Blender-style Menu Bar */}
            <div className="flex items-center gap-1.5 border-b border-border/50 pb-1 mb-1.5">
              {/* Record Button - Always Visible */}
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs flex-shrink-0 border-red-500/50 text-red-500 hover:bg-red-500/10 hover:border-red-500"
                    onClick={isRecording ? stopRecording : startRecording}
                  >
                    <div className="flex items-center gap-1.5">
                      <Circle className={`w-3 h-3 fill-current ${isRecording ? 'animate-pulse' : ''}`} />
                      <span>{isRecording ? "Stop" : "Record"}</span>
                    </div>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-medium">{isRecording ? "Stop Recording" : "Start Recording"}</p>
                  <p className="text-muted-foreground">
                    {isRecording 
                      ? "Stop recording the current episode" 
                      : "Record a new episode by moving the robot"}
                  </p>
                </TooltipContent>
              </Tooltip>

              {/* Recording Stats - Always Reserved Space */}
              <div className="flex items-center gap-1.5 text-[10px] font-mono min-w-[60px]">
                {isRecording ? (
                  <>
                    <span className="text-muted-foreground">{recordingStats.frames}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-muted-foreground">{recordingStats.seconds.toFixed(1)}s</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground/40">0</span>
                    <span className="text-muted-foreground/40">/</span>
                    <span className="text-muted-foreground/40">0.0s</span>
                  </>
                )}
              </div>

              {/* FPS Input */}
              <div className="flex items-center gap-1">
                <label className="text-[10px] text-muted-foreground whitespace-nowrap">FPS:</label>
                <NumberInput
                  value={recordingFps}
                  onValueChange={setRecordingFps}
                  min={1}
                  max={120}
                  step={1}
                  compact={true}
                  disabled={isRecording}
                  className="w-14"
                />
              </div>

              {/* Hidden file input for dataset loading - triggered from top menu */}
              <input
                type="file"
                id="motion-upload-episodes"
                accept=".json,.csv,.pos"
                multiple
                {...({
                  webkitdirectory: "",
                  directory: "",
                  mozdirectory: "",
                } as React.InputHTMLAttributes<HTMLInputElement>)}
                onChange={(e) => {
                  void handleFileUpload(e.target.files);
                  e.target.value = "";
                }}
                className="hidden"
              />
            </div>

            {/* Blender-style Timeline Controls */}
            <BlenderPanel title="Timeline" defaultOpen={true}>
              {/* Playback and Speed on same row */}
              <div className="flex items-center gap-1.5 mb-1">
                {/* Previous Episode */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => {
                    if (episodes.length === 0) return;
                    const currentIndex = currentPlayingEpisodeIndex ?? 0;
                    const prevIndex = currentIndex > 0 ? currentIndex - 1 : episodes.length - 1;
                    setEpisodeAndFrame(prevIndex, 0);
                    setCurrentPlayingEpisodeIndex(prevIndex);
                  }}
                  disabled={episodes.length === 0}
                  title="Previous Episode"
                >
                  <SkipBack className="w-3 h-3" />
                </Button>

                {/* Play/Pause */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => playAllEpisodes()}
                  disabled={episodes.length === 0}
                  title={isPlayingAll ? "Pause" : "Play"}
                >
                  {isPlayingAll ? (
                    <Pause className="w-3 h-3" />
                  ) : (
                    <Play className="w-3 h-3 fill-current" />
                  )}
                </Button>

                {/* Next Episode */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => {
                    if (episodes.length === 0) return;
                    // ALWAYS stop playback first (equivalent to clicking stop)
                    stopAllPlayback();
                    
                    // Then move to next episode starting at frame 0
                    const currentIndex = currentPlayingEpisodeIndex ?? 0;
                    const nextIndex = (currentIndex + 1) % episodes.length;
                    
                    // Always start from frame 0 when moving to next episode
                    setEpisodeAndFrame(nextIndex, 0);
                    setCurrentPlayingEpisodeIndex(nextIndex);
                    // Update frame callback to ensure UI reflects frame 0
                    onFrameChange?.(0);
                  }}
                  disabled={episodes.length === 0}
                  title="Next Episode"
                >
                  <SkipForward className="w-3 h-3" />
                </Button>

                {/* Speed Control - Blender style (Number Input) */}
                <div className="flex items-center gap-1.5 flex-1">
                  <label className="text-[10px] text-muted-foreground whitespace-nowrap">Speed:</label>
                  <NumberInput
                    value={playbackSpeed}
                    onValueChange={(value) => {
                      const newSpeed = value ?? 1.0;
                      setPlaybackSpeed(newSpeed);
                    }}
                    min={0.25}
                    max={6}
                    step={0.25}
                    compact={true}
                    className="w-16"
                  />
                  <span className="text-[10px] font-mono text-foreground tabular-nums">
                    x{playbackSpeed % 1 === 0 ? playbackSpeed.toFixed(0) : playbackSpeed.toFixed(2)}
                  </span>
                </div>
              </div>
            </BlenderPanel>

            {/* Episodes List */}
            <BlenderPanel title={`Episodes (${episodes.length})`} defaultOpen={true}>
              <div className="flex-1 overflow-y-auto max-h-[400px] blender-scrollbar -mx-1.5">
                {episodes.length === 0 ? (
                  <div className="py-2 text-center">
                    <p className="text-xs text-muted-foreground">No episodes</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Load JSON data or record new</p>
                  </div>
                ) : (
                  <div className="space-y-0">
                    {episodes.map((episode, index) => {
                      const duration = episode.frames.length > 0 
                        ? episode.frames[episode.frames.length - 1].timestamp 
                        : 0;
                      const durationSeconds = (duration / 1000).toFixed(1);
                      const isPlaying = currentPlayingEpisodeIndex === index && isPlayingAll;
                      // Get current frame for this episode - show currentFrame if it's the currently active episode (regardless of playing state)
                      // Frames start at 0
                      const episodeCurrentFrame = (currentPlayingEpisodeIndex === index && currentFrame !== undefined) 
                        ? currentFrame 
                        : 0;
                      const totalFrames = episode.frames.length;
                      const sourceTypeRaw = episode.metadata?.additional?.sourceType;
                      const sourceType = typeof sourceTypeRaw === "string" ? sourceTypeRaw : undefined;
                      const sourceNameRaw = episode.metadata?.additional?.sourceName;
                      const sourceName = typeof sourceNameRaw === "string" ? sourceNameRaw : undefined;
                        
                        return (
                          <div
                            key={episode.id}
                            className={cn(
                              "group relative border rounded px-0.25 py-0.5 transition-all",
                              isPlaying
                                ? "border-primary shadow-lg shadow-primary/20 bg-primary/5"
                                : "border-border bg-background hover:bg-muted/30"
                            )}
                          >
                            {/* Main Row */}
                            <div className="flex items-start gap-1">
                              {/* Play/Pause Button - Prominent like Blender's video strips */}
                              <Button
                                size="sm"
                                variant={isPlaying ? "default" : "ghost"}
                                className={cn(
                                  "h-6 w-6 p-0 flex-shrink-0 mt-0.5",
                                  isPlaying && "bg-primary hover:bg-primary/90"
                                )}
                                onClick={() => {
                                  playEpisode(episode);
                                }}
                                title={isPlaying ? "Pause" : "Play"}
                              >
                                {isPlaying ? (
                                  <Pause className="w-3 h-3" />
                                ) : (
                                  <Play className="w-3 h-3 fill-current" />
                                )}
                              </Button>
                              
                              {/* Episode Number */}
                              <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <span className="text-[10px] font-bold text-primary">
                                  {episode.number}
                                </span>
                              </div>
                              
                              {/* Episode Info - Blender Style */}
                              <div className="flex-1 min-w-0">
                                {/* First Row: Stats */}
                                <div className="flex items-center gap-1 mb-0.5">
                                  <span className="text-xs font-medium text-foreground">
                                    {episode.frames.length} frames
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">•</span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {durationSeconds}s
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">•</span>
                                  {/* Frame Counter - Highlighted when playing */}
                                  <span className={`text-[10px] font-mono tabular-nums ${
                                    currentPlayingEpisodeIndex === index && isPlayingAll
                                      ? "text-primary font-semibold"
                                      : "text-muted-foreground"
                                  }`}>
                                    {episodeCurrentFrame}/{totalFrames}
                                  </span>
                                </div>
                                
                                {/* Second Row: Source Info */}
                                {sourceType && (
                                  <div className="flex items-center gap-1">
                                    <Badge
                                      variant={
                                        sourceType === 'hf'
                                          ? 'default'
                                          : sourceType === 'local'
                                          ? 'secondary'
                                          : 'outline'
                                      }
                                      className="text-[9px] px-1.5 py-0 h-3.5 font-medium"
                                    >
                                      {sourceType === 'hf'
                                        ? 'HF'
                                        : sourceType === 'local'
                                        ? 'Local'
                                        : sourceType === 'recorded'
                                        ? 'REC'
                                        : sourceType}
                                    </Badge>
                                    {sourceName && (
                                      <span className="text-[10px] text-muted-foreground truncate" title={sourceName}>
                                        {sourceName}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>

                            </div>
                          
                            {/* Compact Controls - All Actions Together */}
                            <div className="flex items-center gap-0.5 mt-1 pt-0.5 border-t border-border/30 opacity-40 group-hover:opacity-100 transition-opacity">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 px-1 text-[10px] text-muted-foreground/60 hover:text-foreground"
                                onClick={() => moveEpisode(episode.id, 'up')}
                                disabled={index === 0}
                                title="Move up"
                              >
                                <ArrowUp className="w-2.5 h-2.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 px-1 text-[10px] text-muted-foreground/60 hover:text-foreground"
                                onClick={() => moveEpisode(episode.id, 'down')}
                                disabled={index === episodes.length - 1}
                                title="Move down"
                              >
                                <ArrowDown className="w-2.5 h-2.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 px-1 text-[10px] text-muted-foreground/60 hover:text-foreground"
                                onClick={() => retakeEpisode(episode.id)}
                                disabled={isRecording}
                                title="Retake"
                              >
                                <RotateCcw className="w-2.5 h-2.5 mr-0.5" />
                                Retake
                              </Button>
                              <div className="flex-1" />
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0 text-muted-foreground/60 hover:text-foreground"
                                onClick={() => exportEpisodeToDataFile(episode)}
                                title="Export"
                              >
                                <Download className="w-2.5 h-2.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0 text-muted-foreground/60 hover:text-foreground"
                                onClick={() => deleteEpisode(episode.id)}
                                disabled={isRecording}
                                title="Delete"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </Button>
                            </div>
                          </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </BlenderPanel>
          </div>

          {/* Collapse Button at Bottom of Top Section */}
          {onToggleCollapse && (
            <div className="flex-shrink-0 border-t border-border/30 flex items-center justify-center p-1.5">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={onToggleCollapse}
                aria-label={isCollapsed ? "Expand panel" : "Collapse panel"}
                title={isCollapsed ? "Show sidebar" : "Hide sidebar"}
              >
                {isCollapsed ? (
                  <ChevronsRight className="w-4 h-4" />
                ) : (
                  <ChevronsLeft className="w-4 h-4" />
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Horizontal Resizer */}
        {onEpisodesResizeStart && (
          <div
            onPointerDown={onEpisodesResizeStart}
            className="cursor-row-resize select-none bg-border/30 hover:bg-border/60 transition-colors relative group flex-shrink-0 z-10"
            style={{ height: 4 }}
            aria-label="Resize episodes view"
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-12 h-0.5 bg-border/40 group-hover:bg-border/80 transition-colors rounded-full" />
            </div>
          </div>
        )}

        {/* Bottom Section - Matches episode viewer height */}
        <div
          className="overflow-hidden flex flex-col bg-background"
          style={{
            flex: `0 0 ${((episodesViewHeight ?? 0.4) * 100)}%`,
            minHeight: '160px'
          }}
        >
          <div className="flex-1 min-h-0 flex flex-col gap-2 p-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-foreground">Episode camera monitor</span>
                <span className="text-[11px] text-muted-foreground">Fixed frame; image updates during playback.</span>
              </div>
              <Select
                value={episodePreviewCameraId ?? undefined}
                onValueChange={(value) => setEpisodePreviewCameraId(value)}
                disabled={cameras.length === 0}
              >
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue placeholder="Choose camera" />
                </SelectTrigger>
                <SelectContent>
                  {cameras.map((cam) => (
                    <SelectItem key={cam.id} value={cam.id}>
                      {cam.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-h-[160px]">
              <EpisodeCameraPreview
                urdfContent={vizUrdf || originalUrdf || null}
                meshFiles={meshFiles}
                cameraId={episodePreviewCameraId}
                gpuMode="low"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Rerun Viewer Modal */}
      <RerunViewer3DModal
        episode={rerunViewerModalEpisode}
        open={isRerunViewerModalOpen}
        onOpenChange={setIsRerunViewerModalOpen}
        urdfContent={vizUrdf || originalUrdf}
      />

      {/* Hugging Face Mapping Dialog */}
      {hfMappingDialogData && (
        <JointMappingDialog
          isOpen={showHfMappingDialog}
          onClose={() => {
            const toastId = hfMappingDialogData?.loadingToastId;
            setShowHfMappingDialog(false);
            setHfMappingDialogData(null);
            setCanApplyToWholeDataset(false);
            setTotalEpisodesCount(undefined);
            setExpectedTotalEpisodes(undefined);
            backgroundLoadingPromiseRef.current = null;
            setApplyFirstEpisodeCallback(null);
            setApplyWholeDatasetCallback(null);
            if (toastId) {
              toast.dismiss(toastId);
            }
            setIsImportingFromHFDataset(false);
          }}
          datasetJoints={hfMappingDialogData.datasetJoints}
          urdfJoints={availableJointsStore}
          jointRanges={hfMappingDialogData.jointRanges}
          existingMapping={getMappingForSource(hfMappingDialogData.source)}
          source={hfMappingDialogData.source}
          datasetPath={hfMappingDialogData.datasetPath}
          jointLimits={jointLimits}
          onApply={(mappings, degToRad) => {
            // Fallback to default apply if callbacks not set
            if (applyFirstEpisodeCallback) {
              applyFirstEpisodeCallback(mappings, degToRad);
            }
          }}
          showTwoButtons={true}
          onApplyFirstEpisode={applyFirstEpisodeCallback || undefined}
          onApplyToWholeDataset={applyWholeDatasetCallback || undefined}
          canApplyToWholeDataset={canApplyToWholeDataset}
          totalEpisodesCount={totalEpisodesCount}
          expectedTotalEpisodes={expectedTotalEpisodes}
        />
      )}

    </div>
  );
};
