import type { Episode } from "./episodes";
import { RECORDING_INTERVAL_MS } from "./episodes";
import type { JointLimits } from "@/features/urdf/parsing/parseJointLimits";
import type { JointLimitMode } from "@/shared/types/feature";
import {
  applyJointLimitCorrectionsToFrames,
  summarizeJointLimitCorrections,
} from "./jointLimitCorrections";

type JSZipInstance = import("jszip");

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

export const buildEpisodeDataForV3 = (
  episodes: Episode[],
  robotBaseName: string | undefined,
  robotName?: string | undefined,
  urdfJointOrder?: string[]
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
    const missingJoints = Array.from(globalJointSet).filter(
      (joint) => !urdfSet.has(joint)
    );
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
      typeof episode.metadata?.fps === "number" ? episode.metadata.fps : undefined;
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

    const episodeTasks = (episode.metadata?.tasks as string[] | undefined) ?? [];
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
  const finalRobotType =
    representativeRobotType ?? robotName ?? robotBaseName ?? "unknown";

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

export const generateV3DatasetArchive = async (
  episodes: Episode[],
  robotBaseName: string | undefined,
  zip: JSZipInstance,
  datasetName: string,
  robotName?: string | undefined,
  urdfJointOrder?: string[],
  limitCorrection?: {
    mode: JointLimitMode;
    jointLimits: JointLimits;
  }
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

  let episodesForExport = episodes;
  let limitCorrectionsInfo: Record<string, unknown> | null = null;

  if (
    limitCorrection &&
    limitCorrection.mode !== "report" &&
    Object.keys(limitCorrection.jointLimits).length > 0
  ) {
    const modeByJoint: Record<string, JointLimitMode> = {};
    Object.keys(limitCorrection.jointLimits).forEach((jointName) => {
      modeByJoint[jointName] = limitCorrection.mode;
    });

    let totalViolations = 0;
    let totalClamped = 0;
    const jointSummary = new Map<string, { violations: number; clamped: number; shiftOffset: number | null }>();

    episodesForExport = episodes.map((episode) => {
      const { frames: correctedFrames, summaries, violations } =
        applyJointLimitCorrectionsToFrames(
          episode.frames,
          limitCorrection.jointLimits,
          modeByJoint
        );
      const report = summarizeJointLimitCorrections(summaries, violations);
      totalViolations += report.totalViolations;
      totalClamped += report.totalClamped;

      report.joints.forEach((summary) => {
        const existing = jointSummary.get(summary.jointName);
        if (existing) {
          existing.violations += summary.violations;
          existing.clamped += summary.clamped;
          if (summary.shiftOffset !== null) {
            existing.shiftOffset = summary.shiftOffset;
          }
        } else {
          jointSummary.set(summary.jointName, {
            violations: summary.violations,
            clamped: summary.clamped,
            shiftOffset: summary.shiftOffset,
          });
        }
      });

      if (correctedFrames === episode.frames) {
        return episode;
      }
      return {
        ...episode,
        frames: correctedFrames,
      };
    });

    limitCorrectionsInfo = {
      mode: limitCorrection.mode,
      total_violations: totalViolations,
      total_clamped: totalClamped,
      joints: Array.from(jointSummary.entries()).map(([jointName, summary]) => ({
        joint: jointName,
        violations: summary.violations,
        clamped: summary.clamped,
        shift_offset: summary.shiftOffset,
      })),
    };
  }

  // Use common helper to build episode data
  const episodeData = buildEpisodeDataForV3(
    episodesForExport,
    robotBaseName,
    robotName,
    urdfJointOrder
  );
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
    ...(limitCorrectionsInfo ? { limit_corrections: limitCorrectionsInfo } : {}),
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
  const episodesChunkContent = episodeSummaries.map((ep) => JSON.stringify(ep)).join("\n");
  episodesFolder.file("chunk-000.parquet", episodesChunkContent);

  // Write data files in chunk/file structure: data/chunk-000/file-000.parquet
  const chunkFolder = dataFolder.folder("chunk-000");
  if (!chunkFolder) {
    throw new Error("Failed to create data/chunk-000 directory");
  }
  const flattenedContent = flattenedRows.map((row) => JSON.stringify(row)).join("\n");
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
      const dimensionValues = arrayValues
        .map((arr) => arr[i])
        .filter((v) => typeof v === "number");
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
  }

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
};
