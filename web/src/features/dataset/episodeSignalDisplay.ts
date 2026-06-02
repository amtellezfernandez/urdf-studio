import { getJointColor } from "@/features/urdf/utils/jointColors";
import { resolveRobotJointName } from "@/shared/lib/urdf-joints";
import type { URDFRobot } from "urdf-loader";

export type EpisodeSignalDisplayRow = {
  signalName: string;
  mappedJointName: string | null;
  mappingStatus: "mapped" | "unmapped";
  colorKey: string;
  color: string;
};

export type EpisodeSignalColorStrategy = "by-mapping" | "by-signal";

type ResolveEpisodeSignalDisplayRowsOptions = {
  signalNames: string[];
  robot?: URDFRobot | null;
  mappedColorReferenceJointNames?: readonly string[];
  signalColorReferenceNames?: readonly string[];
  colorStrategy?: EpisodeSignalColorStrategy;
};

const normalizeJointNames = (names: readonly string[]) =>
  Array.from(
    new Set(
      names
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
    )
  ).sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );

const resolveMappedColorReferenceJointNames = ({
  robot,
  mappedColorReferenceJointNames = [],
}: {
  robot?: URDFRobot | null;
  mappedColorReferenceJointNames?: readonly string[];
}) => {
  const normalizedPreferred = normalizeJointNames(mappedColorReferenceJointNames);
  if (normalizedPreferred.length > 0) {
    return normalizedPreferred;
  }
  if (!robot) {
    return [];
  }
  return normalizeJointNames(Object.keys(robot.joints ?? {}));
};

const resolveMappedSignalColor = ({
  mappedJointName,
  mappedColorReferenceJointNames,
}: {
  mappedJointName: string;
  mappedColorReferenceJointNames: readonly string[];
}) => {
  if (mappedColorReferenceJointNames.length === 0) {
    return getJointColor(mappedJointName, [mappedJointName]);
  }
  return getJointColor(mappedJointName, mappedColorReferenceJointNames);
};

const resolveUnmappedSignalColor = (signalName: string) =>
  getJointColor(signalName, [signalName]);

const resolveSignalColorReferenceNames = ({
  signalNames,
  signalColorReferenceNames = [],
}: {
  signalNames: readonly string[];
  signalColorReferenceNames?: readonly string[];
}) => {
  const normalizedPreferred = normalizeJointNames(signalColorReferenceNames);
  if (normalizedPreferred.length > 0) {
    return normalizedPreferred;
  }
  return normalizeJointNames(signalNames);
};

const resolveSignalColor = ({
  signalName,
  signalColorReferenceNames,
}: {
  signalName: string;
  signalColorReferenceNames: readonly string[];
}) => {
  if (signalColorReferenceNames.length === 0) {
    return getJointColor(signalName, [signalName]);
  }
  return getJointColor(signalName, signalColorReferenceNames);
};

export const resolveEpisodeSignalDisplayRows = ({
  signalNames,
  robot,
  mappedColorReferenceJointNames,
  signalColorReferenceNames,
  colorStrategy = "by-mapping",
}: ResolveEpisodeSignalDisplayRowsOptions): EpisodeSignalDisplayRow[] => {
  const stableMappedColorReferenceJointNames =
    resolveMappedColorReferenceJointNames({
      robot,
      mappedColorReferenceJointNames,
    });
  const stableSignalColorReferenceNames = resolveSignalColorReferenceNames({
    signalNames,
    signalColorReferenceNames,
  });
  return signalNames.map((signalName) => {
    const mappedJointName = resolveRobotJointName(robot, signalName);
    const isMapped = mappedJointName !== null;
    const colorKey =
      colorStrategy === "by-signal"
        ? signalName
        : mappedJointName ?? signalName;
    const color =
      colorStrategy === "by-signal"
        ? resolveSignalColor({
            signalName,
            signalColorReferenceNames: stableSignalColorReferenceNames,
          })
        : isMapped
          ? resolveMappedSignalColor({
              mappedJointName,
              mappedColorReferenceJointNames: stableMappedColorReferenceJointNames,
            })
          : resolveUnmappedSignalColor(signalName);
    return {
      signalName,
      mappedJointName,
      mappingStatus: isMapped ? "mapped" : "unmapped",
      colorKey,
      color,
    };
  });
};
