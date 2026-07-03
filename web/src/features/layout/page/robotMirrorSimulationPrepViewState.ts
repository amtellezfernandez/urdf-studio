import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import type { RobotMirrorSelectionLink } from "@/features/layout/page/robotMirrorSymmetrySelection";
import { toSortedUniqueRobotMirrorLinkNames } from "@/features/layout/page/robotMirrorLinkNames";

type RobotMirrorSimulationPrepViewState = {
  robotMirrorSelectionLinks: RobotMirrorSelectionLink[];
  robotMirrorSymmetryCheck: RobotMirrorSymmetryCheck | null;
};

export const resolveRobotMirrorSimulationPrepViewState = ({
  robotMirrorSelectionLinks,
  robotMirrorSymmetryCheck,
  robotMirrorPlaneTouchingLinkNames = [],
}: {
  robotMirrorSelectionLinks: readonly RobotMirrorSelectionLink[];
  robotMirrorSymmetryCheck: RobotMirrorSymmetryCheck | null | undefined;
  robotMirrorPlaneTouchingLinkNames?: readonly string[];
}): RobotMirrorSimulationPrepViewState => {
  if (!robotMirrorSymmetryCheck) {
    return {
      robotMirrorSelectionLinks: [...robotMirrorSelectionLinks],
      robotMirrorSymmetryCheck: null,
    };
  }

  const planeTouchingLinkNameSet = new Set(
    toSortedUniqueRobotMirrorLinkNames(robotMirrorPlaneTouchingLinkNames)
  );
  const promotedSelectionLinks = robotMirrorSelectionLinks.filter(
    (selectionLink) =>
      planeTouchingLinkNameSet.has(selectionLink.linkName) && selectionLink.status !== "paired"
  );
  const promotedLinkNames = toSortedUniqueRobotMirrorLinkNames(
    promotedSelectionLinks.map((selectionLink) => selectionLink.linkName)
  );
  if (promotedLinkNames.length === 0) {
    return {
      robotMirrorSelectionLinks: [...robotMirrorSelectionLinks],
      robotMirrorSymmetryCheck,
    };
  }

  const promotedLinkNameSet = new Set(promotedLinkNames);
  const originalReviewGroupByKey = new Map(
    robotMirrorSymmetryCheck.reviewGroups.map((group) => [group.groupKey, group] as const)
  );
  const reviewGroups = robotMirrorSymmetryCheck.reviewGroups
    .map((group) => {
      const promotedGroupLinkCount = group.unsupportedLinkNames.filter((linkName) =>
        promotedLinkNameSet.has(linkName)
      ).length;
      const unsupportedLinkNames = group.unsupportedLinkNames.filter(
        (linkName) => !promotedLinkNameSet.has(linkName)
      );
      if (unsupportedLinkNames.length === 0) {
        return null;
      }
      return {
        ...group,
        supportedLinkCount: group.supportedLinkCount + promotedGroupLinkCount,
        unsupportedLinkNames,
      };
    })
    .filter(
      (
        group
      ): group is NonNullable<RobotMirrorSymmetryCheck["reviewGroups"][number]> => group !== null
    );
  const effectiveRobotMirrorSelectionLinks = robotMirrorSelectionLinks.map((selectionLink) =>
    promotedLinkNameSet.has(selectionLink.linkName)
      ? {
          ...selectionLink,
          status: "centered" as const,
        }
      : selectionLink
  );
  const centeredLinkNames = toSortedUniqueRobotMirrorLinkNames([
    ...robotMirrorSymmetryCheck.centeredLinkNames,
    ...promotedLinkNames,
  ]);
  const supportedLinkNames = toSortedUniqueRobotMirrorLinkNames([
    ...robotMirrorSymmetryCheck.supportedLinkNames,
    ...promotedLinkNames,
  ]);
  const promotedGroupCount = new Set(
    promotedSelectionLinks
      .filter((selectionLink) => {
        const originalReviewGroup = originalReviewGroupByKey.get(selectionLink.groupKey) ?? null;
        if (originalReviewGroup) {
          return originalReviewGroup.supportedLinkCount === 0;
        }
        return selectionLink.status === "available";
      })
      .map((selectionLink) => selectionLink.groupKey)
  ).size;

  return {
    robotMirrorSelectionLinks: effectiveRobotMirrorSelectionLinks,
    robotMirrorSymmetryCheck: {
      ...robotMirrorSymmetryCheck,
      centeredLinkCount: centeredLinkNames.length,
      centeredLinkNames,
      reviewGroups,
      reviewLinkCount: reviewGroups.reduce(
        (count, group) => count + group.unsupportedLinkNames.length,
        0
      ),
      supportedGroupCount: robotMirrorSymmetryCheck.supportedGroupCount + promotedGroupCount,
      supportedLinkCount: supportedLinkNames.length,
      supportedLinkNames,
      totalRepeatedLinkCount: Math.max(
        robotMirrorSymmetryCheck.totalRepeatedLinkCount,
        effectiveRobotMirrorSelectionLinks.length
      ),
    },
  };
};
