import {
  DATASET_SIGNAL_PROFILE_PARAMS,
} from "@/features/dataset/profiles/profileParams";
import {
  convertJointValueWithPlan,
  resolveJointValueConversionPlan,
  type JointValueConversionPlan,
  type JointValueRange,
} from "@/shared/lib/urdfBrowser";
import type {
  DatasetNumericRow,
  DatasetRowConversionOptions,
  DatasetRowConversionResult,
} from "@/features/dataset/profiles/profileTypes";
import type { RobotBasePose } from "@/shared/types/feature";

type TwistIntegrationState = {
  timestampMs: number;
  x: number;
  y: number;
  yawRad: number;
} | null;

type AngularUnit = "deg" | "rad";

const normalizeChannelName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const resolveUsesGenericPlanarBaseChannels = (
  signalProfile: DatasetRowConversionOptions["signalProfile"]
): boolean => {
  const xChannel = signalProfile.planarBasePoseChannels.xMm;
  const yChannel = signalProfile.planarBasePoseChannels.yMm;
  const thetaChannel = signalProfile.planarBasePoseChannels.thetaDeg;
  if (!xChannel || !yChannel || !thetaChannel) {
    return false;
  }
  const genericChannels = DATASET_SIGNAL_PROFILE_PARAMS.genericPlanarBaseChannels;
  const normalizedX = normalizeChannelName(xChannel.sourceName);
  const normalizedY = normalizeChannelName(yChannel.sourceName);
  const normalizedTheta = normalizeChannelName(thetaChannel.sourceName);
  return (
    genericChannels.xMm.some((alias) => alias === normalizedX) &&
    genericChannels.yMm.some((alias) => alias === normalizedY) &&
    genericChannels.theta.some((alias) => alias === normalizedTheta)
  );
};

const toFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const computeJointChannelRanges = (
  rows: DatasetNumericRow[],
  signalProfile: DatasetRowConversionOptions["signalProfile"]
) => {
  const ranges = new Map<string, JointValueRange>();
  signalProfile.jointChannels.forEach((channel) => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    rows.forEach((row) => {
      const value = toFiniteNumber(row.values[channel.index]);
      if (value === null) {
        return;
      }
      min = Math.min(min, value);
      max = Math.max(max, value);
    });
    if (Number.isFinite(min) && Number.isFinite(max)) {
      ranges.set(channel.normalizedName, { min, max });
    }
  });
  return ranges;
};

const buildJointConversionPlans = ({
  rows,
  signalProfile,
  jointMapping,
  jointLimits,
  degToRad,
}: {
  rows: DatasetNumericRow[];
  signalProfile: DatasetRowConversionOptions["signalProfile"];
  jointMapping: Record<string, string>;
  jointLimits: DatasetRowConversionOptions["jointLimits"];
  degToRad: boolean;
}) => {
  const ranges = computeJointChannelRanges(rows, signalProfile);
  const plans = new Map<string, JointValueConversionPlan>();
  signalProfile.jointChannels.forEach((channel) => {
    const sourceJointName = channel.normalizedName;
    const targetJointName = jointMapping[sourceJointName] ?? sourceJointName;
    plans.set(
      sourceJointName,
      resolveJointValueConversionPlan({
        rawRange: ranges.get(sourceJointName),
        targetJointName,
        jointLimits,
        angularConversionEnabled: degToRad,
      })
    );
  });
  return plans;
};

const resolveAngularUnitFromChannelName = (
  sourceName: string
): AngularUnit | null => {
  const normalized = normalizeChannelName(sourceName);
  const hasToken = (tokens: readonly string[]) =>
    tokens.some((token) => normalized.includes(token));
  if (hasToken(DATASET_SIGNAL_PROFILE_PARAMS.angularUnitDetection.degreeNameTokens)) {
    return "deg";
  }
  if (hasToken(DATASET_SIGNAL_PROFILE_PARAMS.angularUnitDetection.radianNameTokens)) {
    return "rad";
  }
  return null;
};

const inferAngularUnitFromRows = ({
  rows,
  channelIndex,
  fallbackUnit,
}: {
  rows: DatasetNumericRow[];
  channelIndex: number;
  fallbackUnit: AngularUnit;
}): AngularUnit => {
  let maxAbs = 0;
  let hasFiniteSample = false;
  rows.forEach((row) => {
    const value = row.values[channelIndex];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return;
    }
    hasFiniteSample = true;
    maxAbs = Math.max(maxAbs, Math.abs(value));
  });
  if (!hasFiniteSample) {
    return fallbackUnit;
  }
  if (maxAbs > DATASET_SIGNAL_PROFILE_PARAMS.angularUnitDetection.radiansLikelyAbsMax) {
    return "deg";
  }
  return "rad";
};

const resolveBasePoseFromState = (state: TwistIntegrationState): RobotBasePose | undefined => {
  if (!state) return undefined;
  return {
    position: { x: state.x, y: state.y, z: 0 },
    quaternion: {
      x: 0,
      y: 0,
      z: Math.sin(state.yawRad / 2),
      w: Math.cos(state.yawRad / 2),
    },
  };
};

const integratePlanarTwist = ({
  previous,
  timestampMs,
  xVelMs,
  yVelMs,
  thetaVelRadSec,
}: {
  previous: TwistIntegrationState;
  timestampMs: number;
  xVelMs: number;
  yVelMs: number;
  thetaVelRadSec: number;
}): TwistIntegrationState => {
  if (!previous) {
    return {
      timestampMs,
      x: 0,
      y: 0,
      yawRad: 0,
    };
  }

  const rawDtSec = (timestampMs - previous.timestampMs) / 1000;
  const dtSec = Math.max(
    0,
    Math.min(rawDtSec, DATASET_SIGNAL_PROFILE_PARAMS.maxTwistIntegrationDtSec)
  );

  const dxBody = xVelMs * dtSec;
  const dyBody = yVelMs * dtSec;
  const yawRad = previous.yawRad;
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);
  const dxWorld = dxBody * cosYaw - dyBody * sinYaw;
  const dyWorld = dxBody * sinYaw + dyBody * cosYaw;
  const nextYaw =
    yawRad + thetaVelRadSec * dtSec;

  return {
    timestampMs,
    x: previous.x + dxWorld,
    y: previous.y + dyWorld,
    yawRad: nextYaw,
  };
};

const resolveAbsolutePlanarBaseState = ({
  timestampMs,
  xMm,
  yMm,
  thetaRad,
}: {
  timestampMs: number;
  xMm: number;
  yMm: number;
  thetaRad: number;
}): TwistIntegrationState => ({
  timestampMs,
  x: xMm * DATASET_SIGNAL_PROFILE_PARAMS.mmToMeters,
  y: yMm * DATASET_SIGNAL_PROFILE_PARAMS.mmToMeters,
  yawRad: thetaRad,
});

const transformJointPositionValue = ({
  rawValue,
  sourceJointName,
  conversionPlan,
  jointOffsets,
  jointInversions,
}: {
  rawValue: number;
  sourceJointName: string;
  conversionPlan: JointValueConversionPlan;
  jointOffsets: Record<string, number>;
  jointInversions: Record<string, boolean>;
}) => {
  let value = convertJointValueWithPlan(rawValue, conversionPlan);
  if (jointInversions[sourceJointName]) {
    value = -value;
  }
  if (jointOffsets[sourceJointName] !== undefined) {
    value += jointOffsets[sourceJointName];
  }
  return value;
};

export const convertDatasetRowsToRecordedFrames = (
  rows: DatasetNumericRow[],
  {
    signalProfile,
    jointMapping = {},
    jointOffsets = {},
    jointInversions = {},
    degToRad = false,
    jointLimits,
  }: DatasetRowConversionOptions
): DatasetRowConversionResult => {
  let integrationState: TwistIntegrationState = null;
  const jointConversionPlans = buildJointConversionPlans({
    rows,
    signalProfile,
    jointMapping,
    jointLimits,
    degToRad,
  });
  const usesGenericPlanarBaseChannels =
    resolveUsesGenericPlanarBaseChannels(signalProfile);
  const basePoseThetaChannel = signalProfile.planarBasePoseChannels.thetaDeg;
  const twistThetaChannel = signalProfile.planarTwistChannels.theta;
  const basePoseThetaUnitFromName = basePoseThetaChannel
    ? resolveAngularUnitFromChannelName(basePoseThetaChannel.sourceName)
    : null;
  const twistThetaUnitFromName = twistThetaChannel
    ? resolveAngularUnitFromChannelName(twistThetaChannel.sourceName)
    : null;
  const basePoseThetaUnit: AngularUnit =
    basePoseThetaUnitFromName ??
    (basePoseThetaChannel
      ? inferAngularUnitFromRows({
          rows,
          channelIndex: basePoseThetaChannel.index,
          fallbackUnit:
            DATASET_SIGNAL_PROFILE_PARAMS.angularUnitDetection.defaultBasePoseThetaUnit,
        })
      : DATASET_SIGNAL_PROFILE_PARAMS.angularUnitDetection.defaultBasePoseThetaUnit);
  const twistThetaUnit: AngularUnit =
    twistThetaUnitFromName ??
    (twistThetaChannel
      ? inferAngularUnitFromRows({
          rows,
          channelIndex: twistThetaChannel.index,
          fallbackUnit:
            DATASET_SIGNAL_PROFILE_PARAMS.angularUnitDetection.defaultPlanarTwistThetaUnit,
        })
      : DATASET_SIGNAL_PROFILE_PARAMS.angularUnitDetection.defaultPlanarTwistThetaUnit);
  const basePoseThetaToRad =
    basePoseThetaUnit === "deg" ? DATASET_SIGNAL_PROFILE_PARAMS.degToRad : 1;
  const twistThetaToRad =
    twistThetaUnit === "deg" ? DATASET_SIGNAL_PROFILE_PARAMS.degToRad : 1;
  const frames = rows.map((row) => {
    const jointPositions: Record<string, number> = {};
    let xVel: number | null = null;
    let yVel: number | null = null;
    let thetaVel: number | null = null;
    let xPoseMm: number | null = null;
    let yPoseMm: number | null = null;
    let thetaPose: number | null = null;

    signalProfile.channels.forEach((channel) => {
      const rawValue = row.values[channel.index];
      const finiteValue = toFiniteNumber(rawValue);
      if (channel.semantic === "joint_position") {
        if (finiteValue === null) return;
        const sourceJointName = channel.normalizedName;
        const targetJointName =
          jointMapping[sourceJointName] ?? sourceJointName;
        const value = transformJointPositionValue({
          rawValue: finiteValue,
          sourceJointName,
          conversionPlan:
            jointConversionPlans.get(sourceJointName) ?? { mode: "identity" },
          jointOffsets,
          jointInversions,
        });
        if (targetJointName && targetJointName !== "?") {
          jointPositions[targetJointName] = value;
        } else {
          // Keep skipped/unmapped channels visible in episode timelines.
          jointPositions[sourceJointName] = value;
        }
        return;
      }

      if (channel.semantic === "base_twist_planar_x") {
        xVel = finiteValue;
        if (finiteValue !== null) {
          jointPositions[channel.sourceName] = finiteValue;
        }
        return;
      }
      if (channel.semantic === "base_twist_planar_y") {
        yVel = finiteValue;
        if (finiteValue !== null) {
          jointPositions[channel.sourceName] = finiteValue;
        }
        return;
      }
      if (channel.semantic === "base_twist_planar_theta") {
        thetaVel = finiteValue;
        if (finiteValue !== null) {
          jointPositions[channel.sourceName] = finiteValue;
        }
        return;
      }
      if (channel.semantic === "base_pose_planar_x_mm") {
        xPoseMm = finiteValue;
        if (finiteValue !== null) {
          jointPositions[channel.sourceName] = finiteValue;
        }
        return;
      }
      if (channel.semantic === "base_pose_planar_y_mm") {
        yPoseMm = finiteValue;
        if (finiteValue !== null) {
          jointPositions[channel.sourceName] = finiteValue;
        }
        return;
      }
      if (channel.semantic === "base_pose_planar_theta_deg") {
        thetaPose = finiteValue;
        if (finiteValue !== null) {
          jointPositions[channel.sourceName] = finiteValue;
        }
        return;
      }
    });

    const hasPlanarTwist =
      xVel !== null && yVel !== null && thetaVel !== null;
    const hasPlanarBasePose =
      xPoseMm !== null && yPoseMm !== null && thetaPose !== null;

    let basePose: RobotBasePose | undefined;
    if (hasPlanarBasePose) {
      if (usesGenericPlanarBaseChannels) {
        integrationState = integratePlanarTwist({
          previous: integrationState,
          timestampMs: row.timestampMs,
          xVelMs: xPoseMm * DATASET_SIGNAL_PROFILE_PARAMS.mmToMeters,
          yVelMs: yPoseMm * DATASET_SIGNAL_PROFILE_PARAMS.mmToMeters,
          thetaVelRadSec: thetaPose * basePoseThetaToRad,
        });
      } else {
        integrationState = resolveAbsolutePlanarBaseState({
          timestampMs: row.timestampMs,
          xMm: xPoseMm,
          yMm: yPoseMm,
          thetaRad: thetaPose * basePoseThetaToRad,
        });
      }
      basePose = resolveBasePoseFromState(integrationState);
    } else if (hasPlanarTwist) {
      integrationState = integratePlanarTwist({
        previous: integrationState,
        timestampMs: row.timestampMs,
        xVelMs: xVel,
        yVelMs: yVel,
        thetaVelRadSec: thetaVel * twistThetaToRad,
      });
      basePose = resolveBasePoseFromState(integrationState);
    } else if (!integrationState) {
      integrationState = {
        timestampMs: row.timestampMs,
        x: 0,
        y: 0,
        yawRad: 0,
      };
    } else {
      // Keep integrationState as-is, do NOT advance timestampMs
      // so next twist integration uses the last real integration timestamp
    }

    return {
      timestamp: row.timestampMs,
      jointPositions,
      basePose,
    };
  });

  return {
    frames,
    usedPlanarTwist:
      signalProfile.planarTwistChannels.complete ||
      signalProfile.planarBasePoseChannels.complete,
  };
};
