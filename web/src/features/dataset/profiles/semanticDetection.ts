import {
  DATASET_SIGNAL_PROFILE_IDS,
  DATASET_SIGNAL_PROFILE_PARAMS,
} from "@/features/dataset/profiles/profileParams";
import type {
  DatasetSignalBaseMode,
  DatasetSignalChannel,
  DatasetSignalProfileId,
  DatasetSignalProfileResolution,
  DatasetSignalSemantic,
} from "@/features/dataset/profiles/profileTypes";

const normalizeToken = (value: string) => value.trim().toLowerCase();

const hasSuffix = (value: string, suffixes: readonly string[]) =>
  suffixes.some((suffix) => value.endsWith(suffix));

const stripSuffix = (value: string, suffixes: readonly string[]) => {
  for (const suffix of suffixes) {
    if (value.endsWith(suffix)) {
      return value.slice(0, -suffix.length);
    }
  }
  return value;
};

const resolvePlanarTwistSemantic = (
  normalizedToken: string
): DatasetSignalSemantic | null => {
  const aliases = DATASET_SIGNAL_PROFILE_PARAMS.planarTwistAliases;
  if (aliases.x.some((alias) => alias === normalizedToken))
    return "base_twist_planar_x";
  if (aliases.y.some((alias) => alias === normalizedToken))
    return "base_twist_planar_y";
  if (aliases.theta.some((alias) => alias === normalizedToken))
    return "base_twist_planar_theta";
  return null;
};

const resolvePlanarBasePoseSemantic = (
  normalizedToken: string
): DatasetSignalSemantic | null => {
  const aliases = DATASET_SIGNAL_PROFILE_PARAMS.planarBasePoseAliases;
  if (aliases.xMm.some((alias) => alias === normalizedToken))
    return "base_pose_planar_x_mm";
  if (aliases.yMm.some((alias) => alias === normalizedToken))
    return "base_pose_planar_y_mm";
  if (aliases.thetaDeg.some((alias) => alias === normalizedToken))
    return "base_pose_planar_theta_deg";
  return null;
};

const isPlanarBasePoseSemantic = (semantic: DatasetSignalSemantic) =>
  semantic === "base_pose_planar_x_mm" ||
  semantic === "base_pose_planar_y_mm" ||
  semantic === "base_pose_planar_theta_deg";

const resolveChannelFromName = (
  name: string,
  index: number
): DatasetSignalChannel => {
  const sourceName = name.trim().length > 0 ? name.trim() : `joint_${index}`;
  const token = normalizeToken(sourceName);
  const planarSemantic = resolvePlanarTwistSemantic(token);
  if (planarSemantic) {
    return {
      index,
      sourceName,
      normalizedName: token,
      semantic: planarSemantic,
      confidence: "high",
    };
  }
  const planarBasePoseSemantic = resolvePlanarBasePoseSemantic(token);
  if (planarBasePoseSemantic) {
    return {
      index,
      sourceName,
      normalizedName: token,
      semantic: planarBasePoseSemantic,
      confidence: "high",
    };
  }

  if (hasSuffix(token, DATASET_SIGNAL_PROFILE_PARAMS.positionSuffixes)) {
    return {
      index,
      sourceName,
      normalizedName: stripSuffix(
        token,
        DATASET_SIGNAL_PROFILE_PARAMS.positionSuffixes
      ),
      semantic: "joint_position",
      confidence: "high",
    };
  }

  if (hasSuffix(token, DATASET_SIGNAL_PROFILE_PARAMS.velocitySuffixes)) {
    return {
      index,
      sourceName,
      normalizedName: token,
      semantic: "joint_velocity",
      confidence: "medium",
    };
  }

  if (hasSuffix(token, DATASET_SIGNAL_PROFILE_PARAMS.effortSuffixes)) {
    return {
      index,
      sourceName,
      normalizedName: token,
      semantic: "joint_effort",
      confidence: "medium",
    };
  }

  return {
    index,
    sourceName,
    normalizedName: token,
    semantic: "joint_position",
    confidence: "medium",
  };
};

const downgradeIncompletePlanarBasePoseChannels = (
  channels: DatasetSignalChannel[]
) =>
  channels.map<DatasetSignalChannel>((channel) => {
    if (!isPlanarBasePoseSemantic(channel.semantic)) {
      return channel;
    }
    return {
      ...channel,
      semantic: "joint_position",
      confidence: "medium",
    };
  });

const resolveProfileId = ({
  robotTypeHint,
  planarTwistComplete,
  planarBasePoseComplete,
}: {
  robotTypeHint?: string | null;
  planarTwistComplete: boolean;
  planarBasePoseComplete: boolean;
}): DatasetSignalProfileId => {
  const normalizedHint = normalizeToken(robotTypeHint ?? "");
  if (
    normalizedHint === DATASET_SIGNAL_PROFILE_IDS.lekiwiClient ||
    normalizedHint === "lekiwi"
  ) {
    return DATASET_SIGNAL_PROFILE_IDS.lekiwiClient;
  }
  if (planarTwistComplete || planarBasePoseComplete) {
    return DATASET_SIGNAL_PROFILE_IDS.mixed;
  }
  return DATASET_SIGNAL_PROFILE_IDS.urdfNative;
};

export const resolveDatasetSignalProfile = ({
  featureNames,
  robotTypeHint,
  fallbackChannelCount = 0,
}: {
  featureNames: string[];
  robotTypeHint?: string | null;
  fallbackChannelCount?: number;
}): DatasetSignalProfileResolution => {
  const normalizedFeatureNames =
    featureNames.length > 0
      ? featureNames
      : Array.from({ length: Math.max(0, fallbackChannelCount) }, (_, index) => `joint_${index}`);

  const rawChannels = normalizedFeatureNames.map((name, index) =>
    resolveChannelFromName(name, index)
  );
  const rawPlanarBasePoseXMm =
    rawChannels.find((channel) => channel.semantic === "base_pose_planar_x_mm") ??
    null;
  const rawPlanarBasePoseYMm =
    rawChannels.find((channel) => channel.semantic === "base_pose_planar_y_mm") ??
    null;
  const rawPlanarBasePoseThetaDeg =
    rawChannels.find(
      (channel) => channel.semantic === "base_pose_planar_theta_deg"
    ) ?? null;
  const planarBasePoseComplete = Boolean(
    rawPlanarBasePoseXMm && rawPlanarBasePoseYMm && rawPlanarBasePoseThetaDeg
  );
  const hasAnyPlanarBasePoseChannel = Boolean(
    rawPlanarBasePoseXMm || rawPlanarBasePoseYMm || rawPlanarBasePoseThetaDeg
  );

  const channels =
    hasAnyPlanarBasePoseChannel && !planarBasePoseComplete
      ? downgradeIncompletePlanarBasePoseChannels(rawChannels)
      : rawChannels;

  const jointChannels = channels.filter(
    (channel) => channel.semantic === "joint_position"
  );
  const planarTwistX =
    channels.find((channel) => channel.semantic === "base_twist_planar_x") ??
    null;
  const planarTwistY =
    channels.find((channel) => channel.semantic === "base_twist_planar_y") ??
    null;
  const planarTwistTheta =
    channels.find((channel) => channel.semantic === "base_twist_planar_theta") ??
    null;
  const planarTwistComplete = Boolean(
    planarTwistX && planarTwistY && planarTwistTheta
  );
  const planarBasePoseXMm =
    channels.find((channel) => channel.semantic === "base_pose_planar_x_mm") ??
    null;
  const planarBasePoseYMm =
    channels.find((channel) => channel.semantic === "base_pose_planar_y_mm") ??
    null;
  const planarBasePoseThetaDeg =
    channels.find(
      (channel) => channel.semantic === "base_pose_planar_theta_deg"
    ) ?? null;
  const normalizedPlanarBasePoseComplete = Boolean(
    planarBasePoseXMm && planarBasePoseYMm && planarBasePoseThetaDeg
  );
  const unknownChannels = channels.filter(
    (channel) => channel.semantic === "unknown"
  );

  const confidence: "high" | "medium" | "low" =
    unknownChannels.length === 0
      ? "high"
      : unknownChannels.length < channels.length
      ? "medium"
      : "low";

  return {
    profileId: resolveProfileId({
      robotTypeHint,
      planarTwistComplete,
      planarBasePoseComplete: normalizedPlanarBasePoseComplete,
    }),
    profileVersion: DATASET_SIGNAL_PROFILE_PARAMS.version,
    channels,
    jointChannels,
    planarTwistChannels: {
      x: planarTwistX,
      y: planarTwistY,
      theta: planarTwistTheta,
      complete: planarTwistComplete,
    },
    planarBasePoseChannels: {
      xMm: planarBasePoseXMm,
      yMm: planarBasePoseYMm,
      thetaDeg: planarBasePoseThetaDeg,
      complete: normalizedPlanarBasePoseComplete,
    },
    report: {
      mappedChannels: channels.length - unknownChannels.length,
      unmappedChannels: unknownChannels.length,
      unmappedNames: unknownChannels.map((channel) => channel.sourceName),
      confidence,
    },
  };
};

export const resolveDatasetSignalBaseMode = (
  signalProfile: DatasetSignalProfileResolution
): DatasetSignalBaseMode => {
  if (signalProfile.planarBasePoseChannels.complete) {
    return "pose";
  }
  if (signalProfile.planarTwistChannels.complete) {
    return "twist";
  }
  return "none";
};

export const resolveJointChannelNames = (
  signalProfile: DatasetSignalProfileResolution
) => signalProfile.jointChannels.map((channel) => channel.normalizedName);
