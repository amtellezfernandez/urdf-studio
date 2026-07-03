import type { LinkData } from "@/shared/lib/urdfCore";
import type { RepeatedInertiaDiagnosticGroup } from "@/features/layout/page/repeatedInertiaDiagnostics";
import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";
import {
  buildRobotMirrorSymmetryAlignmentTargets,
  type RobotMirrorSymmetryCheck,
} from "@/features/layout/page/robotMirrorSymmetry";
import {
  buildRobotMirrorMeshLinkGroupsFromDiagnostics,
  buildRobotMirrorMeshLinkGroupsFromLinkData,
  type RobotMirrorMeshLinkGroup,
} from "@/features/layout/page/robotMirrorMeshGroups";
import {
  parseRepeatedInertiaSymmetryRobot,
  type RepeatedInertiaSymmetryLinkCentersLocal,
} from "@/features/layout/page/repeatedInertiaSymmetryRobot";
import { toSortedUniqueRobotMirrorLinkNames } from "@/features/layout/page/robotMirrorLinkNames";

export type RobotMirrorSelectionLink = {
  counterpartLinkName: string | null;
  defaultExclusionReason: "radial-symmetry" | null;
  groupKey: string;
  groupLinkCount: number;
  linkName: string;
  meshLabel: string;
  preselected: boolean;
  status: "available" | "centered" | "paired" | "review";
};

const buildRadialSymmetryLinkNameSet = (
  repeatedInertiaSymmetryChains: readonly RepeatedInertiaSymmetryChain[]
): Set<string> =>
  new Set(
    repeatedInertiaSymmetryChains
      .filter((chain) => chain.symmetryType === "radial")
      .flatMap((chain) =>
        chain.branchLinkGroups.flatMap((branchLinkGroup) => branchLinkGroup.linkNames)
      )
  );

const buildPairedCounterpartByLinkName = (
  robotMirrorSymmetryCheck: RobotMirrorSymmetryCheck
): Map<string, string> => {
  const counterpartByLinkName = new Map<string, string>();
  robotMirrorSymmetryCheck.matchedPairs.forEach((pair) => {
    counterpartByLinkName.set(pair.leftLinkName, pair.rightLinkName);
    counterpartByLinkName.set(pair.rightLinkName, pair.leftLinkName);
  });
  return counterpartByLinkName;
};

const shouldPreferCenteredSelectionOnly = ({
  centeredLinkNameSet,
  groupLinkNames,
}: {
  centeredLinkNameSet: ReadonlySet<string>;
  groupLinkNames: readonly string[];
}): boolean => groupLinkNames.length > 2 && groupLinkNames.some((linkName) => centeredLinkNameSet.has(linkName));

const buildSelectionGroupsFromLinkData = (
  linkDataByName: Record<string, LinkData> | null | undefined
): RobotMirrorMeshLinkGroup[] => buildRobotMirrorMeshLinkGroupsFromLinkData(linkDataByName);

const buildSelectionGroupsFromDiagnostics = (
  repeatedInertiaDiagnostics: readonly RepeatedInertiaDiagnosticGroup[]
): RobotMirrorMeshLinkGroup[] =>
  buildRobotMirrorMeshLinkGroupsFromDiagnostics(repeatedInertiaDiagnostics);

export const buildRobotMirrorSelectionLinks = ({
  linkDataByName,
  repeatedInertiaDiagnostics,
  repeatedInertiaSymmetryChains,
  robotMirrorSymmetryCheck,
}: {
  linkDataByName?: Record<string, LinkData> | null;
  repeatedInertiaDiagnostics: readonly RepeatedInertiaDiagnosticGroup[];
  repeatedInertiaSymmetryChains: readonly RepeatedInertiaSymmetryChain[];
  robotMirrorSymmetryCheck: RobotMirrorSymmetryCheck | null | undefined;
}): RobotMirrorSelectionLink[] => {
  if (!robotMirrorSymmetryCheck) {
    return [];
  }

  const radialSymmetryLinkNames = buildRadialSymmetryLinkNameSet(repeatedInertiaSymmetryChains);
  const centeredLinkNameSet = new Set(robotMirrorSymmetryCheck.centeredLinkNames);
  const reviewLinkNameSet = new Set(
    robotMirrorSymmetryCheck.reviewGroups.flatMap((group) => group.unsupportedLinkNames)
  );
  const pairedCounterpartByLinkName = buildPairedCounterpartByLinkName(robotMirrorSymmetryCheck);
  const selectionGroups = buildSelectionGroupsFromLinkData(linkDataByName);
  const effectiveSelectionGroups =
    selectionGroups.length > 0
      ? selectionGroups
      : buildSelectionGroupsFromDiagnostics(repeatedInertiaDiagnostics);

  return effectiveSelectionGroups
    .flatMap((group) => {
      const groupLinkNames = group.linkNames;
      const preferCenteredSelectionOnly = shouldPreferCenteredSelectionOnly({
        centeredLinkNameSet,
        groupLinkNames,
      });
      return groupLinkNames.map((linkName) => {
        const isCentered = centeredLinkNameSet.has(linkName);
        const defaultExclusionReason = radialSymmetryLinkNames.has(linkName) ||
          (preferCenteredSelectionOnly && !isCentered)
          ? "radial-symmetry"
          : null;
        const status: RobotMirrorSelectionLink["status"] = reviewLinkNameSet.has(linkName)
          ? "review"
          : pairedCounterpartByLinkName.has(linkName)
            ? "paired"
            : isCentered
              ? "centered"
              : "available";
        return {
          counterpartLinkName: pairedCounterpartByLinkName.get(linkName) ?? null,
          defaultExclusionReason,
          groupKey: group.groupKey,
          groupLinkCount: groupLinkNames.length,
          linkName,
          meshLabel: group.meshLabel,
          preselected: defaultExclusionReason === null && status !== "available",
          status,
        } satisfies RobotMirrorSelectionLink;
      });
    })
    .sort(
      (left, right) =>
        Number(right.preselected) - Number(left.preselected) ||
        left.meshLabel.localeCompare(right.meshLabel) ||
        left.linkName.localeCompare(right.linkName)
    );
};

export const collectRobotMirrorAffectedLinkNames = ({
  robotMirrorSymmetryCheck,
  linkCentersLocal,
  selectedLinkNames,
  selectionLinks,
  urdfContent,
}: {
  robotMirrorSymmetryCheck: RobotMirrorSymmetryCheck | null | undefined;
  linkCentersLocal?: RepeatedInertiaSymmetryLinkCentersLocal | null;
  selectedLinkNames: readonly string[];
  selectionLinks: readonly RobotMirrorSelectionLink[];
  urdfContent: string;
}): string[] => {
  if (!robotMirrorSymmetryCheck || selectedLinkNames.length === 0) {
    return [];
  }

  const robot = parseRepeatedInertiaSymmetryRobot(urdfContent, {
    linkCentersLocal,
  });
  if (!robot) {
    return [];
  }

  const selectedLinkNameSet = new Set(selectedLinkNames);
  const linksByGroupKey = new Map<string, RobotMirrorSelectionLink[]>();
  selectionLinks.forEach((selectionLink) => {
    const currentLinks = linksByGroupKey.get(selectionLink.groupKey) ?? [];
    currentLinks.push(selectionLink);
    linksByGroupKey.set(selectionLink.groupKey, currentLinks);
  });
  const actionableTargetLinkNames = new Set<string>();

  linksByGroupKey.forEach((groupSelectionLinks) => {
    const groupSelectedLinkNames = groupSelectionLinks
      .filter((selectionLink) => selectedLinkNameSet.has(selectionLink.linkName))
      .map((selectionLink) => selectionLink.linkName);
    if (groupSelectedLinkNames.length === 0) {
      return;
    }
    const alignmentTargetLinkNames = new Set(
      buildRobotMirrorSymmetryAlignmentTargets({
        check: robotMirrorSymmetryCheck,
        linkNames: groupSelectionLinks.map((selectionLink) => selectionLink.linkName),
        robot,
      }).map((target) => target.linkName)
    );
    groupSelectedLinkNames.forEach((linkName) => {
      if (alignmentTargetLinkNames.has(linkName)) {
        actionableTargetLinkNames.add(linkName);
      }
    });
  });

  if (actionableTargetLinkNames.size === 0) {
    return [];
  }

  return toSortedUniqueRobotMirrorLinkNames(actionableTargetLinkNames);
};
