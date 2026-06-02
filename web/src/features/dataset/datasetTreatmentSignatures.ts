import { DATASET_TREATMENT_SIGNATURE_PARAMS } from "@/features/dataset/datasetTreatmentSignatureParams";
import type { EpisodeJsonEpisode } from "@/features/dataset/io/episodeFormat";
import type { Episode } from "@/features/dataset/episodes";
import type { DatasetSignalProfileResolution } from "@/features/dataset/profiles";
import {
  resolveHfSignalValuesFromRow,
  type HfSignalField,
} from "@/features/layout/sidebar/hfSignalSelection";
import { toFiniteNumber } from "@/features/layout/sidebar/sidebarHelpers";

export const DATASET_CONTENT_SIGNATURE_KIND =
  DATASET_TREATMENT_SIGNATURE_PARAMS.contentSignatureKind;

export type DatasetContentSignatureFrame = {
  timestamp: number;
  joints: Record<string, number>;
};

export type DatasetContentSignatureEpisode = {
  episode_index: number;
  frames: DatasetContentSignatureFrame[];
};

export type DatasetContentSignature = {
  kind: typeof DATASET_CONTENT_SIGNATURE_KIND;
  episodes: DatasetContentSignatureEpisode[];
};

const compareJointNames = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

const toSortedJointsRecord = (joints: Record<string, number>) =>
  Object.fromEntries(
    Object.keys(joints)
      .sort(compareJointNames)
      .map((jointName) => [jointName, joints[jointName] ?? 0])
  );

export const buildEpisodeCollectionContentSignature = (
  episodes: Episode[] | EpisodeJsonEpisode[]
): DatasetContentSignature => ({
  kind: DATASET_CONTENT_SIGNATURE_KIND,
  episodes: [...episodes]
    .sort((left, right) => {
      const leftIndex =
        typeof left.metadata?.episode_index === "number" ? left.metadata.episode_index : 0;
      const rightIndex =
        typeof right.metadata?.episode_index === "number" ? right.metadata.episode_index : 0;
      return leftIndex - rightIndex;
    })
    .map((episode) => ({
      episode_index:
        typeof episode.metadata?.episode_index === "number"
          ? episode.metadata.episode_index
          : 0,
      frames: episode.frames.map((frame) => ({
        timestamp: frame.timestamp,
        joints: toSortedJointsRecord(frame.joints ?? frame.jointPositions ?? {}),
      })),
    })),
});

const toHfNumericValueArray = (
  row: Record<string, unknown>,
  preferredField?: HfSignalField | null
) => {
  const { values: dataArray } = resolveHfSignalValuesFromRow(row, preferredField);
  return dataArray.map((value) =>
    typeof value === "number" && Number.isFinite(value)
      ? value
      : Number.isFinite(Number(value))
        ? Number(value)
        : 0
  );
};

export const buildHfEpisodeCollectionContentSignature = ({
  rows,
  signalProfile,
  preferredField,
}: {
  rows: Array<Record<string, unknown>>;
  signalProfile: DatasetSignalProfileResolution;
  preferredField?: HfSignalField | null;
}): DatasetContentSignature => {
  const episodesByIndex = new Map<
    number,
    Array<{
      timestamp: number;
      frameIndex: number;
      joints: Record<string, number>;
    }>
  >();

  rows.forEach((row, rowIndex) => {
    const episodeIndex = Math.trunc(toFiniteNumber(row.episode_index, rowIndex));
    const frameIndex = Math.trunc(toFiniteNumber(row.frame_index, rowIndex));
    const timestamp =
      toFiniteNumber(row.timestamp, 0) *
      DATASET_TREATMENT_SIGNATURE_PARAMS.hfTimestampScaleMs;
    const values = toHfNumericValueArray(row, preferredField);
    const joints = toSortedJointsRecord(
      Object.fromEntries(
        signalProfile.jointChannels.map((channel) => [
          channel.normalizedName,
          values[channel.index] ?? 0,
        ])
      )
    );
    const frames = episodesByIndex.get(episodeIndex) ?? [];
    frames.push({ timestamp, frameIndex, joints });
    episodesByIndex.set(episodeIndex, frames);
  });

  return {
    kind: DATASET_CONTENT_SIGNATURE_KIND,
    episodes: Array.from(episodesByIndex.entries())
      .sort(([leftEpisodeIndex], [rightEpisodeIndex]) => leftEpisodeIndex - rightEpisodeIndex)
      .map(([episodeIndex, frames]) => ({
        episode_index: episodeIndex,
        frames: [...frames]
          .sort((left, right) =>
            left.frameIndex === right.frameIndex
              ? left.timestamp - right.timestamp
              : left.frameIndex - right.frameIndex
          )
          .map(({ timestamp, joints }) => ({
            timestamp,
            joints,
          })),
      })),
  };
};
