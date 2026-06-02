import type { Episode } from "@/features/dataset/episodes";
import type { EpisodeMetadata } from "@/features/dataset/io/episodeTypes";
import { DATASET_SIGNAL_PROFILE_IDS } from "@/features/dataset/profiles/profileParams";

export type EpisodeSignalMode = "joint-only" | "base-twist" | "base-pose";

const BASE_TWIST_PROFILE_IDS = new Set<string>([
  DATASET_SIGNAL_PROFILE_IDS.mixed,
]);

const EPISODE_SIGNAL_MODE_LABELS: Record<EpisodeSignalMode, string> = {
  "joint-only": "joint-only",
  "base-twist": "base-twist",
  "base-pose": "base-pose",
};

const normalizeToken = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const hasWorldSnapshotIdentity = (
  ref: EpisodeMetadata["world_snapshot_ref"] | null | undefined
): ref is NonNullable<EpisodeMetadata["world_snapshot_ref"]> =>
  Boolean(
    ref &&
      normalizeToken(ref.package_id).length > 0 &&
      normalizeToken(ref.version).length > 0
  );

const resolveMetadataSignalBaseMode = (
  signalBaseMode: EpisodeMetadata["signal_base_mode"]
) => {
  if (signalBaseMode === "twist" || signalBaseMode === "pose") {
    return signalBaseMode;
  }
  return "none";
};

const hasEpisodeBasePose = (episode: Episode) => {
  if (episode.frames.some((frame) => Boolean(frame.basePose))) {
    return true;
  }
  const metadataBasePoses = episode.metadata?.base_poses;
  if (!Array.isArray(metadataBasePoses)) {
    return false;
  }
  return metadataBasePoses.some((pose) => Boolean(pose));
};

const isBaseTwistProfile = (signalProfileId: unknown) => {
  if (typeof signalProfileId !== "string") {
    return false;
  }
  return BASE_TWIST_PROFILE_IDS.has(normalizeToken(signalProfileId));
};

const formatWorldSnapshotRef = (
  ref: NonNullable<EpisodeMetadata["world_snapshot_ref"]>
) => `${String(ref.package_id)}@${String(ref.version)}`;

const worldSnapshotRefMatches = (
  expected: NonNullable<EpisodeMetadata["world_snapshot_ref"]>,
  active: NonNullable<EpisodeMetadata["world_snapshot_ref"]>
) =>
  normalizeToken(expected.package_id) === normalizeToken(active.package_id) &&
  normalizeToken(expected.version) === normalizeToken(active.version);

export const resolveEpisodeSignalMode = (episode: Episode): EpisodeSignalMode => {
  const metadataMode = resolveMetadataSignalBaseMode(
    episode.metadata?.signal_base_mode
  );
  if (metadataMode === "twist") {
    return "base-twist";
  }
  if (metadataMode === "pose") {
    return "base-pose";
  }
  if (!hasEpisodeBasePose(episode)) {
    return "joint-only";
  }
  if (isBaseTwistProfile(episode.metadata?.signal_profile_id)) {
    return "base-twist";
  }
  return "base-pose";
};

export const resolveEpisodeSignalModeLabel = (episode: Episode) =>
  EPISODE_SIGNAL_MODE_LABELS[resolveEpisodeSignalMode(episode)];

export const resolveEpisodeWorldSnapshotWarning = ({
  episode,
  activeWorldSnapshotRef,
}: {
  episode: Episode | null | undefined;
  activeWorldSnapshotRef?: EpisodeMetadata["world_snapshot_ref"] | null;
}): string | null => {
  const expectedRef = episode?.metadata?.world_snapshot_ref;
  if (!hasWorldSnapshotIdentity(expectedRef)) {
    return null;
  }
  if (!hasWorldSnapshotIdentity(activeWorldSnapshotRef)) {
    return null;
  }
  if (!worldSnapshotRefMatches(expectedRef, activeWorldSnapshotRef)) {
    return `world mismatch: expected ${formatWorldSnapshotRef(expectedRef)}`;
  }
  return null;
};
