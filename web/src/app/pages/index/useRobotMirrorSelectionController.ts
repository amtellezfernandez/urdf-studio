import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { URDFRobot } from "urdf-loader";

import type { RepeatedInertiaSymmetryLinkCentersLocal } from "@/features/layout/page/repeatedInertiaSymmetryRobot";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import {
  resolveRobotMirrorActionableSelection,
  type RobotMirrorFixAvailability,
} from "@/features/layout/page/robotMirrorSymmetryFix";
import type { RobotMirrorSelectionLink } from "@/features/layout/page/robotMirrorSymmetrySelection";
import { collectRobotMirrorPlaneTouchingLinkNamesFromRobot } from "@/features/layout/page/robotMirrorSymmetryVisualization";
import {
  buildRobotMirrorSymmetryVisualizationScopeKey,
  createEmptyRobotMirrorVisualizationState,
  resolveRobotMirrorVisualizationState,
  type RobotMirrorVisualizationState,
} from "@/features/layout/page/simulationPrepViewerState";
import type { MeshFiles } from "@/shared/types/feature";

type RobotMirrorFixAvailabilityState = {
  isLoading: boolean;
  value: RobotMirrorFixAvailability;
};

export type UseRobotMirrorSelectionControllerOptions = {
  meshFiles: MeshFiles;
  packageRoots?: Record<string, string[]>;
  repeatedInertiaSymmetryLinkCentersLocal: RepeatedInertiaSymmetryLinkCentersLocal;
  resetRevision?: number;
  robot: URDFRobot | null;
  robotMirrorSelectionLinks: readonly RobotMirrorSelectionLink[];
  robotMirrorSymmetryCheck: RobotMirrorSymmetryCheck | null;
  urdfBasePath?: string;
  vizUrdfContent: string;
};

export type UseRobotMirrorSelectionControllerResult = {
  handleToggleRobotMirrorSelectionLink: (linkName: string) => void;
  robotMirrorFixAvailability: RobotMirrorFixAvailabilityState;
  robotMirrorPlaneTouchingLinkNames: string[];
  robotMirrorScopeKey: string | null;
  robotMirrorVisualizationState: RobotMirrorVisualizationState;
  selectedRobotMirrorLinkNames: string[];
};

const createUnavailableRobotMirrorFixAvailability = (): RobotMirrorFixAvailability => ({
  centerOnlyActionableTargetCount: 0,
  centerOnlyAvailable: false,
  orientationOnlyActionableTargetCount: 0,
  orientationOnlyAvailable: false,
});

const createUnavailableRobotMirrorFixAvailabilityState = (): RobotMirrorFixAvailabilityState => ({
  isLoading: false,
  value: createUnavailableRobotMirrorFixAvailability(),
});

const areLinkNameListsEqual = (
  leftLinkNames: readonly string[],
  rightLinkNames: readonly string[]
): boolean =>
  leftLinkNames.length === rightLinkNames.length &&
  leftLinkNames.every((linkName, index) => linkName === rightLinkNames[index]);

const mergeRobotMirrorDefaultSelection = ({
  currentLinkNames,
  defaultLinkNames,
  validLinkNames,
}: {
  currentLinkNames: readonly string[];
  defaultLinkNames: readonly string[];
  validLinkNames: ReadonlySet<string>;
}): string[] => {
  const preservedLinkNames = currentLinkNames.filter((linkName) => validLinkNames.has(linkName));
  if (preservedLinkNames.length === 0) {
    return [...defaultLinkNames];
  }

  return Array.from(
    new Set([
      ...defaultLinkNames.filter((linkName) => !currentLinkNames.includes(linkName)),
      ...preservedLinkNames,
    ])
  );
};

export const useRobotMirrorSelectionController = ({
  meshFiles,
  packageRoots,
  repeatedInertiaSymmetryLinkCentersLocal,
  resetRevision,
  robot,
  robotMirrorSelectionLinks,
  robotMirrorSymmetryCheck,
  urdfBasePath,
  vizUrdfContent,
}: UseRobotMirrorSelectionControllerOptions): UseRobotMirrorSelectionControllerResult => {
  const [selectedRobotMirrorLinkNames, setSelectedRobotMirrorLinkNames] = useState<string[]>([]);
  const resetRevisionRef = useRef(resetRevision);
  const [robotMirrorFixAvailability, setRobotMirrorFixAvailability] =
    useState<RobotMirrorFixAvailabilityState>(
      createUnavailableRobotMirrorFixAvailabilityState
    );
  const [robotMirrorVisualizationState, setRobotMirrorVisualizationState] =
    useState<RobotMirrorVisualizationState>(createEmptyRobotMirrorVisualizationState);

  useEffect(() => {
    if (resetRevisionRef.current === resetRevision) {
      return;
    }

    resetRevisionRef.current = resetRevision;
    setSelectedRobotMirrorLinkNames([]);
    setRobotMirrorVisualizationState(createEmptyRobotMirrorVisualizationState());
    setRobotMirrorFixAvailability(createUnavailableRobotMirrorFixAvailabilityState());
  }, [resetRevision]);

  const robotMirrorPlaneTouchingLinkNames = useMemo(
    () =>
      collectRobotMirrorPlaneTouchingLinkNamesFromRobot({
        check: robotMirrorSymmetryCheck,
        robot,
      }),
    [robot, robotMirrorSymmetryCheck]
  );

  useEffect(() => {
    const validLinkNames = new Set(
      robotMirrorSelectionLinks.map((selectionLink) => selectionLink.linkName)
    );
    const planeTouchingSelectionLinkNames = new Set(
      robotMirrorPlaneTouchingLinkNames.filter((linkName) => validLinkNames.has(linkName))
    );
    const defaultLinkNames = robotMirrorSelectionLinks
      .filter(
        (selectionLink) =>
          selectionLink.preselected ||
          planeTouchingSelectionLinkNames.has(selectionLink.linkName)
      )
      .map((selectionLink) => selectionLink.linkName);

    setSelectedRobotMirrorLinkNames((currentLinkNames) => {
      const nextLinkNames = mergeRobotMirrorDefaultSelection({
        currentLinkNames,
        defaultLinkNames,
        validLinkNames,
      });
      return areLinkNameListsEqual(currentLinkNames, nextLinkNames)
        ? currentLinkNames
        : nextLinkNames;
    });
  }, [robotMirrorPlaneTouchingLinkNames, robotMirrorSelectionLinks]);

  const handleToggleRobotMirrorSelectionLink = useCallback((linkName: string) => {
    setSelectedRobotMirrorLinkNames((currentLinkNames) =>
      currentLinkNames.includes(linkName)
        ? currentLinkNames.filter((currentLinkName) => currentLinkName !== linkName)
        : [...currentLinkNames, linkName].sort((left, right) => left.localeCompare(right))
    );
  }, []);

  const robotMirrorScopeKey = useMemo(
    () =>
      robotMirrorSymmetryCheck
        ? buildRobotMirrorSymmetryVisualizationScopeKey(robotMirrorSymmetryCheck)
        : null,
    [robotMirrorSymmetryCheck]
  );

  useEffect(() => {
    if (!robotMirrorSymmetryCheck || selectedRobotMirrorLinkNames.length === 0) {
      setRobotMirrorVisualizationState((currentState) =>
        resolveRobotMirrorVisualizationState({
          previousState: currentState,
          reset: true,
        })
      );
      setRobotMirrorFixAvailability(createUnavailableRobotMirrorFixAvailabilityState());
      return;
    }

    let didCancel = false;
    setRobotMirrorFixAvailability((currentState) => ({
      ...currentState,
      isLoading: true,
    }));

    void resolveRobotMirrorActionableSelection({
      alwaysIncludeVisualizationLinkNames: [
        ...robotMirrorSymmetryCheck.centeredLinkNames,
        ...robotMirrorPlaneTouchingLinkNames,
      ],
      linkCentersLocal: repeatedInertiaSymmetryLinkCentersLocal,
      meshFiles,
      packageRoots,
      robotMirrorSymmetryCheck,
      selectedLinkNames: selectedRobotMirrorLinkNames,
      selectionLinks: robotMirrorSelectionLinks,
      urdfBasePath,
      urdfContent: vizUrdfContent,
    })
      .then((selection) => {
        if (didCancel) {
          return;
        }

        setRobotMirrorVisualizationState((currentState) =>
          resolveRobotMirrorVisualizationState({
            nextSelection: selection,
            previousState: currentState,
          })
        );
        setRobotMirrorFixAvailability({
          isLoading: false,
          value: selection.availability,
        });
      })
      .catch(() => {
        if (didCancel) {
          return;
        }

        setRobotMirrorFixAvailability(createUnavailableRobotMirrorFixAvailabilityState());
      });

    return () => {
      didCancel = true;
    };
  }, [
    meshFiles,
    packageRoots,
    repeatedInertiaSymmetryLinkCentersLocal,
    robotMirrorPlaneTouchingLinkNames,
    robotMirrorSelectionLinks,
    robotMirrorSymmetryCheck,
    selectedRobotMirrorLinkNames,
    urdfBasePath,
    vizUrdfContent,
  ]);

  return {
    handleToggleRobotMirrorSelectionLink,
    robotMirrorFixAvailability,
    robotMirrorPlaneTouchingLinkNames,
    robotMirrorScopeKey,
    robotMirrorVisualizationState,
    selectedRobotMirrorLinkNames,
  };
};
