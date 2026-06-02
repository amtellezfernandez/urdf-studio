import { resolveEpisodeSourceDescriptor } from "@/features/dataset/datasetLineage";
import {
  DATASET_SESSION_SCHEMA_VERSION,
  DATASET_SESSION_SOURCE_KIND_PARAMS,
} from "@/features/dataset/datasetSessionParams";
import type {
  DatasetSessionBridgeInput,
  DatasetSessionCreateRequest,
  DatasetSessionHfSourceDescriptor,
  DatasetSessionSourceKind,
} from "@/features/dataset/datasetSessionTypes";

const DATASET_SESSION_MIXED_SOURCE_KIND: DatasetSessionSourceKind =
  DATASET_SESSION_SOURCE_KIND_PARAMS.mixed;
const DATASET_SESSION_UNKNOWN_SOURCE_KIND: DatasetSessionSourceKind =
  DATASET_SESSION_SOURCE_KIND_PARAMS.unknown;
const DATASET_SESSION_RECORDED_SOURCE_KIND: DatasetSessionSourceKind =
  DATASET_SESSION_SOURCE_KIND_PARAMS.recorded;

const DATASET_SOURCE_KIND_MAP: Readonly<Record<string, DatasetSessionSourceKind>> =
  DATASET_SESSION_SOURCE_KIND_PARAMS.sourceKindMap;

export type DatasetSessionSyncPlan = {
  request: DatasetSessionCreateRequest | null;
  fingerprint: string | null;
};

const resolveSourceKind = (value: string | null | undefined): DatasetSessionSourceKind =>
  (value ? DATASET_SOURCE_KIND_MAP[value] : undefined) ?? DATASET_SESSION_UNKNOWN_SOURCE_KIND;

const resolveReviewableEpisodes = (episodes: DatasetSessionBridgeInput["episodes"]) =>
  episodes.filter((episode) => episode.frames.length > 0);

const resolveHfSourceDescriptor = (
  episodes: DatasetSessionBridgeInput["episodes"]
): DatasetSessionHfSourceDescriptor | null => {
  if (episodes.length === 0) {
    return null;
  }

  const firstEpisodeDescriptor = resolveEpisodeSourceDescriptor(episodes[0], "episode-1");
  if (resolveSourceKind(firstEpisodeDescriptor.sourceType) !== "hf") {
    return null;
  }
  const firstAdditional = episodes[0]?.metadata?.additional as Record<string, unknown> | undefined;
  const dataset =
    (typeof firstAdditional?.hfDatasetRepo === "string" && firstAdditional.hfDatasetRepo.trim()) ||
    firstEpisodeDescriptor.hfDatasetRepo ||
    null;
  const config =
    typeof firstAdditional?.hfConfig === "string" && firstAdditional.hfConfig.trim().length > 0
      ? firstAdditional.hfConfig.trim()
      : null;
  const split =
    typeof firstAdditional?.hfSplit === "string" && firstAdditional.hfSplit.trim().length > 0
      ? firstAdditional.hfSplit.trim()
      : null;

  if (!dataset || !config || !split) {
    return null;
  }

  const allEpisodesMatch = episodes.every((episode, index) => {
    const descriptor = resolveEpisodeSourceDescriptor(episode, `episode-${index + 1}`);
    if (resolveSourceKind(descriptor.sourceType) !== "hf") {
      return false;
    }
    const additional = episode.metadata?.additional as Record<string, unknown> | undefined;
    return (
      ((typeof additional?.hfDatasetRepo === "string" && additional.hfDatasetRepo.trim()) ||
        descriptor.hfDatasetRepo ||
        "") === dataset &&
      (typeof additional?.hfConfig === "string" ? additional.hfConfig.trim() : "") === config &&
      (typeof additional?.hfSplit === "string" ? additional.hfSplit.trim() : "") === split
    );
  });

  if (!allEpisodesMatch) {
    return null;
  }

  return {
    dataset,
    config,
    split,
    dataset_label: firstEpisodeDescriptor.sourceName ?? dataset,
    source_name: firstEpisodeDescriptor.sourceName ?? dataset,
  };
};

const resolveDatasetSourceDescriptor = ({
  episodes,
  datasetSources,
}: DatasetSessionBridgeInput): {
  sourceKind: DatasetSessionSourceKind;
  sourceName?: string;
  datasetLabel?: string;
} => {
  const explicitKinds = datasetSources
    .map((source) => resolveSourceKind(source.type))
    .filter((kind) => kind !== DATASET_SESSION_UNKNOWN_SOURCE_KIND);
  const uniqueKinds = Array.from(new Set(explicitKinds));

  if (uniqueKinds.length > 1) {
    return {
      sourceKind: DATASET_SESSION_MIXED_SOURCE_KIND,
      sourceName: "mixed",
      datasetLabel: "Mixed dataset",
    };
  }

  if (uniqueKinds.length === 1) {
    const latestSource = [...datasetSources].sort((left, right) => right.timestamp - left.timestamp)[0];
    return {
      sourceKind: uniqueKinds[0],
      sourceName: latestSource?.name?.trim() || undefined,
      datasetLabel: latestSource?.name?.trim() || undefined,
    };
  }

  const lineageKinds = episodes
    .map((episode, index) =>
      resolveSourceKind(
        resolveEpisodeSourceDescriptor(episode, `episode-${index + 1}`).sourceType
      )
    )
    .filter((kind) => kind !== DATASET_SESSION_UNKNOWN_SOURCE_KIND);
  const uniqueLineageKinds = Array.from(new Set(lineageKinds));

  if (uniqueLineageKinds.length > 1) {
    return {
      sourceKind: DATASET_SESSION_MIXED_SOURCE_KIND,
      sourceName: "mixed",
      datasetLabel: "Mixed dataset",
    };
  }

  if (uniqueLineageKinds.length === 1) {
    const firstSourceName = episodes
      .map((episode, index) =>
        resolveEpisodeSourceDescriptor(episode, `episode-${index + 1}`).sourceName
      )
      .find((value): value is string => typeof value === "string" && value.trim().length > 0);
    return {
      sourceKind: uniqueLineageKinds[0],
      sourceName: firstSourceName,
      datasetLabel: firstSourceName,
    };
  }

  return {
    sourceKind: DATASET_SESSION_RECORDED_SOURCE_KIND,
    sourceName: undefined,
    datasetLabel: "Recorded dataset",
  };
};

export const buildDatasetSessionCreateRequest = ({
  episodes,
  datasetSources,
}: DatasetSessionBridgeInput): DatasetSessionCreateRequest => {
  const reviewableEpisodes = resolveReviewableEpisodes(episodes);
  const { sourceKind, sourceName, datasetLabel } = resolveDatasetSourceDescriptor({
    episodes,
    datasetSources,
  });
  const hfSource = resolveHfSourceDescriptor(episodes);

  if (hfSource) {
    return {
      schema_version: DATASET_SESSION_SCHEMA_VERSION,
      dataset_label: datasetLabel ?? hfSource.dataset_label,
      source_kind: "hf",
      source_name: sourceName ?? hfSource.source_name,
      dataset_metadata: {},
      episodes: [],
      hf_source: hfSource,
    };
  }

  return {
    schema_version: DATASET_SESSION_SCHEMA_VERSION,
    dataset_label: datasetLabel,
    source_kind: sourceKind,
    source_name: sourceName,
    dataset_metadata: {},
    episodes: reviewableEpisodes.map((episode) => {
      const descriptor = resolveEpisodeSourceDescriptor(episode);
      const episodeSourceKind = resolveSourceKind(descriptor.sourceType);
      return {
        episode_id: episode.id,
        episode_number: episode.number,
        ...(episodeSourceKind !== DATASET_SESSION_UNKNOWN_SOURCE_KIND
          ? { source_kind: episodeSourceKind }
          : {}),
        ...(descriptor.sourceName ? { source_name: descriptor.sourceName } : {}),
        frames: episode.frames.map((frame) => ({
          timestamp: frame.timestamp,
          joint_positions: frame.jointPositions,
          ...(frame.basePose ? { base_pose: frame.basePose } : {}),
        })),
        metadata: episode.metadata,
      };
    }),
  };
};

export const resolveDatasetSessionSyncPlan = ({
  episodes,
  datasetSources,
}: DatasetSessionBridgeInput): DatasetSessionSyncPlan => {
  const request = buildDatasetSessionCreateRequest({
    episodes,
    datasetSources,
  });
  if (request.hf_source || request.episodes.length > 0) {
    return {
      request,
      fingerprint: createDatasetSessionFingerprint({
        episodes,
        datasetSources,
      }),
    };
  }
  return {
    request: null,
    fingerprint: null,
  };
};

export const createDatasetSessionFingerprint = ({
  episodes,
  datasetSources,
}: DatasetSessionBridgeInput) => {
  const hfSource = resolveHfSourceDescriptor(episodes);
  const sourcePart = datasetSources
    .map((source) => `${source.type}:${source.name}:${source.timestamp}`)
    .join("|");
  if (hfSource) {
    return `${sourcePart}::hf:${hfSource.dataset}:${hfSource.config}:${hfSource.split}`;
  }
  const episodePart = resolveReviewableEpisodes(episodes)
    .map((episode) => {
      const lastTimestamp =
        episode.frames.length > 0
          ? episode.frames[episode.frames.length - 1]?.timestamp ?? 0
          : Number(episode.metadata?.episode_length_sec ?? 0);
      return `${episode.id}:${episode.frames.length}:${lastTimestamp}:${episode.metadata?.robot_type ?? ""}`;
    })
    .join("|");
  return `${sourcePart}::${episodePart}`;
};
