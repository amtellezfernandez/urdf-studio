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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { NumberInput } from "@/components/ui/number-input";
import { Square, Download, GitCompare, RotateCw, Settings, Sliders, Upload, Play, GripVertical, ArrowUp, ArrowDown, Trash2, RotateCcw, List, Gauge, SkipBack, SkipForward, StepBack, StepForward, ChevronsLeft, ChevronsRight, Send, Eye, Circle, FolderOpen, Pause } from "lucide-react";
import { useJointStore } from "@/store/useJointStore";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { toast } from "sonner";
import type { JointLimits } from "@/urdf_corrections/parseJointLimits";
import type { JointAxisMap } from "@/urdf_corrections/parseJointAxis";
import { URDFComparison } from "@/components/URDFComparison";
import { JointsWindow } from "@/components/JointsWindow";
import { LinkEditor, type CollisionVisibility } from "@/components/LinkEditor";
import { BlenderPanel, BlenderPropertyRow } from "@/components/ui/blender-panel";
import { parseEpisodeCsv } from "@/utils/episodeCsv";
import {
  parseEpisodeJson,
  serializeEpisodeJson,
  serializeEpisodeCollectionJson,
  type EpisodeJsonEpisode,
} from "@/utils/episodeFormat";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EpisodeViewer3DModal } from "@/components/EpisodeViewer3DModal";

export const DEFAULT_SIDEBAR_WIDTH = 420;
export const SIDEBAR_MIN_WIDTH = 320;
export const SIDEBAR_MAX_WIDTH = 620;

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
  onRotateRobot?: (axis: "x" | "y" | "z") => void;
  onResetRotation?: () => void;
  hasRotationChanges?: boolean;
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
}

interface RecordedFrame {
  timestamp: number;
  jointPositions: Record<string, number>;
}

import type { EpisodeMetadata } from "@/utils/episodeTypes";

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

const getEpisodeDurationMs = (episode: Episode) =>
  episode.frames.length > 0
    ? episode.frames[episode.frames.length - 1].timestamp
    : DEFAULT_PLAYBACK_DURATION_MS;

const findNextPlayableEpisodeIndex = (
  episodes: Episode[],
  startIndex: number
) => {
  if (episodes.length === 0) return null;
  const normalizedStart =
    ((startIndex % episodes.length) + episodes.length) % episodes.length;
  for (let offset = 0; offset < episodes.length; offset += 1) {
    const candidate = (normalizedStart + offset) % episodes.length;
    if (episodes[candidate]?.frames.length > 0) {
      return candidate;
    }
  }
  return null;
};

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
): Record<string, any> => {
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
const PLAYBACK_GAP_MS = 100;
const DEFAULT_PLAYBACK_DURATION_MS = 1000;

const sanitizeFilename = (name: string) => {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
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
}: SidebarProps) => {
  const [rotationAxis, setRotationAxis] = useState<"x" | "y" | "z">("z");
  const [angleUnit, setAngleUnit] = useState<"rad" | "deg">("rad");
  const [showComparison, setShowComparison] = useState(false);
  const [collisionVisibility, setCollisionVisibility] = useState<CollisionVisibility>({});

  // Notify parent when collision visibility changes
  useEffect(() => {
    onCollisionVisibilityChange?.(collisionVisibility);
  }, [collisionVisibility, onCollisionVisibilityChange]);

  const storeJointValues = useJointStore((s) => s.jointValues);
  const setStoreJointValue = useJointStore((s) => s.setJointValue);
  const availableJointsStore = useJointStore((s) => s.availableJoints);
  const velocityLimitEnabled = useJointStore((s) => s.velocityLimitEnabled);
  const setVelocityLimitEnabled = useJointStore((s) => s.setVelocityLimitEnabled);
  const globalMaxJointVelocity = useJointStore((s) => s.globalMaxJointVelocity);
  const setGlobalMaxJointVelocity = useJointStore((s) => s.setGlobalMaxJointVelocity);
  const applyGlobalVelocityToAll = useJointStore((s) => s.applyGlobalVelocityToAll);
  const previewJointValue = useJointStore((s) => s.previewJointValue);

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
    async (token: string) => {
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
      const data = await response.json();
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
  const [currentPlayingEpisodeIndex, setCurrentPlayingEpisodeIndex] = useState<number | null>(null);
  const [playbackMode, setPlaybackMode] = useState<"loop" | "sequential">("sequential"); // "loop" = play 1 episode in loop, "sequential" = play all episodes one by one
  const playbackModeRef = useRef<"loop" | "sequential">("sequential"); // Ref to track current playback mode
  const [recordingFps, setRecordingFps] = useState<number>(30); // Default FPS for recording
  const hfIdentityRef = useRef<{ name: string; fullname?: string } | null>(null);
  const recordingStartTime = useRef<number>(0);
  const recordingIntervalRef = useRef<number | null>(null);
  const playbackTimeoutRef = useRef<number | null>(null);
  const isPlayingAllRef = useRef<boolean>(false);
  const currentLoadedEpisodeRef = useRef<number | null>(null); // Track which episode is currently loaded in Viewer3D
  const episodeTransitionScheduledRef = useRef<boolean>(false); // Track if we've already scheduled transition to next episode
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0); // 1.0 = normal speed
  const [viewerModalEpisode, setViewerModalEpisode] = useState<Episode | null>(null);
  const [isViewerModalOpen, setIsViewerModalOpen] = useState(false);

  // Keep playbackModeRef in sync with playbackMode state
  useEffect(() => {
    playbackModeRef.current = playbackMode;
  }, [playbackMode]);

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
    if (isViewerModalOpen && currentPlayingEpisodeIndex !== null && episodes.length > 0) {
      const currentEpisode = episodes[currentPlayingEpisodeIndex];
      if (currentEpisode && currentEpisode.id !== viewerModalEpisode?.id) {
        setViewerModalEpisode(currentEpisode);
      }
    }
  }, [currentPlayingEpisodeIndex, isViewerModalOpen, episodes, viewerModalEpisode?.id]);

  // Stop animation when all episodes are deleted
  useEffect(() => {
    if (episodes.length === 0) {
      // Stop all playback
      setIsPlayingAll(false);
      isPlayingAllRef.current = false;
      setCurrentPlayingEpisodeIndex(null);
      currentLoadedEpisodeRef.current = null;
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = null;
      }
      // Stop 3D viewer animation
      (window as any).viewer3dStopAnimation?.();
      (window as any).viewer3dPlayAnimation?.(false);
      // Reset frame to 0
      (window as any).viewer3dSetFrame?.(0);
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

  const degPerRad = 180 / Math.PI;
  const toDisplayVelocity = (radValue: number) =>
    angleUnit === "deg" ? radValue * degPerRad : radValue;
  const fromDisplayVelocity = (value: number) =>
    angleUnit === "deg" ? value / degPerRad : value;

  const defaultSliderMinRad = 0.01;
  const defaultSliderMaxRad = 4 * Math.PI; // ~12.57 rad (~720 deg/s)
  const sliderMin = angleUnit === "deg" ? defaultSliderMinRad * degPerRad : defaultSliderMinRad;
  const sliderMaxBase =
    angleUnit === "deg" ? defaultSliderMaxRad * degPerRad : defaultSliderMaxRad;
  const sliderStep = angleUnit === "deg" ? 0.5 : 0.05;

  const displayVelocity = toDisplayVelocity(globalMaxJointVelocity);
  const sliderMax = Math.max(sliderMaxBase, displayVelocity, sliderMin);
  const sliderValue = Math.min(Math.max(displayVelocity, sliderMin), sliderMax);

  const handleMaterialChange = (linkName: string, materialName: string, color: string) => {
    if (!vizUrdf) return;
    
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(vizUrdf, "text/xml");
      
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        toast.error("Invalid URDF XML");
        return;
      }

      // Find or create material element
      let material = xmlDoc.querySelector(`material[name="${materialName}"]`);
      if (!material) {
        // Create material in robot tag
        const robot = xmlDoc.querySelector("robot");
        if (!robot) {
          toast.error("No robot tag found in URDF");
          return;
        }
        material = xmlDoc.createElement("material");
        material.setAttribute("name", materialName);
        const colorElement = xmlDoc.createElement("color");
        // Convert hex to rgba
        const r = parseInt(color.slice(1, 3), 16) / 255;
        const g = parseInt(color.slice(3, 5), 16) / 255;
        const b = parseInt(color.slice(5, 7), 16) / 255;
        colorElement.setAttribute("rgba", `${r} ${g} ${b} 1.0`);
        material.appendChild(colorElement);
        robot.appendChild(material);
      } else {
        // Update existing material color
        let colorElement = material.querySelector("color");
        if (!colorElement) {
          colorElement = xmlDoc.createElement("color");
          material.appendChild(colorElement);
        }
        const r = parseInt(color.slice(1, 3), 16) / 255;
        const g = parseInt(color.slice(3, 5), 16) / 255;
        const b = parseInt(color.slice(5, 7), 16) / 255;
        colorElement.setAttribute("rgba", `${r} ${g} ${b} 1.0`);
      }

      // Find the link
      const link = xmlDoc.querySelector(`link[name="${linkName}"]`);
      if (!link) {
        toast.error(`Link "${linkName}" not found`);
        return;
      }

      // Find or create visual element
      let visual = link.querySelector("visual");
      if (!visual) {
        visual = xmlDoc.createElement("visual");
        const geometry = xmlDoc.createElement("geometry");
        const box = xmlDoc.createElement("box");
        box.setAttribute("size", "0.1 0.1 0.1");
        geometry.appendChild(box);
        visual.appendChild(geometry);
        link.appendChild(visual);
      }

      // Add or update material reference
      let materialRef = visual.querySelector("material");
      if (!materialRef) {
        materialRef = xmlDoc.createElement("material");
        visual.appendChild(materialRef);
      }
      materialRef.setAttribute("name", materialName);

      // Serialize back
      const serializer = new XMLSerializer();
      const newContent = serializer.serializeToString(xmlDoc);
      
      onVizUrdfChange?.(newContent);
    } catch (error) {
      console.error("Error updating material:", error);
      toast.error("Failed to update material");
    }
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
    (window as any).viewer3dStopAnimation?.();
    setIsPlayingAll(false);
    isPlayingAllRef.current = false;
    setCurrentPlayingEpisodeIndex(null);
    
    // Clear any playback timeout
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    
    // Reset frame counters to beginning
    (window as any).viewer3dSetFrame?.(0);
    onFrameChange?.(0);
    
    // Start recording
    beginRecording({ fps: recordingFps });
    toast.success(`Started recording episode at ${recordingFps} FPS`);
  }, [beginRecording, recordingFps, onFrameChange]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    clearRecordingInterval();

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
    toast.success(
      `Stopped recording. Episode ${recordedEpisodeNumber} saved with ${framesToPersist.length} frames`
    );
  }, [clearRecordingInterval, currentRecordingEpisodeId, episodes.length, setEpisodes]);

  const loadEpisodesFromDataFile = useCallback(
    async (file: File, options?: { suppressToast?: boolean }) => {
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

                const episodeSummariesMap = new Map<number, any>();
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
                  const tasks = summary?.tasks ?? [];
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

      let identity: any = null;
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
  }, [episodes, robotBaseName, robotName, getJointOrderForFrames, availableJointsStore]);

  const loadEpisodesFromHuggingFace = useCallback(async () => {
    if (isImportingFromHF) return;

    setIsImportingFromHF(true);
    try {
      const token = await ensureHfToken();
      if (token === null) return;

      let identity: any = null;
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
    try {
      // Prompt for dataset path
      const datasetPath = window
        .prompt(
          "Enter the Hugging Face dataset path (e.g., amtellezfernandez/robot-learning-tutorial-data).\nYou can paste a full URL.",
          ""
        )
        ?.trim();

      if (!datasetPath) {
        toast.info("Cancelled loading from Hugging Face dataset");
        return;
      }

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
        toast.error("Dataset path must be in format: owner/dataset-name");
        return;
      }

      toast.info(`Fetching dataset info from ${parsedPath}...`);

      const headers: Record<string, string> = { Accept: "application/json" };
      if (hfToken) {
        headers.Authorization = `Bearer ${hfToken}`;
      }

      // Fetch the repository file tree to find parquet files
      const treeUrl = `https://huggingface.co/api/datasets/${parsedPath}/tree/main`;
      const treeResponse = await fetch(treeUrl, { headers });

      if (!treeResponse.ok) {
        if (treeResponse.status === 404) {
          toast.error(`Dataset ${parsedPath} not found or not accessible`);
        } else if (treeResponse.status === 401 || treeResponse.status === 403) {
          toast.error("Dataset requires authentication. Please set your HF token first.");
        } else {
          const errorText = await treeResponse.text();
          toast.error(errorText || "Failed to fetch dataset info");
        }
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
        toast.info(`Found ${urdfUrls.length} URDF file(s). Loading...`);
        
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
                let path = meshRef
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

            toast.success(`Loaded URDF file: ${urdfToLoad.path.split("/").pop()}`);
          }
        } catch (error) {
          console.warn("Failed to load URDF file:", error);
          toast.warning("Found URDF file but failed to load it");
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
        toast.info(`Found ${parquetUrls.length} parquet file(s). Fetching data via HF Dataset Server API...`);

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

        if (totalRows > 0) {
          toast.info(`Dataset has ${totalRows} rows. Fetching...`);
        }

        // Fetch data in batches
        while (hasMore) {
          try {
            const rowsUrl = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(parsedPath)}&config=default&split=train&offset=${offset}&length=${batchSize}`;
            console.log(`Fetching rows ${offset} to ${offset + batchSize}...`);

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

            // Extract row data from the response
            for (const rowWrapper of rows) {
              const row = rowWrapper.row || rowWrapper;
              allRows.push(row);
            }

            console.log(`Loaded ${rows.length} rows (total: ${allRows.length})`);

            // Update progress
            if (totalRows > 0 && allRows.length % 500 === 0) {
              toast.info(`Loading... ${allRows.length}/${totalRows} rows`);
            }

            offset += batchSize;
            hasMore = rows.length === batchSize;
          } catch (error) {
            console.error(`Error fetching rows at offset ${offset}:`, error);
            break;
          }
        }

        console.log(`Total rows loaded: ${allRows.length}`);
        if (allRows.length === 0) {
          console.error("No rows were loaded from parquet files. Check console for details.");
          toast.error("No data found in parquet files. Check console for details.");
          return;
        }

        toast.info(`Loaded ${allRows.length} rows. Processing episodes...`);

        // Group rows by episode_index
        const episodesMap = new Map<number, Array<Record<string, unknown>>>();
        for (const row of allRows) {
          const episodeIndex = (row.episode_index as number) ?? 0;
          if (!episodesMap.has(episodeIndex)) {
            episodesMap.set(episodeIndex, []);
          }
          episodesMap.get(episodeIndex)!.push(row);
        }

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

        // Fallback: Try direct fetch with /raw/ endpoint (less likely to have CORS issues)
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

        // Always show mapping dialog to allow user to configure mapping and unit conversion
        let jointMapping: Record<string, string> = {};
        let convertDegreesToRadians = false;

        if (jointNames.length > 0 || availableJointsStore.length > 0) {
          // Check if values look like degrees (absolute values > π ≈ 3.14)
          const firstRow = allRows[0];
          const sampleValues = (firstRow?.action as number[]) ?? (firstRow?.["observation.state"] as number[]) ?? [];
          const maxAbsValue = Math.max(...sampleValues.map(Math.abs));
          const likelyDegrees = maxAbsValue > 10; // If max value > 10, probably degrees

          // Build detailed mapping showing index, name, and value for each
          const datasetJointsInfo = jointNames.length > 0
            ? jointNames.map((name, idx) => `[${idx}] ${name} = ${sampleValues[idx]?.toFixed(2) ?? "?"}`).join("\n")
            : sampleValues.map((val, idx) => `[${idx}] joint_${idx} = ${val.toFixed(2)}`).join("\n");

          const urdfJointsInfo = availableJointsStore.map((name, idx) => `[${idx}] ${name}`).join("\n");

          // Build default mapping - map by index position
          const defaultMapping = jointNames.length > 0
            ? jointNames.map((name) => `${name}=${availableJointsStore.includes(name) ? name : "?"}`).join(",")
            : sampleValues.map((_, idx) => `joint_${idx}=${availableJointsStore[idx] ?? "?"}`).join(",");

          const mappingPrompt = `JOINT MAPPING CONFIGURATION\n\n` +
            `Dataset joints (index, name, sample value):\n${datasetJointsInfo}\n\n` +
            `URDF joints (index, name):\n${urdfJointsInfo}\n\n` +
            `${likelyDegrees ? "⚠️ Values appear to be in DEGREES" : "✓ Values appear to be in RADIANS"}\n\n` +
            `Edit mapping below (format: dataset_name=urdf_name,...):\n` +
            `Use "?" for joints to skip, reorder as needed:`;

          const mappingInput = window.prompt(mappingPrompt, defaultMapping)?.trim();

          if (mappingInput === null) {
            toast.info("Cancelled loading from Hugging Face dataset");
            return;
          }

          if (mappingInput) {
            // Parse mapping string
            const mappingPairs = mappingInput.split(",").map((pair) => pair.trim());
            for (const pair of mappingPairs) {
              const [datasetJoint, urdfJoint] = pair.split("=").map((s) => s.trim());
              if (datasetJoint && urdfJoint && urdfJoint !== "?") {
                jointMapping[datasetJoint] = urdfJoint;
              }
            }
            console.log("Joint mapping:", jointMapping);
          }

          // Ask about unit conversion
          if (likelyDegrees) {
            convertDegreesToRadians = window.confirm(
              `Values appear to be in DEGREES (max: ${maxAbsValue.toFixed(2)})\n\nConvert to radians?\n\nClick OK to convert degrees → radians\nClick Cancel to keep original values`
            );
          }
        }

        console.log("Convert degrees to radians:", convertDegreesToRadians);
        console.log("Final joint mapping:", jointMapping);

        // Convert to episodes
        const newEpisodes: Episode[] = [];
        let totalFramesLoaded = 0;

        const degToRad = Math.PI / 180;

        for (const [episodeIndex, episodeRows] of episodesMap.entries()) {
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

              // Convert degrees to radians if needed
              if (convertDegreesToRadians) {
                value = value * degToRad;
              }

              jointPositions[mappedName] = value;
            });

            return {
              timestamp,
              jointPositions,
            };
          });

          if (frames.length === 0) continue;

          totalFramesLoaded += frames.length;

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
          toast.error("No episodes found in dataset");
          return;
        }

        setEpisodes((prev) => [...prev, ...newEpisodes]);

        // Log first episode first frame for debugging
        if (newEpisodes.length > 0 && newEpisodes[0].frames.length > 0) {
          console.log("First episode, first frame joint positions:", newEpisodes[0].frames[0].jointPositions);
          console.log("Sample values (first 3 frames):", newEpisodes[0].frames.slice(0, 3).map(f => ({
            timestamp: f.timestamp,
            joints: f.jointPositions
          })));
        }

        toast.success(
          `Loaded ${newEpisodes.length} episode(s) with ${totalFramesLoaded} total frames from ${parsedPath}`
        );
      } else if (urdfUrls.length > 0) {
        // Only URDF was found, no parquet files
        toast.success(`Loaded URDF from ${parsedPath} (no parquet files found)`);
      }
    } catch (error) {
      console.error("Failed to load from Hugging Face dataset:", error);
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
    setEpisodes,
  ]);

  const deleteEpisode = useCallback((episodeId: string) => {
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
      setCurrentPlayingEpisodeIndex(null);
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = null;
      }
      (window as any).viewer3dStopAnimation?.();
      (window as any).viewer3dPlayAnimation?.(false);
      if (willBeEmpty) {
        // Reset frame to 0 when deleting the last episode
        (window as any).viewer3dSetFrame?.(0);
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
    toast.success("Episode deleted");
  }, [episodes, currentPlayingEpisodeIndex]);

  const retakeEpisode = useCallback(
    (episodeId: string) => {
      const episodeIndex = episodes.findIndex((ep) => ep.id === episodeId);
      if (episodeIndex === -1) return;

      const episodeNumber = episodes[episodeIndex].number;
      const existingMetadata = episodes[episodeIndex].metadata;

      setEpisodes((prev) =>
        renumberEpisodes(prev.filter((episode) => episode.id !== episodeId))
      );

      beginRecording({
        episodeNumber,
        insertPosition: episodeIndex,
        metadata: existingMetadata,
      });
      toast.info(`Recording Episode ${episodeNumber} (retake)`);
    },
    [beginRecording, episodes, setEpisodes]
  );

  const moveEpisode = useCallback((episodeId: string, direction: "up" | "down") => {
    setEpisodes((prev) => {
      const index = prev.findIndex((episode) => episode.id === episodeId);
      if (index === -1) return prev;

      const newIndex = direction === "up" ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prev.length) return prev;

      const next = [...prev];
      [next[index], next[newIndex]] = [next[newIndex], next[index]];
      return renumberEpisodes(next);
    });
  }, []);

  // Helper function to set episode and frame consistently
  // This ensures all playback operations use the same logic regardless of speed
  const setEpisodeAndFrame = useCallback((episodeIndex: number, frameIndex: number) => {
    if (episodeIndex < 0 || episodeIndex >= episodes.length) return;
    
    const episode = episodes[episodeIndex];
    if (!episode || !episode.frames || episode.frames.length === 0) return;
    
    const clampedFrame = Math.max(0, Math.min(frameIndex, episode.frames.length - 1));
    
    // Always use the same order: speed -> episode (only if different) -> frame -> update state
    // Set speed first and ensure it's applied before setting frame
    (window as any).viewer3dSetPlaybackSpeed?.(playbackSpeed);
    
    // Only reload episode if it's different from what's currently loaded
    // This prevents frame resets when resuming the same episode
    if (currentLoadedEpisodeRef.current !== episodeIndex) {
      const frames = toAnimationFrames(episode);
      (window as any).viewer3dPlayEpisode?.(frames);
      currentLoadedEpisodeRef.current = episodeIndex;
      
      // Set the frame immediately after loading the episode to prevent jump to frame 0
      // Use requestAnimationFrame to set it in the next frame, right after the episode loads
      requestAnimationFrame(() => {
        (window as any).viewer3dSetFrame?.(clampedFrame);
      });
    }
    
    // Use double requestAnimationFrame to ensure playback speed state has updated before setting frame
    // This is critical for non-1x speeds (e.g., 0.25x) to work correctly
    // First RAF: allows React state update to propagate
    requestAnimationFrame(() => {
      // Second RAF: ensures the prop has been passed to URDFModel and useFrame will use new speed
      requestAnimationFrame(() => {
        (window as any).viewer3dSetFrame?.(clampedFrame);
        onFrameChange?.(clampedFrame);
      });
    });
    
    setCurrentPlayingEpisodeIndex(episodeIndex);
  }, [episodes, playbackSpeed, onFrameChange]);

  const playEpisodeSequentially = useCallback(
    (startIndex: number, resumeFrame?: number) => {
      if (!isPlayingAllRef.current || episodes.length === 0) {
        isPlayingAllRef.current = false;
        setIsPlayingAll(false);
        setCurrentPlayingEpisodeIndex(null);
        return;
      }

      const playableIndex = findNextPlayableEpisodeIndex(episodes, startIndex);

      if (playableIndex === null) {
        toast.error("No episodes with frames to play");
        isPlayingAllRef.current = false;
        setIsPlayingAll(false);
        setCurrentPlayingEpisodeIndex(null);
        return;
      }

      const episode = episodes[playableIndex];
      if (!episode || !episode.frames || episode.frames.length === 0) {
        isPlayingAllRef.current = false;
        setIsPlayingAll(false);
        setCurrentPlayingEpisodeIndex(null);
        (window as any).viewer3dStopAnimation?.();
        (window as any).viewer3dPlayAnimation?.(false);
        toast.info("Stopped playback - episode no longer exists");
        return;
      }

      // Clear any existing timeout
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = null;
      }

      // Determine frame to start from: use resumeFrame if provided, otherwise check if same episode
      const isSameEpisode = playableIndex === startIndex;
      const frameToUse = resumeFrame !== undefined 
        ? Math.max(0, Math.min(resumeFrame, episode.frames.length - 1))
        : (isSameEpisode && currentFrame !== undefined && currentFrame >= 0)
          ? Math.max(0, Math.min(currentFrame, episode.frames.length - 1))
          : 0;
      
      // Use consistent helper function
      setEpisodeAndFrame(playableIndex, frameToUse);
      
      // Start playing
      (window as any).viewer3dPlayAnimation?.(true);
    },
    [episodes, currentFrame, playbackSpeed, setEpisodeAndFrame]
  );

  // Play single episode in loop
  const playEpisodeLoop = useCallback((episodeIndex: number, resumeFrame?: number) => {
    if (!isPlayingAllRef.current || episodes.length === 0) {
      isPlayingAllRef.current = false;
      setIsPlayingAll(false);
      setCurrentPlayingEpisodeIndex(null);
      return;
    }

    const episode = episodes[episodeIndex];
    if (!episode || !episode.frames || episode.frames.length === 0) {
      isPlayingAllRef.current = false;
      setIsPlayingAll(false);
      setCurrentPlayingEpisodeIndex(null);
      (window as any).viewer3dStopAnimation?.();
      (window as any).viewer3dPlayAnimation?.(false);
      return;
    }

    // Clear any existing timeout
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }

    // Determine frame to start from
    const frameToUse = resumeFrame !== undefined 
      ? Math.max(0, Math.min(resumeFrame, episode.frames.length - 1))
      : (currentFrame !== undefined && currentFrame >= 0)
        ? Math.max(0, Math.min(currentFrame, episode.frames.length - 1))
        : 0;
    
    // Use consistent helper function
    setEpisodeAndFrame(episodeIndex, frameToUse);
    
    // Start playing
    (window as any).viewer3dPlayAnimation?.(true);
  }, [episodes, currentFrame, playbackSpeed, setEpisodeAndFrame]);

  // Detect when episode finishes and handle based on mode
  useEffect(() => {
    // Only check if we're playing and have a current episode - use ref for consistency
    if (!isPlayingAllRef.current || currentPlayingEpisodeIndex === null || episodes.length === 0) {
      episodeTransitionScheduledRef.current = false;
      return;
    }

    const currentEpisode = episodes[currentPlayingEpisodeIndex];
    if (!currentEpisode || currentEpisode.frames.length === 0) {
      episodeTransitionScheduledRef.current = false;
      return;
    }

    const lastFrameIndex = currentEpisode.frames.length - 1;
    
    // When we reach the last frame of the current episode
    if (currentFrame !== undefined && currentFrame >= lastFrameIndex && !episodeTransitionScheduledRef.current) {
      episodeTransitionScheduledRef.current = true;
      
      // Capture values at the time of scheduling to avoid stale closures
      const scheduledEpisodeIndex = currentPlayingEpisodeIndex;
      const scheduledEpisodeId = currentEpisode.id;
      const scheduledEpisodes = episodes; // Capture episodes array too
      
      // Small delay to ensure the last frame is displayed
      const timeoutId = setTimeout(() => {
        // Double-check we're still playing and on the same episode using captured values
        // Use ref to check if still playing
        if (isPlayingAllRef.current && 
            scheduledEpisodeIndex !== null && 
            scheduledEpisodeIndex < scheduledEpisodes.length &&
            scheduledEpisodes[scheduledEpisodeIndex]?.id === scheduledEpisodeId) {
          
          // Use ref to get current mode to avoid stale closure
          const currentMode = playbackModeRef.current;
          if (currentMode === "loop") {
            // Loop mode: restart the same episode from frame 0
            episodeTransitionScheduledRef.current = false;
            playEpisodeLoop(scheduledEpisodeIndex, 0);
          } else {
            // Sequential mode: move to next episode
            const nextIndex = (scheduledEpisodeIndex + 1) % scheduledEpisodes.length;
            episodeTransitionScheduledRef.current = false;
            playEpisodeSequentially(nextIndex);
          }
        } else {
          episodeTransitionScheduledRef.current = false;
        }
      }, PLAYBACK_GAP_MS);
      
      return () => {
        clearTimeout(timeoutId);
        episodeTransitionScheduledRef.current = false;
      };
    } else if (currentFrame !== undefined && currentFrame < lastFrameIndex) {
      // Reset the flag if we're not at the last frame anymore (e.g., user scrubbed back)
      episodeTransitionScheduledRef.current = false;
    }
  }, [currentFrame, currentPlayingEpisodeIndex, episodes, playEpisodeSequentially, playEpisodeLoop]);

  const playAllEpisodes = useCallback((overrideFrame?: number) => {
    if (episodes.length === 0) {
      toast.error('No episodes to play');
      return;
    }

    if (isPlayingAll) {
      // Stop playback but preserve current frame position
      // Get current frame from Viewer3D before stopping to ensure we preserve the exact position
      const currentFrameFromViewer = (window as any).__viewer3dCurrentFrameIndex;
      const frameToPreserve = currentFrameFromViewer !== undefined && currentFrameFromViewer !== null
        ? currentFrameFromViewer
        : (currentFrame !== undefined ? currentFrame : 0);
      
      setIsPlayingAll(false);
      isPlayingAllRef.current = false;
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = null;
      }
      
      // Stop animation - this will preserve the frame position in Viewer3D
      (window as any).viewer3dStopAnimation?.();
      (window as any).viewer3dPlayAnimation?.(false);
      
      // Ensure the frame is preserved in our state and in Viewer3D
      if (currentPlayingEpisodeIndex !== null && episodes[currentPlayingEpisodeIndex]) {
        const episode = episodes[currentPlayingEpisodeIndex];
        const clampedFrame = Math.max(0, Math.min(frameToPreserve, episode.frames.length - 1));
        // Explicitly set the frame to ensure it stays at the current position
        (window as any).viewer3dSetFrame?.(clampedFrame);
        onFrameChange?.(clampedFrame);
      }
      
      return;
    }

    // Start or resume playback based on mode
    setIsPlayingAll(true);
    isPlayingAllRef.current = true;
    
    const startIndex = currentPlayingEpisodeIndex !== null ? currentPlayingEpisodeIndex : 0;
    // Use overrideFrame if provided, otherwise use currentFrame
    const resumeFrame = overrideFrame !== undefined 
      ? overrideFrame 
      : (currentFrame !== undefined && currentFrame >= 0 ? currentFrame : undefined);
    
    // Start playback based on mode
    if (playbackMode === "loop") {
      playEpisodeLoop(startIndex, resumeFrame);
    } else {
      playEpisodeSequentially(startIndex, resumeFrame);
    }
  }, [episodes, isPlayingAll, playEpisodeSequentially, playEpisodeLoop, currentPlayingEpisodeIndex, currentFrame, onFrameChange, playbackMode]);

  // Sync playback speed with Viewer3D
  useEffect(() => {
    (window as any).viewer3dSetPlaybackSpeed?.(playbackSpeed);
  }, [playbackSpeed]);

  // Cleanup recording interval and playback timeout on unmount
  useEffect(() => {
    return () => {
      clearRecordingInterval();
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
      }
    };
  }, [clearRecordingInterval]);

  return (
    <div
      className="sidebar-panel flex flex-col h-screen fixed left-0 top-0 bg-[hsl(var(--sidebar-bg))] transition-transform duration-200 ease-out shadow-xl z-30"
      style={{
        width,
        minWidth: SIDEBAR_MIN_WIDTH,
        transform: isCollapsed ? "translateX(-100%)" : undefined,
        pointerEvents: isCollapsed ? "none" : "auto",
      }}
      aria-hidden={isCollapsed}
    >
      <Tabs defaultValue="joints" className="flex flex-col h-full">
        {/* Header with Logo and Tabs */}
        <div className="flex-shrink-0 border-b border-border/30">
          <div className="flex items-center gap-3 p-3">
            <img 
              src="/assets/urdf-studio-logo.png" 
              alt="URDF Studio" 
              className="h-10 w-auto object-contain"
            />
            <TabsList className="grid grid-cols-2 bg-transparent flex-1">
              <TabsTrigger value="joints" className="flex items-center gap-1.5 text-xs">
                <Sliders className="w-3.5 h-3.5" />
                Editor
              </TabsTrigger>
              <TabsTrigger value="recording" className="flex items-center gap-1.5 text-xs">
                <Square className="w-3.5 h-3.5" />
                Recording
              </TabsTrigger>
            </TabsList>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={onToggleCollapse}
              aria-label={isCollapsed ? "Expand panel" : "Collapse panel"}
              title={isCollapsed ? "Show sidebar" : "Hide sidebar"}
              disabled={!onToggleCollapse}
            >
              {isCollapsed ? (
                <ChevronsRight className="w-4 h-4" />
              ) : (
                <ChevronsLeft className="w-4 h-4" />
              )}
            </Button>
          </div>
          
          {/* Loading indicator */}
          {isLoading && (
            <div className="px-4 py-2 border-t border-border/30">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span>Loading robot model...</span>
              </div>
            </div>
          )}

        </div>

        {/* Tabs Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {/* Joints Tab */}
          <TabsContent value="joints" className="flex-1 overflow-hidden mt-0 h-full">
            <div className="flex flex-col h-full overflow-hidden">
              <div className="px-3 py-2 space-y-2 flex-shrink-0">
              </div>
              {/* View & Edit URDF Button */}
              {originalUrdf && vizUrdf && (
                <div className="px-3 py-2 flex-shrink-0 border-t border-border/30">
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full h-7 text-xs"
                    onClick={() => setShowComparison(true)}
                  >
                    <GitCompare className="w-3 h-3 mr-1.5" />
                    View & Edit URDF
                  </Button>
                  <URDFComparison
                    originalUrdf={originalUrdf}
                    vizUrdf={vizUrdf}
                    isOpen={showComparison}
                    onClose={() => setShowComparison(false)}
                    onVizUrdfChange={onVizUrdfChange}
                    getExportUrdf={getExportUrdf}
                    meshFiles={meshFiles}
                    githubToken={typeof window !== "undefined" && import.meta.env.VITE_GITHUB_TOKEN ? import.meta.env.VITE_GITHUB_TOKEN : null}
                  />
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-y-auto blender-scrollbar">
                {/* Joint Editor Section */}
                <BlenderPanel title="Joint Editor" defaultOpen={true}>
                  <JointsWindow
                    availableJoints={availableJoints}
                    jointLimits={jointLimits}
                    jointAxes={jointAxes}
                    originalJointAxes={originalJointAxes}
                    storeJointValues={storeJointValues}
                    onJointChange={handleJointChange}
                    onJointSelect={onJointSelect}
                    selectedJoint={selectedJoint}
                    onJointAxisChange={onJointAxisChange}
                    onResetAxis={onResetAxis}
                    onJointTypeChange={onJointTypeChange}
                    onJointNameChange={onJointNameChange}
                    onDeleteJoint={onDeleteJoint}
                    deletedJoints={deletedJoints}
                    angleUnit={angleUnit}
                    onAngleUnitChange={setAngleUnit}
                    urdfContent={vizUrdf}
                    velocityLimitEnabled={velocityLimitEnabled}
                    onVelocityLimitEnabledChange={setVelocityLimitEnabled}
                    globalMaxJointVelocity={globalMaxJointVelocity}
                    onGlobalMaxJointVelocityChange={setGlobalMaxJointVelocity}
                    sliderValue={sliderValue}
                    sliderMin={sliderMin}
                    sliderMax={sliderMax}
                    sliderStep={sliderStep}
                    fromDisplayVelocity={fromDisplayVelocity}
                    applyGlobalVelocityToAll={applyGlobalVelocityToAll}
                    onRotateRobot={onRotateRobot}
                    rotationAxis={rotationAxis}
                    onRotationAxisChange={setRotationAxis}
                    onResetRotation={onResetRotation}
                    hasRotationChanges={hasRotationChanges}
                    onJointLinkChange={handleJointLinkChange}
                  />
                </BlenderPanel>
                {/* Link Editor Section */}
                <BlenderPanel title="Link Editor" defaultOpen={true}>
                  <LinkEditor
                    urdfContent={vizUrdf}
                    onMaterialChange={handleMaterialChange}
                    onLinkNameChange={handleLinkNameChange}
                    onUrdfChange={onVizUrdfChange}
                    meshFiles={meshFiles}
                    collisionVisibility={collisionVisibility}
                    onCollisionVisibilityChange={setCollisionVisibility}
                  />
                </BlenderPanel>
              </div>
            </div>
          </TabsContent>

          {/* Recording Tab - Blender Style */}
          <TabsContent value="recording" className="flex-1 overflow-hidden flex flex-col p-2 mt-0 h-full blender-scrollbar">
            {/* Recording Controls */}
            <BlenderPanel title="Recording" defaultOpen={true}>
              <div className="space-y-2">
                {/* Record button - Large and prominent */}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={isRecording ? "destructive" : "default"}
                    className={`h-10 text-xs px-5 flex-shrink-0 font-semibold ${
                      isRecording 
                        ? "bg-red-600 hover:bg-red-700 text-white" 
                        : "bg-red-500 hover:bg-red-600 text-white"
                    }`}
                    onClick={isRecording ? stopRecording : startRecording}
                  >
                    {isRecording ? (
                      <>
                        <Square className="w-3.5 h-3.5 mr-1.5 fill-current" />
                        Stop Recording
                      </>
                    ) : (
                      <>
                        <Circle className="w-3.5 h-3.5 mr-1.5 fill-current" />
                        Record
                      </>
                    )}
                  </Button>
                  <div className="flex items-center gap-1.5 flex-1">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">FPS:</label>
                    <NumberInput
                      value={recordingFps}
                      onValueChange={setRecordingFps}
                      min={1}
                      max={120}
                      step={1}
                      compact={true}
                      disabled={isRecording}
                      className="w-16"
                    />
                  </div>
                </div>
                
                {/* Load dataset from: Local Folder or Hugging Face */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Load Dataset</label>
                  <div className="flex gap-1.5">
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
                      onChange={async (e) => {
                        const files = e.target.files;
                        if (!files || files.length === 0) {
                          return;
                        }

                        const fileArray = Array.from(files) as FileWithRelativePath[];
                        
                        // Check if this is a v3 dataset folder structure
                        const hasInfoJson = fileArray.some(
                          (file) => {
                            const path = file.webkitRelativePath || file.name;
                            return path.includes("meta/info.json") || path.endsWith("info.json");
                          }
                        );

                        if (hasInfoJson) {
                          // This is a v3 dataset folder - convert to zip and load
                          try {
                            const zip = new JSZip();
                            
                            // Find the info.json file to determine the base path
                            const infoJsonFile = fileArray.find(
                              (file) => {
                                const path = file.webkitRelativePath || file.name;
                                return path.includes("meta/info.json") || path.endsWith("info.json");
                              }
                            );
                            
                            if (!infoJsonFile) {
                              e.target.value = "";
                              return;
                            }
                            
                            // Determine base path - if info.json is at "meta/info.json", base is empty
                            // If it's at "dataset_name/meta/info.json", base is "dataset_name/"
                            const infoPath = infoJsonFile.webkitRelativePath || infoJsonFile.name;
                            let basePath = "";
                            if (infoPath.includes("/")) {
                              const parts = infoPath.split("/");
                              if (parts.length > 2) {
                                // Has dataset folder name
                                basePath = parts.slice(0, -2).join("/") + "/";
                              }
                            }
                            
                            // Add all files to zip preserving folder structure
                            for (const file of fileArray) {
                              const path = file.webkitRelativePath || file.name;
                              // Remove base path if present
                              let normalizedPath = path;
                              if (basePath && path.startsWith(basePath)) {
                                normalizedPath = path.slice(basePath.length);
                              }
                              if (normalizedPath && !normalizedPath.endsWith("/")) {
                                const content = await file.arrayBuffer();
                                zip.file(normalizedPath, content);
                              }
                            }
                            
                            await loadEpisodesFromArchiveZip(zip);
                          } catch (error) {
                            console.error("Failed to load v3 dataset folder:", error);
                            // Silently fail - don't show error if format doesn't match
                          }
                          e.target.value = "";
                          return;
                        }

                        // Legacy format: individual data files
                        const motionDataFiles = fileArray
                          .filter((file) => {
                            const name = file.name.toLowerCase();
                            return (
                              name.endsWith(".json") ||
                              name.endsWith(".csv") ||
                              name.endsWith(".pos")
                            );
                          })
                          .sort((a, b) => {
                            const pathA = a.webkitRelativePath || a.name;
                            const pathB = b.webkitRelativePath || b.name;
                            return pathA.localeCompare(pathB);
                          });

                        if (motionDataFiles.length === 0) {
                          e.target.value = "";
                          return;
                        }

                       const suppressIndividualToasts = motionDataFiles.length > 1;
                       let successfulLoads = 0;
                       const failedFiles: string[] = [];

                       for (const file of motionDataFiles) {
                         try {
                           const loaded = await loadEpisodesFromDataFile(file, { suppressToast: suppressIndividualToasts });
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

                        e.target.value = "";
                      }}
                      className="hidden"
                    />
                    <label htmlFor="motion-upload-episodes" className="flex-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-8 text-xs"
                        asChild
                      >
                        <span className="cursor-pointer flex items-center justify-center gap-1.5">
                          <FolderOpen className="w-3.5 h-3.5" />
                          Local Folder
                        </span>
                      </Button>
                    </label>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 h-8 text-xs"
                      onClick={() => {
                        void loadEpisodesFromHuggingFaceDataset();
                      }}
                      disabled={isImportingFromHFDataset}
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      {isImportingFromHFDataset ? "Loading..." : "Hugging Face"}
                    </Button>
                  </div>
                </div>

                {/* Export dataset to: Local Folder or Hugging Face */}
                {episodes.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Export Dataset</label>
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-8 text-xs"
                        onClick={() => {
                          void exportDatasetToLeRobotFormat();
                        }}
                        disabled={isExportingDataset}
                      >
                        <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
                        {isExportingDataset ? "Building..." : "Local Folder"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-8 text-xs"
                        onClick={() => {
                          void uploadEpisodesToHuggingFace();
                        }}
                        disabled={isUploadingToHF}
                      >
                        <Send className="w-3.5 h-3.5 mr-1.5" />
                        {isUploadingToHF ? "Uploading..." : "Hugging Face"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </BlenderPanel>

            {/* Blender-style Timeline Controls */}
            <BlenderPanel title="Timeline" defaultOpen={true}>
              {/* Playback Controls Row - Simplified */}
              <div className="flex items-center gap-0.5 mb-2">
                {/* Previous Episode (|<) - Go to previous episode's first frame, stop playback */}
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 hover:bg-muted/50"
                      onClick={() => {
                        if (episodes.length === 0) return;
                        const currentIndex = currentPlayingEpisodeIndex ?? 0;
                        const prevIndex = currentIndex > 0 ? currentIndex - 1 : episodes.length - 1;
                        const prevEpisode = episodes[prevIndex];
                        if (prevEpisode && prevEpisode.frames.length > 0) {
                          // Stop playback
                          setIsPlayingAll(false);
                          isPlayingAllRef.current = false;
                          (window as any).viewer3dStopAnimation?.();
                          (window as any).viewer3dPlayAnimation?.(false);
                          // Use consistent helper function
                          setEpisodeAndFrame(prevIndex, 0);
                        }
                      }}
                      disabled={episodes.length === 0}
                    >
                      <SkipBack className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <p className="font-medium">Previous Episode</p>
                    <p className="text-muted-foreground">Go to previous episode (wraps to last)</p>
                  </TooltipContent>
                </Tooltip>
                
                {/* Play/Pause - Toggle playback */}
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant={isPlayingAll ? "default" : "ghost"}
                      className="h-7 w-7 p-0"
                      onClick={() => playAllEpisodes()}
                      disabled={episodes.length === 0}
                    >
                      {isPlayingAll ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <p className="font-medium">{isPlayingAll ? "Pause" : "Play"}</p>
                    <p className="text-muted-foreground">
                      {isPlayingAll 
                        ? "Pause playback" 
                        : playbackMode === "loop" 
                          ? "Play current episode in loop"
                          : "Play all episodes sequentially"}
                    </p>
                  </TooltipContent>
                </Tooltip>
                
                {/* Next Episode (>|) - Go to next episode's first frame, stop playback */}
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 hover:bg-muted/50"
                      onClick={() => {
                        if (episodes.length === 0) return;
                        const currentIndex = currentPlayingEpisodeIndex ?? 0;
                        const nextIndex = (currentIndex + 1) % episodes.length;
                        const nextEpisode = episodes[nextIndex];
                        if (nextEpisode && nextEpisode.frames.length > 0) {
                          // Stop playback
                          setIsPlayingAll(false);
                          isPlayingAllRef.current = false;
                          (window as any).viewer3dStopAnimation?.();
                          (window as any).viewer3dPlayAnimation?.(false);
                          // Use consistent helper function
                          setEpisodeAndFrame(nextIndex, 0);
                        }
                      }}
                      disabled={episodes.length === 0}
                    >
                      <SkipForward className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <p className="font-medium">Next Episode</p>
                    <p className="text-muted-foreground">Go to next episode (wraps to first)</p>
                  </TooltipContent>
                </Tooltip>
                
                {/* Current Frame Display */}
                {(() => {
                  // Don't show frame counter if there are no episodes
                  if (episodes.length === 0) {
                    return (
                      <div className="flex items-center gap-1.5 ml-2 px-2.5 py-1 bg-muted/50 rounded border border-border/50 min-w-[100px] justify-end">
                        <span className="text-xs text-muted-foreground">Frame:</span>
                        <span className="text-xs font-mono font-semibold text-foreground blender-number tabular-nums">
                          0
                        </span>
                      </div>
                    );
                  }
                  
                  // Calculate total frames from currently playing episode
                  const activeEpisode = currentPlayingEpisodeIndex !== null 
                    ? episodes[currentPlayingEpisodeIndex] 
                    : null;
                  const episodeTotalFrames = activeEpisode?.frames.length || totalFrames;
                  const displayFrame = episodeTotalFrames > 0 ? currentFrame + 1 : 0;
                  
                  return (
                    <div className="flex items-center gap-1.5 ml-2 px-2.5 py-1 bg-muted/50 rounded border border-border/50 min-w-[100px] justify-end">
                      <span className="text-xs text-muted-foreground">Frame:</span>
                      <span className="text-xs font-mono font-semibold text-foreground blender-number tabular-nums">
                        {displayFrame}
                      </span>
                      {episodeTotalFrames > 0 && (
                        <>
                          <span className="text-xs text-muted-foreground">/</span>
                          <span className="text-xs font-mono text-muted-foreground blender-number tabular-nums">
                            {episodeTotalFrames}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Frame Range and Speed Controls */}
              <div className="space-y-1.5">
                {/* Playback Mode Selector */}
                <BlenderPropertyRow label="Mode">
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant={playbackMode === "loop" ? "default" : "outline"}
                      className="flex-1 h-7 text-xs"
                      onClick={() => {
                        setPlaybackMode("loop");
                        playbackModeRef.current = "loop";
                        // Stop current playback when switching modes
                        if (isPlayingAll) {
                          setIsPlayingAll(false);
                          isPlayingAllRef.current = false;
                          (window as any).viewer3dStopAnimation?.();
                          (window as any).viewer3dPlayAnimation?.(false);
                        }
                      }}
                    >
                      Loop 1
                    </Button>
                    <Button
                      size="sm"
                      variant={playbackMode === "sequential" ? "default" : "outline"}
                      className="flex-1 h-7 text-xs"
                      onClick={() => {
                        setPlaybackMode("sequential");
                        playbackModeRef.current = "sequential";
                        // Stop current playback when switching modes
                        if (isPlayingAll) {
                          setIsPlayingAll(false);
                          isPlayingAllRef.current = false;
                          (window as any).viewer3dStopAnimation?.();
                          (window as any).viewer3dPlayAnimation?.(false);
                        }
                      }}
                    >
                      All
                    </Button>
                  </div>
                </BlenderPropertyRow>
                
                <BlenderPropertyRow label="Speed">
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[playbackSpeed]}
                      onValueChange={(values) => {
                        const newSpeed = values[0];
                        setPlaybackSpeed(newSpeed);
                        (window as any).viewer3dSetPlaybackSpeed?.(newSpeed);
                      }}
                      min={0.25}
                      max={6}
                      step={0.25}
                      className="flex-1"
                    />
                    <span className="text-xs font-mono text-foreground w-10 text-right blender-number">
                      {playbackSpeed.toFixed(2)}x
                    </span>
                  </div>
                </BlenderPropertyRow>
                
                {/* Graphics Viewer Button */}
                <div className="px-1">
                  <Button
                    size="sm"
                    variant={isViewerModalOpen ? "default" : "outline"}
                    className="w-full h-8 text-xs"
                    onClick={() => {
                      if (isViewerModalOpen) {
                        setIsViewerModalOpen(false);
                      } else {
                        // Open viewer with current episode
                        const activeIndex = currentPlayingEpisodeIndex ?? 0;
                        if (episodes.length > 0 && episodes[activeIndex]) {
                          setViewerModalEpisode(episodes[activeIndex]);
                          setIsViewerModalOpen(true);
                        }
                      }
                    }}
                    disabled={episodes.length === 0}
                  >
                    <Eye className="w-3.5 h-3.5 mr-1.5" />
                    {isViewerModalOpen ? "Close Viewer" : "Open Viewer"}
                  </Button>
                </div>
                
                <p className="text-[10px] text-muted-foreground px-1 truncate">
                  {motionDataFileName ? `Motion data file: ${motionDataFileName}` : "No motion data file loaded"}
                </p>
              </div>
            </BlenderPanel>

            {/* Episodes List */}
            <BlenderPanel title={`Episodes (${episodes.length})`} defaultOpen={true}>
              <div className="flex-1 overflow-y-auto max-h-[400px] blender-scrollbar">
                {episodes.length === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-xs text-muted-foreground">No episodes</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Load JSON data or record new</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {episodes.map((episode, index) => {
                      const duration = episode.frames.length > 0 
                        ? episode.frames[episode.frames.length - 1].timestamp 
                        : 0;
                      const durationSeconds = (duration / 1000).toFixed(1);
                      // Get current frame for this episode - show currentFrame if it's the currently active episode (regardless of playing state)
                      // Add 1 to match the global counter display format (1-indexed)
                      const episodeCurrentFrame = (currentPlayingEpisodeIndex === index && currentFrame !== undefined) 
                        ? currentFrame + 1 
                        : 0;
                      const totalFrames = episode.frames.length;
                        
                        return (
                          <div
                            key={episode.id}
                            className="group relative border border-border rounded p-1.5 bg-background hover:bg-muted/30 transition-colors"
                          >
                            <div className="flex items-center gap-1.5">
                              {/* Episode Number */}
                              <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <span className="text-[10px] font-bold text-primary">
                                  {episode.number}
                                </span>
                              </div>
                              
                              {/* Episode Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className="text-xs font-medium text-foreground">
                                    {episode.frames.length} frames
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {durationSeconds}s
                                  </span>
                                  {/* Frame Counter */}
                                  <span className="text-[10px] font-mono text-muted-foreground">
                                    {episodeCurrentFrame}/{totalFrames}
                                  </span>
                                </div>
                              </div>

                            {/* Quick Actions */}
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0"
                                onClick={() => exportEpisodeToDataFile(episode)}
                                title="Export"
                              >
                                <Download className="w-2.5 h-2.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0"
                                onClick={() => deleteEpisode(episode.id)}
                                disabled={isRecording}
                                title="Delete"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </Button>
                            </div>
                          </div>
                          
                          {/* Compact Controls */}
                          <div className="flex items-center gap-0.5 mt-1 pt-1 border-t border-border/50">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1 text-[10px]"
                              onClick={() => moveEpisode(episode.id, 'up')}
                              disabled={index === 0}
                              title="Move up"
                            >
                              <ArrowUp className="w-2.5 h-2.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1 text-[10px]"
                              onClick={() => moveEpisode(episode.id, 'down')}
                              disabled={index === episodes.length - 1}
                              title="Move down"
                            >
                              <ArrowDown className="w-2.5 h-2.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1 text-[10px] flex-1"
                              onClick={() => retakeEpisode(episode.id)}
                              disabled={isRecording}
                              title="Retake"
                            >
                              <RotateCcw className="w-2.5 h-2.5 mr-0.5" />
                              Retake
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </BlenderPanel>
          </TabsContent>
        </div>
      </Tabs>

      {/* Episode Viewer Modal */}
      <EpisodeViewer3DModal
        episode={viewerModalEpisode}
        open={isViewerModalOpen}
        onOpenChange={setIsViewerModalOpen}
        currentEpisodeIndex={currentPlayingEpisodeIndex}
        allEpisodes={episodes}
        isPlayingAll={isPlayingAll}
        onPlayAllEpisodes={playAllEpisodes}
        onSetCurrentEpisodeIndex={setCurrentPlayingEpisodeIndex}
        globalCurrentFrame={currentFrame}
        onSetGlobalFrame={(frame: number) => {
          (window as any).viewer3dSetFrame?.(frame);
          // Update parent's currentFrame state so playback resumes from scrubbed position
          onFrameChange?.(frame);
        }}
      />
    </div>
  );
};


