import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { InertialVisualizationSettings } from "@/shared/types/feature";
import type { RepeatedInertiaDiagnosticGroup } from "@/features/layout/page/repeatedInertiaDiagnostics";
import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import {
  buildRepeatedInertiaVisualizationScopeKey,
  buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey,
  collectRepeatedInertiaSymmetryFamilyLinkNames,
  resolveActiveSimulationPrepRobotMirrorVisualization,
  resolveActiveSimulationPrepSymmetryVisualization,
  resolveSimulationPrepVisualizationScope,
  syncSimulationPrepInertiaVisualizationScope,
  type SimulationPrepVisualizationPreview,
  SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY,
  SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY,
} from "@/features/layout/page/simulationPrepViewerState";

type SimulationPrepVisualizationControllerInput = {
  activeScopeKey: string | null;
  displayedSymmetryChains: readonly RepeatedInertiaSymmetryChain[];
  hoveredPreview: SimulationPrepVisualizationPreview | null;
  inertialVisualization: InertialVisualizationSettings;
  physicsExcludedLinks: readonly {
    linkName: string;
    recoveryDisposition: string;
  }[];
  repeatedInertiaDiagnostics: readonly RepeatedInertiaDiagnosticGroup[];
  robotMirrorScopeKey: string | null;
  robotMirrorSymmetryCheck: RobotMirrorSymmetryCheck | null;
  robotMirrorVisualizationLinkNames: readonly string[];
  setActiveScopeKey: Dispatch<SetStateAction<string | null>>;
  setHoveredPreview: Dispatch<SetStateAction<SimulationPrepVisualizationPreview | null>>;
  setInertialVisualization: Dispatch<SetStateAction<InertialVisualizationSettings>>;
  setShowHealthActionPanel: Dispatch<SetStateAction<boolean>>;
};

const haveSameScopedLinkNames = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length && left.every((linkName, index) => linkName === right[index]);

const buildScopeLinkNamesByKey = ({
  displayedSymmetryChains,
  physicsExcludedLinks,
  repeatedInertiaDiagnostics,
  robotMirrorScopeKey,
  robotMirrorVisualizationLinkNames,
}: Pick<
  SimulationPrepVisualizationControllerInput,
  | "displayedSymmetryChains"
  | "physicsExcludedLinks"
  | "repeatedInertiaDiagnostics"
  | "robotMirrorScopeKey"
  | "robotMirrorVisualizationLinkNames"
>): Map<string, readonly string[]> => {
  const scopeLinkNamesByKey = new Map<string, readonly string[]>();
  const voxelRecoveryScopeLinkNames = physicsExcludedLinks
    .filter((entry) => entry.recoveryDisposition === "recover")
    .map((entry) => entry.linkName);
  const psdRegularizeScopeLinkNames = physicsExcludedLinks
    .filter((entry) => entry.recoveryDisposition === "regularize")
    .map((entry) => entry.linkName);

  repeatedInertiaDiagnostics.forEach((group) => {
    scopeLinkNamesByKey.set(
      buildRepeatedInertiaVisualizationScopeKey(group.groupKey),
      group.linkEntries.map((entry) => entry.linkName)
    );
  });
  displayedSymmetryChains.forEach((chain) => {
    scopeLinkNamesByKey.set(
      buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey(chain),
      collectRepeatedInertiaSymmetryFamilyLinkNames(chain)
    );
  });
  if (robotMirrorScopeKey && robotMirrorVisualizationLinkNames.length > 0) {
    scopeLinkNamesByKey.set(robotMirrorScopeKey, robotMirrorVisualizationLinkNames);
  }
  if (voxelRecoveryScopeLinkNames.length > 0) {
    scopeLinkNamesByKey.set(SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY, voxelRecoveryScopeLinkNames);
  }
  if (psdRegularizeScopeLinkNames.length > 0) {
    scopeLinkNamesByKey.set(
      SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY,
      psdRegularizeScopeLinkNames
    );
  }

  return scopeLinkNamesByKey;
};

export const useSimulationPrepVisualizationController = ({
  activeScopeKey,
  displayedSymmetryChains,
  hoveredPreview,
  inertialVisualization,
  physicsExcludedLinks,
  repeatedInertiaDiagnostics,
  robotMirrorScopeKey,
  robotMirrorSymmetryCheck,
  robotMirrorVisualizationLinkNames,
  setActiveScopeKey,
  setHoveredPreview,
  setInertialVisualization,
  setShowHealthActionPanel,
}: SimulationPrepVisualizationControllerInput) => {
  const scopeLinkNamesByKey = useMemo(
    () =>
      buildScopeLinkNamesByKey({
        displayedSymmetryChains,
        physicsExcludedLinks,
        repeatedInertiaDiagnostics,
        robotMirrorScopeKey,
        robotMirrorVisualizationLinkNames,
      }),
    [
      displayedSymmetryChains,
      physicsExcludedLinks,
      repeatedInertiaDiagnostics,
      robotMirrorScopeKey,
      robotMirrorVisualizationLinkNames,
    ]
  );

  const { effectiveScopeKey, effectiveScopedLinkNames } = useMemo(
    () =>
      resolveSimulationPrepVisualizationScope({
        activeScopeKey,
        hoveredPreview,
        scopeLinkNamesByKey,
      }),
    [activeScopeKey, hoveredPreview, scopeLinkNamesByKey]
  );

  const activeSymmetryVisualization = useMemo(
    () =>
      resolveActiveSimulationPrepSymmetryVisualization({
        activeScopeKey: effectiveScopeKey,
        repeatedInertiaSymmetryChains: displayedSymmetryChains,
      }),
    [displayedSymmetryChains, effectiveScopeKey]
  );

  const activeRobotMirrorVisualization = useMemo(
    () =>
      resolveActiveSimulationPrepRobotMirrorVisualization({
        activeScopeKey: effectiveScopeKey,
        robotMirrorSymmetryCheck,
      }),
    [effectiveScopeKey, robotMirrorSymmetryCheck]
  );

  const validScopeKeys = useMemo(() => new Set(scopeLinkNamesByKey.keys()), [scopeLinkNamesByKey]);

  useEffect(() => {
    setInertialVisualization((current) => {
      const currentScopedLinkNames = current.scopedLinkNames ?? null;
      const hasSameScopedLinkNames =
        currentScopedLinkNames === null
          ? effectiveScopedLinkNames === null
          : effectiveScopedLinkNames !== null &&
            haveSameScopedLinkNames(currentScopedLinkNames, effectiveScopedLinkNames);
      if (hasSameScopedLinkNames) {
        return current;
      }
      return syncSimulationPrepInertiaVisualizationScope(current, effectiveScopedLinkNames);
    });
  }, [effectiveScopedLinkNames, setInertialVisualization]);

  useEffect(() => {
    if (!activeScopeKey || validScopeKeys.has(activeScopeKey)) {
      return;
    }

    setActiveScopeKey(null);
    setInertialVisualization((current) => syncSimulationPrepInertiaVisualizationScope(current));
  }, [activeScopeKey, setActiveScopeKey, setInertialVisualization, validScopeKeys]);

  useEffect(() => {
    if (!hoveredPreview || validScopeKeys.has(hoveredPreview.scopeKey)) {
      return;
    }
    setHoveredPreview(null);
  }, [hoveredPreview, setHoveredPreview, validScopeKeys]);

  useEffect(() => {
    if (
      inertialVisualization.scopedLinkNames !== null ||
      activeScopeKey === null ||
      effectiveScopeKey !== null
    ) {
      return;
    }
    setActiveScopeKey(null);
  }, [
    activeScopeKey,
    effectiveScopeKey,
    inertialVisualization.scopedLinkNames,
    setActiveScopeKey,
  ]);

  const handleToggleInertiaVisualizationScope = useCallback(
    (scopeKey: string, linkNames: readonly string[]) => {
      const hasTargetLinks = linkNames.length > 0;
      setHoveredPreview(null);
      setActiveScopeKey((current) => (current === scopeKey || !hasTargetLinks ? null : scopeKey));
      setShowHealthActionPanel(true);
    },
    [setActiveScopeKey, setHoveredPreview, setShowHealthActionPanel]
  );

  const handlePreviewInertiaVisualizationScope = useCallback(
    (scopeKey: string, linkNames: readonly string[]) => {
      if (linkNames.length === 0) {
        return;
      }
      const scopedLinkNames = [...linkNames].sort((left, right) => left.localeCompare(right));
      setHoveredPreview((current) => {
        if (
          current &&
          current.scopeKey === scopeKey &&
          haveSameScopedLinkNames(current.scopedLinkNames, scopedLinkNames)
        ) {
          return current;
        }
        return {
          scopeKey,
          scopedLinkNames,
        };
      });
      setShowHealthActionPanel(true);
    },
    [setHoveredPreview, setShowHealthActionPanel]
  );

  const handleClearInertiaVisualizationPreview = useCallback(() => {
    setHoveredPreview(null);
  }, [setHoveredPreview]);

  return {
    activeRobotMirrorVisualization,
    activeSymmetryVisualization,
    effectiveScopeKey,
    handleClearInertiaVisualizationPreview,
    handlePreviewInertiaVisualizationScope,
    handleToggleInertiaVisualizationScope,
  };
};
