import * as THREE from "three";

import { changeJointOrigin } from "@/features/urdf/editor/urdfEditorActions";
import type { RepeatedInertiaDiagnosticGroup } from "@/features/layout/page/repeatedInertiaDiagnostics";
import {
  type RepeatedInertiaSymmetryChain,
} from "@/features/layout/page/repeatedInertiaSymmetry";
import {
  parseRepeatedInertiaSymmetryRobot,
  type ParsedRobot,
  type RepeatedInertiaSymmetryLinkCentersLocal,
} from "@/features/layout/page/repeatedInertiaSymmetryRobot";
import {
  REPEATED_INERTIA_SYMMETRY_REPAIR_MIN_STEP_METERS,
  REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS,
} from "@/features/layout/page/repeatedInertiaSymmetryParams";
import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";

export type RepeatedInertiaSymmetryFixResult =
  | {
      ok: true;
      appliedStepCount: number;
      draftUrdfContent: string;
      mode: NonNullable<RepeatedInertiaSymmetryChain["recommendedRepair"]>["mode"];
      summary: string;
    }
  | {
      ok: false;
      error: string;
    };

export type RepeatedInertiaSymmetryFixProgress = {
  appliedStepCount: number;
  totalStepCount: number;
};

const INVALID_URDF_ERROR = "Symmetry repair requires a valid URDF.";
const NO_REPAIR_PLAN_ERROR = "This symmetry branch does not expose an automatic repair plan.";
const ALREADY_ALIGNED_ERROR =
  "This symmetry branch is already aligned closely enough for automatic repair.";

const buildChainFixSummary = ({
  appliedStepCount,
  chain,
}: {
  appliedStepCount: number;
  chain: RepeatedInertiaSymmetryChain;
}): string => {
  const carriedTargetCount = Math.max(
    0,
    chain.recommendedRepair?.blockedTargetLinkNames.length ?? 0
  );
  const updatedJointLabel = appliedStepCount === 1 ? "joint" : "joints";
  if (carriedTargetCount === 0) {
    return `Updated ${appliedStepCount} ${updatedJointLabel} in branch ${chain.outlierBranchRootLinkName}.`;
  }
  const carriedTargetLabel = carriedTargetCount === 1 ? "target" : "targets";
  return `Updated ${appliedStepCount} ${updatedJointLabel} in branch ${chain.outlierBranchRootLinkName}; ${carriedTargetCount} connected ${carriedTargetLabel} moved with ${appliedStepCount === 1 ? "it" : "them"}.`;
};

const buildOutlierBranchAlignmentError = (
  chain: RepeatedInertiaSymmetryChain,
  linkName: string,
  options: {
    articulatedJointName?: string | null;
    preservedRigidIsland?: boolean;
  } = {}
): string =>
  options.preservedRigidIsland
    ? `Automatic repair preserved the rigid branch pose, but ${linkName} is still off the ideal symmetry guide for branch ${chain.outlierBranchRootLinkName}; sibling copies disagree internally or the visual center is wrong.`
    : options.articulatedJointName
      ? `Automatic repair left ${linkName} off the ideal symmetry guide for branch ${chain.outlierBranchRootLinkName}; residual error remains past articulated joint ${options.articulatedJointName}.`
      : `Automatic repair left ${linkName} off the ideal symmetry guide for branch ${chain.outlierBranchRootLinkName}; this suggests deeper branch asymmetry or an incorrect visual center.`;

const parseSymmetryRobotOrThrow = ({
  linkCentersLocal,
  urdfContent,
}: {
  linkCentersLocal?: RepeatedInertiaSymmetryLinkCentersLocal | null;
  urdfContent: string;
}): ParsedRobot => {
  const robot = parseRepeatedInertiaSymmetryRobot(urdfContent, {
    linkCentersLocal,
  });
  if (!robot) {
    throw new Error(INVALID_URDF_ERROR);
  }
  return robot;
};

const toPositionTuple = (vector: THREE.Vector3): [number, number, number] => [
  vector.x,
  vector.y,
  vector.z,
];

const resolveOutlierBranchRow = (
  chain: RepeatedInertiaSymmetryChain
): RepeatedInertiaSymmetryChain["branchRows"][number] | null =>
  chain.branchRows.find((row) => row.branchRootLinkName === chain.outlierBranchRootLinkName) ?? null;

const resolveTrackedOutlierLinkRows = ({
  chain,
  trackedTargetLinkNames,
}: {
  chain: RepeatedInertiaSymmetryChain;
  trackedTargetLinkNames: ReadonlySet<string>;
}): RepeatedInertiaSymmetryChain["branchRows"][number]["linkRows"] => {
  const outlierBranchRow = resolveOutlierBranchRow(chain);
  if (!outlierBranchRow) {
    return [];
  }
  return outlierBranchRow.linkRows.filter((linkRow) =>
    trackedTargetLinkNames.has(linkRow.linkName)
  );
};

const resolveLinkAlignmentPointWorld = (
  robot: ParsedRobot,
  linkName: string
): THREE.Vector3 | null =>
  robot.linkReferenceCentersWorld.get(linkName) ?? robot.linkWorldPositions.get(linkName) ?? null;

const resolveArticulatedBoundaryJointName = ({
  chain,
  linkName,
  robot,
}: {
  chain: RepeatedInertiaSymmetryChain;
  linkName: string;
  robot: ParsedRobot;
}): string | null => {
  let cursor = linkName;
  while (cursor && cursor !== chain.outlierBranchRootLinkName) {
    const joint = robot.jointByChildLink.get(cursor);
    if (joint && joint.jointType !== "fixed") {
      return joint.jointName;
    }
    cursor = robot.parentByChildLink.get(cursor) ?? "";
  }
  return null;
};

const validateOutlierBranchAlignment = ({
  blockedTargetLinkNames,
  chain,
  linkCentersLocal,
  trackedTargetLinkNames,
  urdfContent,
}: {
  blockedTargetLinkNames: ReadonlySet<string>;
  chain: RepeatedInertiaSymmetryChain;
  linkCentersLocal?: RepeatedInertiaSymmetryLinkCentersLocal | null;
  trackedTargetLinkNames: ReadonlySet<string>;
  urdfContent: string;
}): string | null => {
  const repairedRobot = parseRepeatedInertiaSymmetryRobot(urdfContent, {
    linkCentersLocal,
  });
  if (!repairedRobot) {
    return INVALID_URDF_ERROR;
  }

  const trackedLinkRows = resolveTrackedOutlierLinkRows({
    chain,
    trackedTargetLinkNames,
  });
  if (trackedLinkRows.length === 0) {
    return `Unable to validate branch ${chain.outlierBranchRootLinkName}.`;
  }

  for (const linkRow of trackedLinkRows) {
    const actualWorldPosition = resolveLinkAlignmentPointWorld(repairedRobot, linkRow.linkName);
    if (!actualWorldPosition) {
      return buildOutlierBranchAlignmentError(
        chain,
        linkRow.linkName,
        {
          articulatedJointName: resolveArticulatedBoundaryJointName({
            chain,
            linkName: linkRow.linkName,
            robot: repairedRobot,
          }),
        }
      );
    }
    const idealWorldPosition = new THREE.Vector3().fromArray(linkRow.idealPositionMeters);
    const residualDistanceMeters = actualWorldPosition.distanceTo(idealWorldPosition);
    if (residualDistanceMeters >= REPEATED_INERTIA_SYMMETRY_STATUS_OK_MAX_OFFSET_METERS) {
      return buildOutlierBranchAlignmentError(
        chain,
        linkRow.linkName,
        blockedTargetLinkNames.has(linkRow.linkName)
          ? {
              preservedRigidIsland: true,
            }
          : {
              articulatedJointName: resolveArticulatedBoundaryJointName({
                chain,
                linkName: linkRow.linkName,
                robot: repairedRobot,
              }),
            }
      );
    }
  }

  return null;
};

export const applyRepeatedInertiaSymmetryFix = async ({
  chain,
  linkCentersLocal,
  repeatedInertiaDiagnostics: _repeatedInertiaDiagnostics,
  urdfContent,
  onProgress,
}: {
  chain: RepeatedInertiaSymmetryChain;
  linkCentersLocal?: RepeatedInertiaSymmetryLinkCentersLocal | null;
  repeatedInertiaDiagnostics?: readonly RepeatedInertiaDiagnosticGroup[] | null;
  urdfContent: string;
  onProgress?: ((progress: RepeatedInertiaSymmetryFixProgress) => Promise<void> | void) | undefined;
}): Promise<RepeatedInertiaSymmetryFixResult> => {
  const repairPlan = chain.recommendedRepair;
  if (!repairPlan || repairPlan.steps.length === 0) {
    return {
      ok: false,
      error: NO_REPAIR_PLAN_ERROR,
    };
  }

  try {
    parseSymmetryRobotOrThrow({
      linkCentersLocal,
      urdfContent,
    });
  } catch (error) {
    return {
      ok: false,
      error: readUnknownErrorMessage(error, INVALID_URDF_ERROR),
    };
  }

  let nextUrdfContent = urdfContent;
  let appliedStepCount = 0;
  const totalStepCount = Math.max(repairPlan.stepCount, repairPlan.steps.length);
  void _repeatedInertiaDiagnostics;
  const trackedTargetLinkNames = new Set(
    repairPlan.targetLinkNames.length > 0
      ? repairPlan.targetLinkNames
      : repairPlan.steps.map((step) => step.childLinkName)
  );
  const blockedTargetLinkNames = new Set(repairPlan.blockedTargetLinkNames);

  while (true) {
    if (repairPlan.steps.length === 0) {
      break;
    }
    let appliedStepInPass = false;
    for (const step of repairPlan.steps) {
      const currentRobot = parseSymmetryRobotOrThrow({
        linkCentersLocal,
        urdfContent: nextUrdfContent,
      });
      const joint = currentRobot.jointByChildLink.get(step.childLinkName);
      const parentMatrix = currentRobot.linkWorldMatrices.get(step.parentLinkName);
      const currentLinkPosition = currentRobot.linkWorldPositions.get(step.childLinkName);
      const currentAlignmentPoint = resolveLinkAlignmentPointWorld(
        currentRobot,
        step.childLinkName
      );
      if (!joint || !parentMatrix || !currentLinkPosition || !currentAlignmentPoint) {
        continue;
      }

      const targetAlignmentPoint = new THREE.Vector3().fromArray(step.targetPositionMeters);
      const translationDeltaWorld = targetAlignmentPoint.clone().sub(currentAlignmentPoint);
      const translationDelta = translationDeltaWorld.length();
      if (translationDelta < REPEATED_INERTIA_SYMMETRY_REPAIR_MIN_STEP_METERS) {
        continue;
      }
      // Preserve authored `rpy`; auto-align only moves the joint origin position.
      const targetLinkPosition = currentLinkPosition.clone().add(translationDeltaWorld);
      const targetLocalPosition = targetLinkPosition.applyMatrix4(
        new THREE.Matrix4().copy(parentMatrix).invert()
      );
      const result = changeJointOrigin(
        nextUrdfContent,
        step.jointName,
        toPositionTuple(targetLocalPosition),
        joint.originRpy
      );
      if (!result.success) {
        throw new Error(result.error ?? `Unable to update origin for joint "${step.jointName}"`);
      }
      nextUrdfContent = result.content;
      appliedStepCount += 1;
      if (onProgress) {
        await onProgress({
          appliedStepCount,
          totalStepCount,
        });
      }
      appliedStepInPass = true;
      break;
    }

    if (!appliedStepInPass) {
      break;
    }
  }

  if (appliedStepCount === 0) {
    return {
      ok: false,
      error: ALREADY_ALIGNED_ERROR,
    };
  }

  const validationError = validateOutlierBranchAlignment({
    blockedTargetLinkNames,
    chain,
    linkCentersLocal,
    trackedTargetLinkNames,
    urdfContent: nextUrdfContent,
  });
  if (validationError) {
    return {
      ok: false,
      error: validationError,
    };
  }

  return {
    ok: true,
    appliedStepCount,
    draftUrdfContent: nextUrdfContent,
    mode: repairPlan.mode,
    summary: buildChainFixSummary({
      appliedStepCount,
      chain,
    }),
  };
};
