import type { Episode } from "./episodes";
import { RECORDING_INTERVAL_MS } from "./episodes";
import { collectDatasetArchiveLineage } from "./datasetArchiveLineage";
import {
  DEFAULT_INDEXED_REPRESENTATION_ID,
  NAMING_STATUS_NAMED,
  NAMING_STATUS_UNNAMED,
} from "./datasetAlignmentParams";
import type { EmbodimentRef, NamingStatus } from "./io/episodeTypes";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { JointLimitMode } from "@/shared/types/feature";
import {
  applyJointLimitCorrectionsToFrames,
  summarizeJointLimitCorrections,
} from "./jointLimitCorrections";
import {
  V3_DATASET_CODEBASE_VERSION,
  V3_DATASET_DATA_PATH_TEMPLATE,
  V3_DATASET_DATA_ROWS_PER_CHUNK,
  V3_DATASET_DEFAULT_FILES_SIZE_IN_MB,
  V3_DATASET_DEFAULT_SPLIT_NAME,
  V3_DATASET_DEFAULT_TASK_PREFIX,
  V3_DATASET_EPISODES_PER_CHUNK,
  V3_DATASET_INDEX_DIGITS,
  V3_DATASET_JOINT_FEATURE_GROUP,
  V3_DATASET_NO_VIDEO_PATH,
  V3_DATASET_PRIMARY_FILE_INDEX,
} from "./v3DatasetParams";

type JSZipInstance = import("jszip");
type WriteParquetFile = typeof import("./v3Parquet").writeParquetFile;

type V3FlattenedRow = {
  index: number;
  episode_index: number;
  frame_index: number;
  timestamp: number;
  action: number[];
  "observation.state": number[];
  task_index: number;
};

type V3StatsFieldResult = {
  min: number[];
  max: number[];
  mean: number[];
  std: number[];
  count: number[];
};

type V3PreparedEpisodeSummary = {
  episode_index: number;
  "data/chunk_index": number;
  "data/file_index": number;
  dataset_from_index: number;
  dataset_to_index: number;
  tasks: string[];
  length: number;
  "meta/episodes/chunk_index": number;
  "meta/episodes/file_index": number;
  task_index: number;
  statsByField: Record<string, V3StatsFieldResult>;
};

interface BuildEpisodeDataResult {
  globalJointOrder: string[];
  flattenedRows: V3FlattenedRow[];
  episodeSummaries: V3PreparedEpisodeSummary[];
  episodeIndexToSourceKey: Map<number, string>;
  tasksList: string[];
  totalFrames: number;
  representativeFps: number;
  representativeRobotType: string | undefined;
  representativeEmbodimentRef: EmbodimentRef | undefined;
  representativeRepresentationId: string;
  representativeNamingStatus: NamingStatus;
  representativeTreatmentManifest: Record<string, unknown> | undefined;
  sourceLineageRecords: Array<Record<string, unknown>>;
}

type BuildEpisodeDataOptions = {
  collectFlattenedRows?: boolean;
  onFlattenedRow?: (row: V3FlattenedRow) => void;
};

type NumericStatsAccumulator = {
  count: number;
  min: number;
  max: number;
  mean: number;
  m2: number;
};

type V3StatsCollector = {
  frameIndex: NumericStatsAccumulator;
  timestamp: NumericStatsAccumulator;
  taskIndex: NumericStatsAccumulator;
  datasetIndex: NumericStatsAccumulator;
  episodeIndex: NumericStatsAccumulator;
  actionDimensions: NumericStatsAccumulator[];
};

type EpisodeStatFieldName =
  | "observation.state"
  | "action"
  | "episode_index"
  | "frame_index"
  | "timestamp"
  | "index"
  | "task_index";

const PLACEHOLDER_JOINT_PATTERNS = [/^joint_\d+$/i, /^j\d+$/i, /^motor_\d+$/i] as const;
const EPISODE_STATS_FIELD_ORDER = [
  "observation.state",
  "action",
  "episode_index",
  "frame_index",
  "timestamp",
  "index",
  "task_index",
] as const satisfies readonly EpisodeStatFieldName[];
const STATS_VALUE_FIELDS = ["min", "max", "mean", "std", "count"] as const;

let writeParquetFilePromise: Promise<WriteParquetFile> | null = null;

const inferNamingStatus = (jointOrder: string[]): NamingStatus =>
  jointOrder.some((jointName) =>
    PLACEHOLDER_JOINT_PATTERNS.every((pattern) => !pattern.test(jointName))
  )
    ? NAMING_STATUS_NAMED
    : NAMING_STATUS_UNNAMED;

const loadWriteParquetFile = async (): Promise<WriteParquetFile> => {
  if (!writeParquetFilePromise) {
    writeParquetFilePromise = import("./v3Parquet").then(
      ({ writeParquetFile: loadedWriteParquetFile }) => loadedWriteParquetFile
    );
  }
  return writeParquetFilePromise;
};

const splitIntoChunks = <Item>(items: Item[], chunkSize: number) => {
  if (chunkSize <= 0) {
    throw new Error(`Chunk size must be positive, received ${chunkSize}`);
  }
  const chunks: Item[][] = [];
  for (let startIndex = 0; startIndex < items.length; startIndex += chunkSize) {
    chunks.push(items.slice(startIndex, startIndex + chunkSize));
  }
  return chunks;
};

const formatV3ArchiveIndex = (index: number) =>
  index.toString().padStart(V3_DATASET_INDEX_DIGITS, "0");

const buildV3ArchiveParquetFileName = (index: number) =>
  `file-${formatV3ArchiveIndex(index)}.parquet`;

const createNumericStatsAccumulator = (): NumericStatsAccumulator => ({
  count: 0,
  min: Infinity,
  max: -Infinity,
  mean: 0,
  m2: 0,
});

const addNumericStatsSample = (
  accumulator: NumericStatsAccumulator,
  value: number
) => {
  if (!Number.isFinite(value)) {
    return;
  }
  accumulator.count += 1;
  accumulator.min = Math.min(accumulator.min, value);
  accumulator.max = Math.max(accumulator.max, value);
  const delta = value - accumulator.mean;
  accumulator.mean += delta / accumulator.count;
  accumulator.m2 += delta * (value - accumulator.mean);
};

const finalizeNumericStatsAccumulator = (
  accumulator: NumericStatsAccumulator
): V3StatsFieldResult => {
  if (accumulator.count <= 0) {
    return {
      min: [0],
      max: [0],
      mean: [0],
      std: [0],
      count: [0],
    };
  }
  return {
    min: [accumulator.min],
    max: [accumulator.max],
    mean: [accumulator.mean],
    std: [Math.sqrt(accumulator.m2 / accumulator.count)],
    count: [accumulator.count],
  };
};

const buildArrayStatsFieldResult = (
  accumulators: NumericStatsAccumulator[]
): V3StatsFieldResult => {
  const finalized = accumulators.map((accumulator) =>
    finalizeNumericStatsAccumulator(accumulator)
  );
  return {
    min: finalized.map((stats) => stats.min[0]),
    max: finalized.map((stats) => stats.max[0]),
    mean: finalized.map((stats) => stats.mean[0]),
    std: finalized.map((stats) => stats.std[0]),
    count: finalized.map((stats) => stats.count[0]),
  };
};

const createV3StatsCollector = (): V3StatsCollector => ({
  frameIndex: createNumericStatsAccumulator(),
  timestamp: createNumericStatsAccumulator(),
  taskIndex: createNumericStatsAccumulator(),
  datasetIndex: createNumericStatsAccumulator(),
  episodeIndex: createNumericStatsAccumulator(),
  actionDimensions: [],
});

const addRowToV3StatsCollector = (
  collector: V3StatsCollector,
  row: V3FlattenedRow
) => {
  addNumericStatsSample(collector.frameIndex, row.frame_index);
  addNumericStatsSample(collector.timestamp, row.timestamp);
  addNumericStatsSample(collector.taskIndex, row.task_index);
  addNumericStatsSample(collector.datasetIndex, row.index);
  addNumericStatsSample(collector.episodeIndex, row.episode_index);
  row.action.forEach((value, dimensionIndex) => {
    if (!collector.actionDimensions[dimensionIndex]) {
      collector.actionDimensions[dimensionIndex] = createNumericStatsAccumulator();
    }
    addNumericStatsSample(collector.actionDimensions[dimensionIndex], value);
  });
};

const computeV3Stats = (collector: V3StatsCollector): Record<string, unknown> => {
  const actionStats = buildArrayStatsFieldResult(collector.actionDimensions);
  return {
    frame_index: finalizeNumericStatsAccumulator(collector.frameIndex),
    timestamp: finalizeNumericStatsAccumulator(collector.timestamp),
    task_index: finalizeNumericStatsAccumulator(collector.taskIndex),
    index: finalizeNumericStatsAccumulator(collector.datasetIndex),
    episode_index: finalizeNumericStatsAccumulator(collector.episodeIndex),
    "observation.state": actionStats,
    action: actionStats,
  };
};

const buildEpisodeStats = ({
  episodeIndex,
  datasetFromIndex,
  timestamps,
  actionVectors,
  taskIndex,
}: {
  episodeIndex: number;
  datasetFromIndex: number;
  timestamps: number[];
  actionVectors: number[][];
  taskIndex: number;
}): Record<EpisodeStatFieldName, V3StatsFieldResult> => {
  const collector = createV3StatsCollector();
  actionVectors.forEach((actionVector, frameIndex) => {
    addRowToV3StatsCollector(collector, {
      index: datasetFromIndex + frameIndex,
      episode_index: episodeIndex,
      frame_index: frameIndex,
      timestamp: timestamps[frameIndex] ?? 0,
      action: actionVector,
      "observation.state": actionVector,
      task_index: taskIndex,
    });
  });
  return computeV3Stats(collector) as Record<EpisodeStatFieldName, V3StatsFieldResult>;
};

const resolveEpisodeTaskNames = (episode: Episode, episodeIndex: number) => {
  const tasks = ((episode.metadata?.tasks as string[] | undefined) ?? []).filter(
    (task): task is string => typeof task === "string" && task.trim().length > 0
  );
  if (tasks.length > 0) {
    return tasks.map((task) => task.trim());
  }
  return [`${V3_DATASET_DEFAULT_TASK_PREFIX}-${episodeIndex}`];
};

const buildEpisodeDataForV3Internal = (
  episodes: Episode[],
  robotBaseName: string | undefined,
  robotName?: string | undefined,
  urdfJointOrder?: string[],
  {
    collectFlattenedRows = true,
    onFlattenedRow,
  }: BuildEpisodeDataOptions = {}
): BuildEpisodeDataResult => {
  const globalJointSet = new Set<string>();
  let totalFrames = 0;
  let representativeFps = 0;
  let representativeRobotType: string | undefined;
  let representativeEmbodimentRef: EmbodimentRef | undefined;
  let representativeRepresentationId: string = DEFAULT_INDEXED_REPRESENTATION_ID;
  let representativeNamingStatus: NamingStatus = NAMING_STATUS_UNNAMED;
  const taskIndexMap = new Map<string, number>();
  const tasksList: string[] = [];
  const flattenedRows: V3FlattenedRow[] = [];
  const episodeSummaries: V3PreparedEpisodeSummary[] = [];
  const {
    episodeIndexToSourceKey,
    representativeTreatmentManifest,
    sourceLineageRecords,
  } = collectDatasetArchiveLineage(episodes);

  let runningDatasetIndex = 0;

  episodes.forEach((episode) => {
    episode.frames.forEach((frame) => {
      Object.keys(frame.jointPositions).forEach((joint) => globalJointSet.add(joint));
    });
  });

  let globalJointOrder: string[];
  if (urdfJointOrder && urdfJointOrder.length > 0) {
    globalJointOrder = urdfJointOrder.filter((joint) => globalJointSet.has(joint));
    const urdfSet = new Set(urdfJointOrder);
    const missingJoints = Array.from(globalJointSet).filter(
      (joint) => !urdfSet.has(joint)
    );
    if (missingJoints.length > 0) {
      missingJoints.sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true })
      );
      globalJointOrder = [...globalJointOrder, ...missingJoints];
    }
  } else {
    globalJointOrder = Array.from(globalJointSet).sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true })
    );
  }

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
      if (episode.frames.length < 2) {
        return 0;
      }
      const start = episode.frames[0].timestamp;
      const end = episode.frames[episode.frames.length - 1].timestamp;
      if (end <= start) {
        return 0;
      }
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
    if (!representativeEmbodimentRef && episode.metadata?.embodiment_ref) {
      representativeEmbodimentRef = episode.metadata.embodiment_ref;
    }
    if (episode.metadata?.representation_id) {
      representativeRepresentationId = episode.metadata.representation_id;
    }
    if (episode.metadata?.naming_status) {
      representativeNamingStatus = episode.metadata.naming_status;
    } else if (jointOrder.length > 0) {
      representativeNamingStatus = inferNamingStatus(jointOrder);
    }

    const episodeTaskNames = resolveEpisodeTaskNames(episode, episodeIndex);
    episodeTaskNames.forEach((taskName) => {
      if (taskIndexMap.has(taskName)) {
        return;
      }
      taskIndexMap.set(taskName, taskIndexMap.size);
      tasksList.push(taskName);
    });
    const primaryTaskName = episodeTaskNames[0];
    if (!primaryTaskName) {
      throw new Error(`Episode ${episodeIndex + 1} is missing a primary task name`);
    }
    const primaryTaskIndex = taskIndexMap.get(primaryTaskName);
    if (primaryTaskIndex === undefined) {
      throw new Error(`Episode ${episodeIndex + 1} task index registration failed`);
    }

    const startIndex = runningDatasetIndex;
    const timestamps: number[] = [];
    const actionVectors: number[][] = [];

    episode.frames.forEach((frame, frameIndex) => {
      const actionVector = jointOrder.map((joint) => frame.jointPositions[joint] ?? 0);
      const row: V3FlattenedRow = {
        index: runningDatasetIndex,
        episode_index: episodeIndex,
        frame_index: frameIndex,
        timestamp: frame.timestamp / 1000,
        action: actionVector,
        "observation.state": actionVector,
        task_index: primaryTaskIndex,
      };
      timestamps.push(row.timestamp);
      actionVectors.push(actionVector);
      if (collectFlattenedRows) {
        flattenedRows.push(row);
      }
      onFlattenedRow?.(row);
      runningDatasetIndex += 1;
    });

    const endIndexExclusive = runningDatasetIndex;
    const episodeSummaryIndex = episodeSummaries.length;
    episodeSummaries.push({
      episode_index: episodeIndex,
      "data/chunk_index": Math.floor(startIndex / V3_DATASET_DATA_ROWS_PER_CHUNK),
      "data/file_index": V3_DATASET_PRIMARY_FILE_INDEX,
      dataset_from_index: startIndex,
      dataset_to_index: endIndexExclusive,
      tasks: episodeTaskNames,
      length: episode.frames.length,
      "meta/episodes/chunk_index": Math.floor(
        episodeSummaryIndex / V3_DATASET_EPISODES_PER_CHUNK
      ),
      "meta/episodes/file_index": V3_DATASET_PRIMARY_FILE_INDEX,
      task_index: primaryTaskIndex,
      statsByField: buildEpisodeStats({
        episodeIndex,
        datasetFromIndex: startIndex,
        timestamps,
        actionVectors,
        taskIndex: primaryTaskIndex,
      }),
    });

    totalFrames += episode.frames.length;
  });

  return {
    globalJointOrder,
    flattenedRows,
    episodeSummaries,
    episodeIndexToSourceKey,
    tasksList,
    totalFrames,
    representativeFps: representativeFps || 1000 / RECORDING_INTERVAL_MS,
    representativeRobotType: representativeRobotType ?? robotName ?? robotBaseName ?? "unknown",
    representativeEmbodimentRef,
    representativeRepresentationId,
    representativeNamingStatus,
    representativeTreatmentManifest,
    sourceLineageRecords,
  };
};

export const buildEpisodeDataForV3 = (
  episodes: Episode[],
  robotBaseName: string | undefined,
  robotName?: string | undefined,
  urdfJointOrder?: string[]
) =>
  buildEpisodeDataForV3Internal(episodes, robotBaseName, robotName, urdfJointOrder, {
    collectFlattenedRows: true,
  });

function* iterateV3FlattenedRows({
  episodes,
  episodeSummaries,
  globalJointOrder,
}: {
  episodes: Episode[];
  episodeSummaries: V3PreparedEpisodeSummary[];
  globalJointOrder: string[];
}) {
  let summaryIndex = 0;
  for (const episode of episodes) {
    if (episode.frames.length === 0) {
      continue;
    }
    const summary = episodeSummaries[summaryIndex];
    if (!summary) {
      throw new Error("Missing episode summary while streaming v3 dataset rows");
    }
    const jointOrder =
      Array.isArray(episode.metadata?.joint_names) &&
      episode.metadata.joint_names.length > 0
        ? (episode.metadata.joint_names as string[])
        : globalJointOrder;
    for (const [frameIndex, frame] of episode.frames.entries()) {
      const actionVector = jointOrder.map((joint) => frame.jointPositions[joint] ?? 0);
      yield {
        index: summary.dataset_from_index + frameIndex,
        episode_index: summary.episode_index,
        frame_index: frameIndex,
        timestamp: frame.timestamp / 1000,
        action: actionVector,
        "observation.state": actionVector,
        task_index: summary.task_index,
      } satisfies V3FlattenedRow;
    }
    summaryIndex += 1;
  }
}

const writeV3DataChunk = async ({
  chunkFolder,
  rows,
  writeParquetFile,
}: {
  chunkFolder: JSZipInstance;
  rows: V3FlattenedRow[];
  writeParquetFile: WriteParquetFile;
}) => {
  const flattenedContent = await writeParquetFile([
    {
      name: "observation.state",
      type: "list<float32>",
      values: rows.map((row) => row["observation.state"]),
    },
    {
      name: "action",
      type: "list<float32>",
      values: rows.map((row) => row.action),
    },
    {
      name: "episode_index",
      type: "int64",
      values: rows.map((row) => row.episode_index),
    },
    {
      name: "frame_index",
      type: "int64",
      values: rows.map((row) => row.frame_index),
    },
    {
      name: "timestamp",
      type: "float32",
      values: rows.map((row) => row.timestamp),
    },
    {
      name: "index",
      type: "int64",
      values: rows.map((row) => row.index),
    },
    {
      name: "task_index",
      type: "int64",
      values: rows.map((row) => row.task_index),
    },
  ]);
  chunkFolder.file(
    buildV3ArchiveParquetFileName(V3_DATASET_PRIMARY_FILE_INDEX),
    flattenedContent
  );
};

const buildStatsColumnType = (
  fieldName: EpisodeStatFieldName,
  statName: (typeof STATS_VALUE_FIELDS)[number]
) => {
  if (statName === "count") {
    return "list<int64>" as const;
  }
  if (fieldName === "action" || fieldName === "observation.state" || statName === "mean" || statName === "std" || fieldName === "timestamp") {
    return "list<float64>" as const;
  }
  return "list<int64>" as const;
};

const writeV3EpisodeChunk = async ({
  episodesFolder,
  chunkIndex,
  rows,
  writeParquetFile,
}: {
  episodesFolder: JSZipInstance;
  chunkIndex: number;
  rows: V3PreparedEpisodeSummary[];
  writeParquetFile: WriteParquetFile;
}) => {
  const chunkFolder = episodesFolder.folder(`chunk-${formatV3ArchiveIndex(chunkIndex)}`);
  if (!chunkFolder) {
    throw new Error(
      `Failed to create meta/episodes/chunk-${formatV3ArchiveIndex(chunkIndex)} directory`
    );
  }

  const columns = [
    {
      name: "episode_index",
      type: "int64" as const,
      values: rows.map((row) => row.episode_index),
    },
    {
      name: "data/chunk_index",
      type: "int64" as const,
      values: rows.map((row) => row["data/chunk_index"]),
    },
    {
      name: "data/file_index",
      type: "int64" as const,
      values: rows.map((row) => row["data/file_index"]),
    },
    {
      name: "dataset_from_index",
      type: "int64" as const,
      values: rows.map((row) => row.dataset_from_index),
    },
    {
      name: "dataset_to_index",
      type: "int64" as const,
      values: rows.map((row) => row.dataset_to_index),
    },
    {
      name: "tasks",
      type: "list<utf8>" as const,
      values: rows.map((row) => row.tasks),
    },
    {
      name: "length",
      type: "int64" as const,
      values: rows.map((row) => row.length),
    },
    ...EPISODE_STATS_FIELD_ORDER.flatMap((fieldName) =>
      STATS_VALUE_FIELDS.map((statName) => ({
        name: `stats/${fieldName}/${statName}`,
        type: buildStatsColumnType(fieldName, statName),
        values: rows.map((row) => row.statsByField[fieldName]?.[statName] ?? [0]),
      }))
    ),
    {
      name: "meta/episodes/chunk_index",
      type: "int64" as const,
      values: rows.map((row) => row["meta/episodes/chunk_index"]),
    },
    {
      name: "meta/episodes/file_index",
      type: "int64" as const,
      values: rows.map((row) => row["meta/episodes/file_index"]),
    },
  ];

  const parquetContent = await writeParquetFile(columns);
  chunkFolder.file(
    buildV3ArchiveParquetFileName(V3_DATASET_PRIMARY_FILE_INDEX),
    parquetContent
  );
};

const buildJointFeatureNames = (jointNames: string[]) => ({
  [V3_DATASET_JOINT_FEATURE_GROUP]: jointNames,
});

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
  const writeParquetFile = await loadWriteParquetFile();
  const datasetFolder = zip.folder(datasetName);
  if (!datasetFolder) {
    throw new Error("Failed to initialize dataset archive");
  }

  const metaFolder = datasetFolder.folder("meta");
  const dataFolder = datasetFolder.folder("data");
  const episodesFolder = metaFolder?.folder("episodes");
  if (!metaFolder || !dataFolder || !episodesFolder) {
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
    const jointSummary = new Map<
      string,
      { violations: number; clamped: number; shiftOffset: number | null }
    >();

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

  const {
    globalJointOrder,
    episodeSummaries,
    tasksList,
    totalFrames,
    representativeFps,
    representativeRobotType,
  } = buildEpisodeDataForV3Internal(
    episodesForExport,
    robotBaseName,
    robotName,
    urdfJointOrder,
    { collectFlattenedRows: false }
  );

  const statsCollector = createV3StatsCollector();
  let pendingDataChunk: V3FlattenedRow[] = [];
  let dataChunkCount = 0;
  const flushPendingDataChunk = async () => {
    if (pendingDataChunk.length === 0) {
      return;
    }
    const chunkFolder = dataFolder.folder(`chunk-${formatV3ArchiveIndex(dataChunkCount)}`);
    if (!chunkFolder) {
      throw new Error(
        `Failed to create data/chunk-${formatV3ArchiveIndex(dataChunkCount)} directory`
      );
    }
    await writeV3DataChunk({
      chunkFolder,
      rows: pendingDataChunk,
      writeParquetFile,
    });
    pendingDataChunk = [];
    dataChunkCount += 1;
  };

  for (const row of iterateV3FlattenedRows({
    episodes: episodesForExport,
    episodeSummaries,
    globalJointOrder,
  })) {
    addRowToV3StatsCollector(statsCollector, row);
    pendingDataChunk.push(row);
    if (pendingDataChunk.length >= V3_DATASET_DATA_ROWS_PER_CHUNK) {
      await flushPendingDataChunk();
    }
  }
  await flushPendingDataChunk();

  const infoJson = {
    codebase_version: V3_DATASET_CODEBASE_VERSION,
    robot_type: representativeRobotType,
    total_episodes: episodeSummaries.length,
    total_frames: totalFrames,
    total_tasks: tasksList.length,
    chunks_size: V3_DATASET_DATA_ROWS_PER_CHUNK,
    files_size_in_mb: V3_DATASET_DEFAULT_FILES_SIZE_IN_MB,
    fps: representativeFps,
    splits: {
      [V3_DATASET_DEFAULT_SPLIT_NAME]: `0:${episodeSummaries.length}`,
    },
    data_path: V3_DATASET_DATA_PATH_TEMPLATE,
    video_path: V3_DATASET_NO_VIDEO_PATH,
    features: {
      "observation.state": {
        dtype: "float32",
        shape: [globalJointOrder.length],
        names: buildJointFeatureNames(globalJointOrder),
        fps: representativeFps,
      },
      action: {
        dtype: "float32",
        shape: [globalJointOrder.length],
        names: buildJointFeatureNames(globalJointOrder),
        fps: representativeFps,
      },
      episode_index: {
        dtype: "int64",
        shape: [1],
        names: null,
        fps: representativeFps,
      },
      frame_index: {
        dtype: "int64",
        shape: [1],
        names: null,
        fps: representativeFps,
      },
      timestamp: {
        dtype: "float32",
        shape: [1],
        names: null,
        fps: representativeFps,
      },
      index: {
        dtype: "int64",
        shape: [1],
        names: null,
        fps: representativeFps,
      },
      task_index: {
        dtype: "int64",
        shape: [1],
        names: null,
        fps: representativeFps,
      },
    },
    ...(limitCorrectionsInfo ? { limit_corrections: limitCorrectionsInfo } : {}),
  };

  metaFolder.file("info.json", JSON.stringify(infoJson, null, 2));
  metaFolder.file("stats.json", JSON.stringify(computeV3Stats(statsCollector), null, 2));

  const tasksParquetContent = await writeParquetFile([
    {
      name: "task",
      type: "utf8",
      values: tasksList,
    },
    {
      name: "task_index",
      type: "int64",
      values: tasksList.map((_, index) => index),
    },
  ]);
  metaFolder.file("tasks.parquet", tasksParquetContent);

  const episodeSummaryChunks = splitIntoChunks(
    episodeSummaries,
    V3_DATASET_EPISODES_PER_CHUNK
  );
  for (const [chunkIndex, episodeSummaryChunk] of episodeSummaryChunks.entries()) {
    await writeV3EpisodeChunk({
      episodesFolder,
      chunkIndex,
      rows: episodeSummaryChunk,
      writeParquetFile,
    });
  }
};
