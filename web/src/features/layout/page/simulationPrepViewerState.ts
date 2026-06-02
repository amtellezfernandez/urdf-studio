import type { InertialVisualizationSettings } from "@/shared/types/feature";
import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import type { RobotMirrorActionableSelection } from "@/features/layout/page/robotMirrorSymmetryFix";

export const SIMULATION_PREP_VOXEL_RECOVERY_SCOPE_KEY = "physics:voxel-recovery";
export const SIMULATION_PREP_PSD_REGULARIZE_SCOPE_KEY = "physics:psd-regularize";

const REPEATED_INERTIA_SCOPE_PREFIX = "repeated:";
const REPEATED_INERTIA_SYMMETRY_SCOPE_PREFIX = "symmetry:";
const REPEATED_INERTIA_SYMMETRY_FAMILY_SCOPE_PREFIX = "symmetry-family:";
const REPEATED_INERTIA_SYMMETRY_FAMILY_OUTCOME_PREFIX = "symmetry-outcome:";
const ROBOT_MIRROR_SYMMETRY_SCOPE_PREFIX = "robot-mirror:";

export type SimulationPrepVisualizationPreview = {
  scopedLinkNames: readonly string[];
  scopeKey: string;
};

export type RobotMirrorVisualizationState = Pick<
  RobotMirrorActionableSelection,
  "deemphasizedVisualizationLinkNames" | "visualizationLinkNames"
>;

const EMPTY_ROBOT_MIRROR_VISUALIZATION_STATE: RobotMirrorVisualizationState = {
  deemphasizedVisualizationLinkNames: [],
  visualizationLinkNames: [],
};

export const createEmptyRobotMirrorVisualizationState = (): RobotMirrorVisualizationState => ({
  ...EMPTY_ROBOT_MIRROR_VISUALIZATION_STATE,
});

const DEFAULT_INERTIAL_VISUALIZATION_SETTINGS: InertialVisualizationSettings = {
  showGlobalCOM: true,
  showLinkCOM: false,
  showInertia: false,
  showReferenceGeometry: false,
  scopedLinkNames: null,
};

export const createDefaultInertialVisualizationSettings = (): InertialVisualizationSettings => ({
  ...DEFAULT_INERTIAL_VISUALIZATION_SETTINGS,
});

const toSortedUniqueScopedLinkNames = (
  scopedLinkNames: readonly string[] | null | undefined
): string[] | null => {
  if (!scopedLinkNames || scopedLinkNames.length === 0) {
    return null;
  }

  const uniqueNames = Array.from(
    new Set(scopedLinkNames.map((linkName) => linkName.trim()).filter(Boolean))
  ).sort((left, right) => left.localeCompare(right));

  return uniqueNames.length > 0 ? uniqueNames : null;
};

export const buildRepeatedInertiaVisualizationScopeKey = (groupKey: string): string =>
  `${REPEATED_INERTIA_SCOPE_PREFIX}${groupKey}`;

export const buildRepeatedInertiaSymmetryVisualizationScopeKey = ({
  outlierBranchRootLinkName,
  symmetryRootLinkName,
}: {
  outlierBranchRootLinkName: string;
  symmetryRootLinkName: string;
}): string =>
  `${REPEATED_INERTIA_SYMMETRY_SCOPE_PREFIX}${symmetryRootLinkName}:${outlierBranchRootLinkName}`;

export const buildRepeatedInertiaSymmetryFamilyKey = ({
  outlierBranchRootLinkName,
  siblingBranchRootLinkNames,
  symmetryRootLinkName,
}: Pick<
  RepeatedInertiaSymmetryChain,
  "outlierBranchRootLinkName" | "siblingBranchRootLinkNames" | "symmetryRootLinkName"
>): string => {
  const familyBranchRootLinkNames = toSortedUniqueScopedLinkNames([
    outlierBranchRootLinkName,
    ...siblingBranchRootLinkNames,
  ]) ?? [outlierBranchRootLinkName];
  return `${symmetryRootLinkName}:${familyBranchRootLinkNames.join(",")}`;
};

export const buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey = (
  chain: Pick<
    RepeatedInertiaSymmetryChain,
    "outlierBranchRootLinkName" | "siblingBranchRootLinkNames" | "symmetryRootLinkName"
  >
): string =>
  `${REPEATED_INERTIA_SYMMETRY_FAMILY_SCOPE_PREFIX}${buildRepeatedInertiaSymmetryFamilyKey(chain)}`;

export const buildRepeatedInertiaSymmetryFamilyOutcomeKey = (
  chain: Pick<
    RepeatedInertiaSymmetryChain,
    "outlierBranchRootLinkName" | "siblingBranchRootLinkNames" | "symmetryRootLinkName"
  >
): string =>
  `${REPEATED_INERTIA_SYMMETRY_FAMILY_OUTCOME_PREFIX}${buildRepeatedInertiaSymmetryFamilyKey(chain)}`;

export const mergeDisplayedRepeatedInertiaSymmetryChains = ({
  pinnedChains,
  repeatedInertiaSymmetryChains,
}: {
  pinnedChains: readonly RepeatedInertiaSymmetryChain[];
  repeatedInertiaSymmetryChains: readonly RepeatedInertiaSymmetryChain[];
}): RepeatedInertiaSymmetryChain[] => {
  const mergedChains: RepeatedInertiaSymmetryChain[] = [];
  const includedFamilyKeys = new Set<string>();

  repeatedInertiaSymmetryChains.forEach((chain) => {
    const familyKey = buildRepeatedInertiaSymmetryFamilyKey(chain);
    if (includedFamilyKeys.has(familyKey)) {
      return;
    }
    includedFamilyKeys.add(familyKey);
    mergedChains.push(chain);
  });

  pinnedChains.forEach((chain) => {
    const familyKey = buildRepeatedInertiaSymmetryFamilyKey(chain);
    if (includedFamilyKeys.has(familyKey)) {
      return;
    }
    includedFamilyKeys.add(familyKey);
    mergedChains.push(chain);
  });

  return mergedChains;
};

export const buildRobotMirrorSymmetryVisualizationScopeKey = ({
  planeLabel,
}: Pick<RobotMirrorSymmetryCheck, "planeLabel">): string =>
  `${ROBOT_MIRROR_SYMMETRY_SCOPE_PREFIX}${planeLabel}`;

export const resolveActiveSimulationPrepSymmetryVisualization = ({
  activeScopeKey,
  repeatedInertiaSymmetryChains,
}: {
  activeScopeKey: string | null;
  repeatedInertiaSymmetryChains: readonly RepeatedInertiaSymmetryChain[];
}): RepeatedInertiaSymmetryChain | null => {
  if (!activeScopeKey) {
    return null;
  }

  return (
    repeatedInertiaSymmetryChains.find(
      (chain) => buildRepeatedInertiaSymmetryVisualizationFamilyScopeKey(chain) === activeScopeKey
    ) ?? null
  );
};

export const resolveActiveSimulationPrepRobotMirrorVisualization = ({
  activeScopeKey,
  robotMirrorSymmetryCheck,
}: {
  activeScopeKey: string | null;
  robotMirrorSymmetryCheck: RobotMirrorSymmetryCheck | null | undefined;
}): RobotMirrorSymmetryCheck | null => {
  if (!activeScopeKey || !robotMirrorSymmetryCheck) {
    return null;
  }

  return buildRobotMirrorSymmetryVisualizationScopeKey(robotMirrorSymmetryCheck) === activeScopeKey
    ? robotMirrorSymmetryCheck
    : null;
};

export const collectRepeatedInertiaSymmetryScopedLinkNames = (
  chain: RepeatedInertiaSymmetryChain
): string[] => {
  const outlierBranchLinks =
    chain.branchLinkGroups.find(
      (branchLinkGroup) => branchLinkGroup.branchRootLinkName === chain.outlierBranchRootLinkName
    )?.linkNames ?? [];
  if (outlierBranchLinks.length > 0) {
    return toSortedUniqueScopedLinkNames(outlierBranchLinks) ?? [];
  }
  return (
    toSortedUniqueScopedLinkNames([
      chain.outlierBranchRootLinkName,
      ...chain.affectedLinkNames,
    ]) ?? []
  );
};

export const collectRepeatedInertiaSymmetryFamilyLinkNames = (
  chain: RepeatedInertiaSymmetryChain
): string[] => {
  const familyBranchLinks = chain.branchLinkGroups.flatMap((branchLinkGroup) => branchLinkGroup.linkNames);
  if (familyBranchLinks.length > 0) {
    return toSortedUniqueScopedLinkNames(familyBranchLinks) ?? [];
  }
  return collectRepeatedInertiaSymmetryScopedLinkNames(chain);
};

export const collectRobotMirrorSymmetryVisualizationLinkNames = (
  check: RobotMirrorSymmetryCheck
): string[] =>
  toSortedUniqueScopedLinkNames(
    check.centeredLinkNames.length > 0 ? check.centeredLinkNames : check.supportedLinkNames
  ) ?? [];

export const resolveSimulationPrepVisualizationScope = ({
  activeScopeKey,
  hoveredPreview,
  scopeLinkNamesByKey,
}: {
  activeScopeKey: string | null;
  hoveredPreview: SimulationPrepVisualizationPreview | null;
  scopeLinkNamesByKey: ReadonlyMap<string, readonly string[]>;
}): {
  effectiveScopeKey: string | null;
  effectiveScopedLinkNames: string[] | null;
} => {
  if (hoveredPreview) {
    return {
      effectiveScopeKey: hoveredPreview.scopeKey,
      effectiveScopedLinkNames: toSortedUniqueScopedLinkNames(hoveredPreview.scopedLinkNames),
    };
  }
  if (!activeScopeKey) {
    return {
      effectiveScopeKey: null,
      effectiveScopedLinkNames: null,
    };
  }
  return {
    effectiveScopeKey: activeScopeKey,
    effectiveScopedLinkNames: toSortedUniqueScopedLinkNames(
      scopeLinkNamesByKey.get(activeScopeKey) ?? null
    ),
  };
};

export const withSimulationPrepInertiaVisualization = (
  current: InertialVisualizationSettings,
  scopedLinkNames?: readonly string[] | null
): InertialVisualizationSettings => ({
  ...current,
  showInertia: true,
  showReferenceGeometry: true,
  scopedLinkNames: toSortedUniqueScopedLinkNames(scopedLinkNames),
});

export const syncSimulationPrepInertiaVisualizationScope = (
  current: InertialVisualizationSettings,
  scopedLinkNames?: readonly string[] | null
): InertialVisualizationSettings => ({
  ...current,
  scopedLinkNames: toSortedUniqueScopedLinkNames(scopedLinkNames),
});

export const resolveRobotMirrorVisualizationState = ({
  nextSelection,
  previousState,
  reset = false,
}: {
  nextSelection?: RobotMirrorActionableSelection | null;
  previousState: RobotMirrorVisualizationState;
  reset?: boolean;
}): RobotMirrorVisualizationState => {
  if (reset) {
    return createEmptyRobotMirrorVisualizationState();
  }
  if (!nextSelection) {
    return {
      deemphasizedVisualizationLinkNames: [...previousState.deemphasizedVisualizationLinkNames],
      visualizationLinkNames: [...previousState.visualizationLinkNames],
    };
  }
  return {
    deemphasizedVisualizationLinkNames: [...nextSelection.deemphasizedVisualizationLinkNames],
    visualizationLinkNames: [...nextSelection.visualizationLinkNames],
  };
};
