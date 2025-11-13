import type { EpisodeFrame, EpisodeMetadata } from "./episodeTypes";

export interface EpisodeJsonParseOptions {
  allowedJoints?: Iterable<string>;
}

export interface EpisodeJsonEpisode {
  id?: string;
  frames: EpisodeFrame[];
  jointOrder: string[];
  metadata?: EpisodeMetadata;
}

export interface EpisodeJsonParseResult {
  frames?: EpisodeFrame[];
  jointOrder?: string[];
  metadata?: EpisodeMetadata;
  episodes?: EpisodeJsonEpisode[];
  error?: string;
}

interface LerobotEpisodeDocument {
  episode_index: number;
  task_index?: number;
  robot_type?: string;
  num_frames: number;
  fps: number;
  data: {
    timestamp?: Array<number | string>;
    frame_index?: Array<number | string>;
    action?: Array<Array<number | string>>;
    "observation.state"?: Array<Array<number | string>>;
    [key: string]: unknown;
  };
  videos?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

const FORMAT_ID = "urdfstudio-motions";

const computeFpsFromFrames = (frames: EpisodeFrame[]) => {
  if (frames.length < 2) return 0;
  const start = frames[0].timestamp;
  const end = frames[frames.length - 1].timestamp;
  if (end <= start) return 0;
  return (frames.length - 1) / ((end - start) / 1000);
};

const buildDatasetEpisodeDocument = (
  frames: EpisodeFrame[],
  jointOrder: string[],
  metadata: EpisodeMetadata = {}
): LerobotEpisodeDocument => {
  const sanitizedJointOrder =
    jointOrder.length > 0
      ? jointOrder
      : Array.from(
          new Set(frames.flatMap((frame) => Object.keys(frame.joints)))
        ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const actionRows = frames.map((frame) =>
    sanitizedJointOrder.map((joint) => frame.joints[joint] ?? 0)
  );

  const timestampsSec = frames.map((frame) => frame.timestamp / 1000);

  const frameIndices = frames.map((_, index) => index);

  const computedFps =
    metadata.fps && metadata.fps > 0
      ? metadata.fps
      : (() => {
          const fps = computeFpsFromFrames(frames);
          return fps > 0 ? fps : 1000 / 20;
        })();

  const videos =
    (metadata.videos as Record<string, unknown> | undefined) ?? {};

  const {
    episode_index,
    episodeNumber,
    task_index,
    robot_type,
    episode_length_sec,
    recorded_at,
    codebase_version,
    joint_names,
    createdAt,
    ...additionalMetadata
  } = metadata;

  const documentMetadata: Record<string, unknown> = {
    episode_length_sec:
      episode_length_sec ??
      (timestampsSec[timestampsSec.length - 1] ?? 0),
    recorded_at: recorded_at ?? new Date().toISOString(),
    codebase_version: codebase_version ?? "v3-compatible",
    joint_names: joint_names ?? sanitizedJointOrder,
    tasks:
      metadata.tasks ??
      (metadata.task_index !== undefined
        ? [`task_${metadata.task_index}`]
        : []),
    ...additionalMetadata,
  };

  if (createdAt !== undefined) {
    documentMetadata.createdAt = createdAt;
  }

  return {
    episode_index: episode_index ?? (episodeNumber ?? 1) - 1,
    task_index: task_index ?? 0,
    robot_type: robot_type ?? "unknown",
    num_frames: frames.length,
    fps: computedFps,
    data: {
      timestamp: timestampsSec,
      frame_index: frameIndices,
      action: actionRows,
      "observation.state": actionRows,
    },
    videos,
    metadata: documentMetadata,
  };
};

export const serializeEpisodeJson = (
  frames: EpisodeFrame[],
  jointOrder: string[],
  metadata?: EpisodeMetadata
) => {
  const document = buildDatasetEpisodeDocument(frames, jointOrder, metadata);
  return JSON.stringify(document, null, 2);
};

export const serializeEpisodeCollectionJson = (
  episodes: EpisodeJsonEpisode[],
  metadata?: EpisodeMetadata
) => {
  const episodeDocs = episodes.map((episode) => {
    const document = buildDatasetEpisodeDocument(
      episode.frames,
      episode.jointOrder,
      episode.metadata
    );
    if (episode.id) {
      document.metadata = {
        ...(document.metadata ?? {}),
        episode_id: episode.id,
      };
    }
    return document;
  });

  let runningIndex = 0;
  const episodeSummaries = episodeDocs.map((doc) => {
    const fromIndex = runningIndex;
    const toIndex = runningIndex + doc.num_frames - 1;
    runningIndex = toIndex + 1;
    return {
      episode_index: doc.episode_index,
      tasks:
        (doc.metadata?.tasks as string[] | undefined) ?? [],
      length: doc.num_frames,
      dataset_from_index: fromIndex,
      dataset_to_index: toIndex,
    };
  });

  const totalFrames = episodeDocs.reduce(
    (sum, doc) => sum + doc.num_frames,
    0
  );

  const jointNames =
    episodes[0]?.metadata?.joint_names ??
    episodeDocs[0]?.metadata?.joint_names ??
    [];

  const inferredJointCount = jointNames.length;

  const info = {
    codebase_version:
      metadata?.codebase_version ??
      episodeDocs[0]?.metadata?.codebase_version ??
      "v3-compatible",
    fps:
      metadata?.fps ??
      episodeDocs[0]?.fps ??
      (episodes[0]?.metadata?.fps ?? 1000 / 20),
    features: {
      "observation.state": {
        dtype: "float32",
        shape: [inferredJointCount],
      },
      action: {
        dtype: "float32",
        shape: [inferredJointCount],
      },
      timestamp: {
        dtype: "float32",
        shape: [],
      },
      frame_index: {
        dtype: "int64",
        shape: [],
      },
    },
    total_episodes: episodeDocs.length,
    total_frames: totalFrames,
    robot_type:
      metadata?.robot_type ??
      episodeDocs[0]?.robot_type ??
      "unknown",
    data_path:
      metadata?.data_path ?? "data/chunk-{chunk:03d}.parquet",
    video_path:
      metadata?.video_path ??
      "videos/{camera}/chunk-{chunk:03d}/file-{file:03d}.mp4",
  };

  const tasksMap = new Map<string, number>();
  if (metadata && Array.isArray(metadata.tasks)) {
    metadata.tasks.forEach((task, index) => {
      if (typeof task === "string" && !tasksMap.has(task)) {
        tasksMap.set(task, index);
      }
    });
  }
  episodeSummaries.forEach((summary) => {
    summary.tasks.forEach((task, index) => {
      if (!tasksMap.has(task)) {
        tasksMap.set(task, index);
      }
    });
  });

  const tasksSummary: Record<string, number> = {};
  tasksMap.forEach((value, key) => {
    tasksSummary[key] = value;
  });

  const collection = {
    meta: {
      info,
      episodes: episodeSummaries,
      stats: metadata?.stats ?? {},
      tasks: tasksSummary,
    },
    episodes: episodeDocs,
  };

  return JSON.stringify(collection, null, 2);
};

const isDatasetEpisodeDocument = (
  value: unknown
): value is LerobotEpisodeDocument => {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as Record<string, unknown>;
  return (
    typeof doc.episode_index === "number" &&
    typeof doc.num_frames === "number" &&
    typeof doc.fps === "number" &&
    typeof doc.data === "object" &&
    doc.data !== null
  );
};

const parseDatasetEpisodeDocument = (
  doc: LerobotEpisodeDocument,
  options: EpisodeJsonParseOptions
): EpisodeJsonEpisode => {
  const allowedSet =
    options.allowedJoints !== undefined
      ? new Set(Array.from(options.allowedJoints))
      : null;

  const metadata = doc.metadata ?? {};

  let jointOrder =
    (metadata.joint_names as string[] | undefined) ?? undefined;
  if (!Array.isArray(jointOrder) || jointOrder.length === 0) {
    const maxLength = Math.max(
      doc.data.action?.[0]?.length ?? 0,
      doc.data["observation.state"]?.[0]?.length ?? 0
    );
    jointOrder = Array.from({ length: maxLength }, (_, index) =>
      `joint_${index + 1}`
    );
  }

  const filteredJointOrder: string[] = [];
  jointOrder.forEach((joint) => {
    if (!allowedSet || allowedSet.has(joint)) {
      filteredJointOrder.push(joint);
    }
  });

  const actionRows =
    doc.data.action ??
    doc.data["observation.state"] ??
    Array.from({ length: doc.num_frames }, () => []);

  const timestampsSec =
    doc.data.timestamp ??
    (Array.isArray(doc.data.frame_index) && doc.fps > 0
      ? doc.data.frame_index.map((value) =>
          typeof value === "number"
            ? value / doc.fps
            : parseFloat(value as string) / doc.fps
        )
      : actionRows.map((_, index) => index / (doc.fps || 1)));

  const frames: EpisodeFrame[] = actionRows.map((row, index) => {
    const joints: Record<string, number> = {};
    filteredJointOrder.forEach((joint, jointIndex) => {
      const rawValue = row?.[jointIndex];
      const value =
        typeof rawValue === "number"
          ? rawValue
          : rawValue !== undefined
          ? parseFloat(String(rawValue))
          : 0;
      joints[joint] = value;
    });

    const timestampSec =
      typeof timestampsSec?.[index] === "number"
        ? (timestampsSec[index] as number)
        : timestampsSec?.[index] !== undefined
        ? parseFloat(String(timestampsSec[index]))
        : index / (doc.fps || 1);

    return {
      timestamp: timestampSec * 1000,
      joints,
    };
  });

  const resultMetadata: EpisodeMetadata = {
    episode_index: doc.episode_index,
    episodeNumber: doc.episode_index + 1,
    task_index: doc.task_index ?? 0,
    tasks:
      Array.isArray(metadata.tasks) && metadata.tasks.length > 0
        ? (metadata.tasks as string[])
        : doc.task_index !== undefined
        ? [`task_${doc.task_index}`]
        : [],
    robot_type: doc.robot_type ?? "unknown",
    fps: doc.fps,
    joint_names: filteredJointOrder,
    videos: doc.videos ?? {},
    episode_length_sec:
      (metadata.episode_length_sec as number | undefined) ??
      (frames[frames.length - 1]?.timestamp ?? 0) / 1000,
    recorded_at: metadata.recorded_at as string | undefined,
    codebase_version: metadata.codebase_version as string | undefined,
    createdAt:
      (metadata.createdAt as number | undefined) ??
      (metadata.recorded_at ? Date.parse(String(metadata.recorded_at)) : undefined),
    ...metadata,
  };

  return {
    frames,
    jointOrder: filteredJointOrder,
    metadata: resultMetadata,
  };
};

const parseLegacyFormat = (
  parsed: Record<string, unknown>,
  options: EpisodeJsonParseOptions
): EpisodeJsonParseResult => {
  const kind = (parsed as { kind?: string }).kind;
  const episodesValue = (parsed as { episodes?: unknown }).episodes;

  const buildEpisodeFromLegacyDocument = (
    doc: {
      joints: EpisodeFrame["joints"][];
      frames: EpisodeFrame[];
      metadata?: EpisodeMetadata;
    }
  ): EpisodeJsonEpisode => {
    const allowedSet =
      options.allowedJoints !== undefined
        ? new Set(Array.from(options.allowedJoints))
        : null;

    const jointNames = doc.joints ?? [];
    const frames: EpisodeFrame[] = doc.frames.map((frame) => {
      if (!allowedSet) {
        return frame;
      }
      const filtered: Record<string, number> = {};
      for (const [name, value] of Object.entries(frame.joints)) {
        if (allowedSet.has(name)) {
          filtered[name] = value;
        }
      }
      return { timestamp: frame.timestamp, joints: filtered };
    });

    const jointOrder =
      jointNames.length > 0
        ? jointNames
        : Array.from(
            new Set(frames.flatMap((frame) => Object.keys(frame.joints)))
          );

    return {
      frames,
      jointOrder,
      metadata: doc.metadata,
    };
  };

  if (
    kind === "collection" ||
    (Array.isArray(episodesValue) &&
      episodesValue.every((episode) => typeof episode === "object"))
  ) {
    const legacyEpisodes = (episodesValue as Array<Record<string, unknown>>) ?? [];
    const episodes = legacyEpisodes.map((episode) =>
      buildEpisodeFromLegacyDocument({
        joints: (episode.joints as string[]) ?? [],
        frames: (episode.frames as EpisodeFrame[]) ?? [],
        metadata: episode.metadata as EpisodeMetadata | undefined,
      })
    );
    return {
      episodes,
      metadata: parsed.metadata as EpisodeMetadata | undefined,
    };
  }

  const joints = (parsed.joints as string[]) ?? [];
  const frames = (parsed.frames as EpisodeFrame[]) ?? [];
  const metadata = parsed.metadata as EpisodeMetadata | undefined;

  const episode = buildEpisodeFromLegacyDocument({
    joints,
    frames,
    metadata,
  });

  return {
    frames: episode.frames,
    jointOrder: episode.jointOrder,
    metadata: episode.metadata,
  };
};

export const parseEpisodeJson = (
  rawText: string,
  options: EpisodeJsonParseOptions = {}
): EpisodeJsonParseResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { error: "Invalid JSON animation data" };
  }

  if (isDatasetEpisodeDocument(parsed)) {
    const episode = parseDatasetEpisodeDocument(parsed, options);
    return {
      frames: episode.frames,
      jointOrder: episode.jointOrder,
      metadata: episode.metadata,
    };
  }

  if (typeof parsed === "object" && parsed !== null) {
    const possibleEpisodes = (parsed as { episodes?: unknown }).episodes;
    if (Array.isArray(possibleEpisodes)) {
      const datasetEpisodes = possibleEpisodes.filter((episode) =>
        isDatasetEpisodeDocument(episode)
      ) as LerobotEpisodeDocument[];

      if (datasetEpisodes.length === possibleEpisodes.length) {
        const episodes = datasetEpisodes.map((episode) =>
          parseDatasetEpisodeDocument(episode, options)
        );
        const metaInfo =
          (parsed as { meta?: { info?: EpisodeMetadata } }).meta?.info ??
          (parsed as { metadata?: EpisodeMetadata }).metadata;

        return {
          episodes,
          metadata: metaInfo,
        };
      }
    }
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "format" in parsed &&
    (parsed as { format?: unknown }).format === FORMAT_ID
  ) {
    return parseLegacyFormat(parsed as Record<string, unknown>, options);
  }

  return { error: "Unsupported animation format" };
};

