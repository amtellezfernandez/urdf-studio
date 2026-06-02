export const EPISODE_BASE_SIGNAL_SUGGESTION_ORDER = [
  "x_mm",
  "y_mm",
  "theta",
] as const;

const BASE_SIGNAL_FULL_PRECISION_NAME_PATTERN = /^(x_mm|y_mm|theta|theta_deg|theta_rad|base_x_mm|base_y_mm|base_theta)$/i;

export const normalizeEpisodeSignalName = (name: string) =>
  name.trim().toLowerCase();

export const isEpisodeBaseSignalName = (name: string) =>
  BASE_SIGNAL_FULL_PRECISION_NAME_PATTERN.test(name);

export const hasDifferentEpisodeSignalMapping = ({
  signalName,
  mappedJointName,
}: {
  signalName: string;
  mappedJointName: string | null;
}) => {
  if (!mappedJointName) {
    return true;
  }
  return (
    normalizeEpisodeSignalName(signalName) !==
    normalizeEpisodeSignalName(mappedJointName)
  );
};

export type EpisodeSignalRelation =
  | "base-planar"
  | "mapped-joint"
  | "aux-unmapped";

const EPISODE_SIGNAL_RELATION_LABELS: Record<EpisodeSignalRelation, string> = {
  "base-planar": "base",
  "mapped-joint": "joint",
  "aux-unmapped": "aux",
};

const EPISODE_SIGNAL_RELATION_DESCRIPTIONS: Record<EpisodeSignalRelation, string> = {
  "base-planar":
    "Planar base motion channel. x_mm/y_mm are chassis translation in millimeters, theta is chassis heading.",
  "mapped-joint":
    "Recorded channel mapped to a URDF joint, directly comparable with joint trajectories.",
  "aux-unmapped":
    "Recorded auxiliary channel without a direct URDF joint mapping.",
};

export const resolveEpisodeSignalRelation = ({
  signalName,
  mappedJointName,
}: {
  signalName: string;
  mappedJointName: string | null | undefined;
}): EpisodeSignalRelation => {
  if (isEpisodeBaseSignalName(signalName)) {
    return "base-planar";
  }
  if (typeof mappedJointName === "string" && mappedJointName.trim().length > 0) {
    return "mapped-joint";
  }
  return "aux-unmapped";
};

export const getEpisodeSignalRelationLabel = (relation: EpisodeSignalRelation) =>
  EPISODE_SIGNAL_RELATION_LABELS[relation];

export const getEpisodeSignalRelationDescription = (
  relation: EpisodeSignalRelation
) => EPISODE_SIGNAL_RELATION_DESCRIPTIONS[relation];
