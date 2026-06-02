import {
  analyzeUrdfDocument,
  type LinkData,
  type UrdfAnalysis,
} from "@/shared/lib/urdfCore";
import { parseURDF } from "@/shared/lib/urdfBrowser";
import type { MeshFiles } from "@/shared/types/feature";
import { buildLinkCollisionGeometryReferences } from "@/features/viewer/inertiaGeometryReference";
import {
  computeReliableInertiaBox,
  validateInertiaTensor,
  type InertiaTensor,
} from "@/features/viewer/inertialMath";
import {
  adaptRepeatedMeshSynthesisResultsFromRepresentative,
  type ExistingInertialStatus,
  type InertialSynthesisResult,
  type LinkInertialSynthesisResult,
} from "@/features/urdf/inertia/inertialSynthesis";
import { buildInertialSynthesisDraft } from "@/features/urdf/inertia/inertialSynthesisDraft";
import {
  INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID,
  INERTIAL_SYNTHESIS_DENSITY_PRESETS,
} from "@/features/urdf/inertia/inertialSynthesisParams";
import {
  buildRepeatedMeshGroupKey,
  resolveRepeatedMeshBacking,
} from "@/features/urdf/inertia/repeatedMeshBacking";
import {
  isRepeatedInertiaGroupAlreadyConsistent,
} from "@/features/urdf/inertia/repeatedInertiaConsistency";
import { buildRepeatedInertiaDiagnostics } from "@/features/layout/page/repeatedInertiaDiagnostics";

export type RepeatedInertiaManualFixResult =
  | {
      ok: true;
      draftUrdfContent: string;
      groupKey: string;
      meshReference: string;
      linkNames: string[];
      reason: string;
    }
  | {
      ok: false;
      error: string;
      groupKey: string;
      meshReference: string | null;
      linkNames: string[];
    };

export const REPEATED_INERTIA_MANUAL_FIX_REAL_MISMATCH_ERROR =
  "This repeated group has real mass/COM/inertia mismatch. Direct group fix is disabled; use geometry-based regeneration for this group.";
export const REPEATED_INERTIA_MANUAL_FIX_POSTWRITE_MISMATCH_ERROR =
  "Direct fix would still leave this repeated group in a physical mismatch state. Use geometry regeneration instead.";
export const REPEATED_INERTIA_MANUAL_FIX_DIFFERS_TOO_MUCH_ERROR =
  "This repeated group differs too much to unify directly. Use geometry-based regeneration for this group.";
export const REPEATED_INERTIA_MANUAL_FIX_LOW_CONFIDENCE_ERROR =
  "Direct fix would leave this repeated group misaligned with the geometry reference. Use geometry regeneration instead.";
export const REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_ERROR =
  "This repeated group is already consistent. No direct fix is needed.";

export const requiresRepeatedInertiaGeometryRegen = (error: string): boolean =>
  error === REPEATED_INERTIA_MANUAL_FIX_REAL_MISMATCH_ERROR ||
  error === REPEATED_INERTIA_MANUAL_FIX_POSTWRITE_MISMATCH_ERROR ||
  error === REPEATED_INERTIA_MANUAL_FIX_DIFFERS_TOO_MUCH_ERROR ||
  error === REPEATED_INERTIA_MANUAL_FIX_LOW_CONFIDENCE_ERROR;

const DEFAULT_DENSITY_PRESET =
  INERTIAL_SYNTHESIS_DENSITY_PRESETS[INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID];

const resolveExistingInertialStatus = (linkData: LinkData): ExistingInertialStatus => {
  if (!linkData.inertial) {
    return "missing";
  }
  const mass = Number(linkData.inertial.mass ?? 0);
  if (!Number.isFinite(mass) || mass <= 0) {
    return "invalid-mass";
  }
  return validateInertiaTensor(linkData.inertial.inertia).valid ? "valid" : "invalid-tensor";
};

const buildAuthoredRepeatedMeshResult = ({
  linkName,
  linkData,
}: {
  linkName: string;
  linkData: LinkData;
}): LinkInertialSynthesisResult | null => {
  if (!linkData.inertial) {
    return null;
  }
  const mass = Number(linkData.inertial.mass ?? 0);
  if (!Number.isFinite(mass) || mass <= 0) {
    return null;
  }
  const backing = resolveRepeatedMeshBacking(linkData);
  if (!backing) {
    return null;
  }

  return {
    linkName,
    status: "synthesized",
    existingInertialStatus: resolveExistingInertialStatus(linkData),
    densityPresetId: INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID,
    densityLabel: DEFAULT_DENSITY_PRESET?.label ?? INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID,
    sourceKind: backing.source,
    geometryKinds: ["mesh"],
    mass,
    origin: linkData.inertial.origin,
    inertia: linkData.inertial.inertia as InertiaTensor,
    warnings: [],
    diagnostics: null,
    meshSanitization: [],
  };
};

const pickLinkDataByName = (
  linkDataByName: Record<string, LinkData>,
  linkNames: readonly string[]
): Record<string, LinkData> =>
  Object.fromEntries(
    linkNames
      .map((linkName) => {
        const linkData = linkDataByName[linkName];
        return linkData ? [linkName, linkData] : null;
      })
      .filter((entry): entry is [string, LinkData] => entry !== null)
  );

const collectRepeatedGroupConfidenceByLink = async ({
  linkDataByName,
  linkNames,
  meshFiles,
  urdfBasePath,
  packageRoots,
}: {
  linkDataByName: Record<string, LinkData>;
  linkNames: readonly string[];
  meshFiles: MeshFiles;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
}): Promise<Map<string, "high" | "medium" | "low" | "unverified">> => {
  const scopedLinkDataByName = pickLinkDataByName(linkDataByName, linkNames);
  if (Object.keys(scopedLinkDataByName).length === 0) {
    return new Map();
  }

  const geometryReferencesByLink = await buildLinkCollisionGeometryReferences({
    linkDataByName: scopedLinkDataByName,
    meshFiles,
    urdfBasePath,
    packageRoots,
  });

  const confidenceByLink = new Map<string, "high" | "medium" | "low" | "unverified">();
  linkNames.forEach((linkName) => {
    const linkData = scopedLinkDataByName[linkName];
    const inertial = linkData?.inertial;
    if (!inertial) {
      return;
    }
    const mass = Number(inertial.mass ?? 0);
    if (!Number.isFinite(mass) || mass <= 0) {
      return;
    }
    const reliability = computeReliableInertiaBox({
      inertia: inertial.inertia as InertiaTensor,
      mass,
      inertialOrigin: inertial.origin.xyz,
      inertialRpy: inertial.origin.rpy,
      geometryReference: geometryReferencesByLink.get(linkName) ?? null,
    });
    if (!reliability) {
      return;
    }
    confidenceByLink.set(linkName, reliability.confidence);
  });

  return confidenceByLink;
};

const candidateHasWeakGeometryConfidence = async ({
  draftAnalysis,
  linkNames,
  meshFiles,
  urdfBasePath,
  packageRoots,
}: {
  draftAnalysis: UrdfAnalysis;
  linkNames: readonly string[];
  meshFiles: MeshFiles;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
}): Promise<boolean> => {
  const confidenceByLink = await collectRepeatedGroupConfidenceByLink({
    linkDataByName: draftAnalysis.linkDataByName,
    linkNames,
    meshFiles,
    urdfBasePath,
    packageRoots,
  });
  return linkNames.some((linkName) => {
    const confidence = confidenceByLink.get(linkName);
    return confidence === "medium" || confidence === "low";
  });
};

const buildManualRepeatedFixDraft = async ({
  urdfContent,
  urdfAnalysis,
  groupKey,
  meshFiles,
  urdfBasePath,
  packageRoots,
}: {
  urdfContent: string;
  urdfAnalysis: UrdfAnalysis | null;
  groupKey: string;
  meshFiles?: MeshFiles;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
}): Promise<RepeatedInertiaManualFixResult> => {
  if (!urdfAnalysis?.isValid) {
    return {
      ok: false,
      error: "Repeated-part fixes require a valid URDF.",
      groupKey,
      meshReference: null,
      linkNames: [],
    };
  }

  const groupEntries = Object.entries(urdfAnalysis.linkDataByName).filter(([, linkData]) => {
    const backing = resolveRepeatedMeshBacking(linkData);
    return backing ? buildRepeatedMeshGroupKey(backing) === groupKey : false;
  });
  if (groupEntries.length === 0) {
    return {
      ok: false,
      error: "The selected repeated mesh group is no longer available.",
      groupKey,
      meshReference: null,
      linkNames: [],
    };
  }

  const meshReference = resolveRepeatedMeshBacking(groupEntries[0][1])?.meshReference ?? null;
  const linkNames = groupEntries
    .map(([linkName]) => linkName)
    .sort((left, right) => left.localeCompare(right));
  const groupDiagnostics = buildRepeatedInertiaDiagnostics({
    linkDataByName: urdfAnalysis.linkDataByName,
  }).find((entry) => entry.groupKey === groupKey);
  if (groupDiagnostics?.physicalMismatch) {
    return {
      ok: false,
      error: REPEATED_INERTIA_MANUAL_FIX_REAL_MISMATCH_ERROR,
      groupKey,
      meshReference,
      linkNames,
    };
  }
  if (
    meshFiles &&
    (await candidateHasWeakGeometryConfidence({
      draftAnalysis: urdfAnalysis,
      linkNames,
      meshFiles,
      urdfBasePath,
      packageRoots,
    }))
  ) {
    return {
      ok: false,
      error: REPEATED_INERTIA_MANUAL_FIX_LOW_CONFIDENCE_ERROR,
      groupKey,
      meshReference,
      linkNames,
    };
  }
  if (groupDiagnostics && isRepeatedInertiaGroupAlreadyConsistent(groupDiagnostics)) {
    return {
      ok: false,
      error: REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_ERROR,
      groupKey,
      meshReference,
      linkNames,
    };
  }
  const results = groupEntries
    .map(([linkName, linkData]) => buildAuthoredRepeatedMeshResult({ linkName, linkData }))
    .filter((result): result is LinkInertialSynthesisResult => result !== null);
  if (results.length !== groupEntries.length || meshReference === null) {
    return {
      ok: false,
      error: "Only repeated groups with valid authored inertials and one shared mesh per link can be fixed directly.",
      groupKey,
      meshReference,
      linkNames,
    };
  }

  const adapted = adaptRepeatedMeshSynthesisResultsFromRepresentative({
    results,
    linkDataByName: urdfAnalysis.linkDataByName,
  });
  const groupSummary = adapted.summaries.find((summary) => summary.groupKey === groupKey);
  if (!groupSummary || groupSummary.strategy !== "matching-copy") {
    return {
      ok: false,
      error: groupSummary?.reason ?? REPEATED_INERTIA_MANUAL_FIX_DIFFERS_TOO_MUCH_ERROR,
      groupKey,
      meshReference,
      linkNames,
    };
  }

  const draftUrdfContent = buildInertialSynthesisDraft(urdfContent, {
    robotName: urdfAnalysis.robotName ?? null,
    repairMode: "replace-all",
    densityPresetId: INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID,
    densityLabel: DEFAULT_DENSITY_PRESET?.label ?? INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID,
    regularizeNearMissTensors: false,
    results: adapted.results,
  } satisfies InertialSynthesisResult);
  if (!draftUrdfContent) {
    return {
      ok: false,
      error: "Failed to write the repeated-part fix back into the URDF.",
      groupKey,
      meshReference,
      linkNames,
    };
  }

  const reparsedDraft = parseURDF(draftUrdfContent);
  if (!reparsedDraft.isValid) {
    return {
      ok: false,
      error: "The repeated-part fix produced an invalid URDF draft.",
      groupKey,
      meshReference,
      linkNames,
    };
  }
  const draftAnalysis = analyzeUrdfDocument(reparsedDraft.document);
  const draftGroupDiagnostics = buildRepeatedInertiaDiagnostics({
    linkDataByName: draftAnalysis.linkDataByName,
  }).find((entry) => entry.groupKey === groupKey);
  if (!draftGroupDiagnostics || draftGroupDiagnostics.physicalMismatch) {
    return {
      ok: false,
      error: REPEATED_INERTIA_MANUAL_FIX_POSTWRITE_MISMATCH_ERROR,
      groupKey,
      meshReference,
      linkNames,
    };
  }
  if (
    meshFiles &&
    (await candidateHasWeakGeometryConfidence({
      draftAnalysis,
      linkNames,
      meshFiles,
      urdfBasePath,
      packageRoots,
    }))
  ) {
    return {
      ok: false,
      error: REPEATED_INERTIA_MANUAL_FIX_LOW_CONFIDENCE_ERROR,
      groupKey,
      meshReference,
      linkNames,
    };
  }

  return {
    ok: true,
    draftUrdfContent,
    groupKey,
    meshReference,
    linkNames,
    reason: groupSummary.reason,
  };
};

export const applyRepeatedInertiaGroupManualFix = buildManualRepeatedFixDraft;
