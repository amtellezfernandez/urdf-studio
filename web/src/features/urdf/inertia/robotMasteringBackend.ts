import { analyzeUrdf } from "@/shared/lib/urdfCore";
import { getIluRobotOrientationCard } from "@/shared/lib/iluStudio";
import { lintRobotFrame, type RobotFrameLintResult } from "@/features/urdf/lint/robotFrameLinter";
import { executeMeshBakePlan } from "@/features/urdf/bake/meshBakeProcessor";
import { buildCanonicalSynthesisDraft } from "@/features/urdf/synthesis/canonicalSynthesisDraft";
import {
  buildInertialAuditSummary,
  buildInertialPlausibilitySummary,
  synthesizeInertialsFromGeometry,
  type InertialMeshSolveMode,
  type InertialPlausibilitySummary,
  type InertialRepairMode,
  type InertialSynthesisResult,
  type InertialAuditSummary,
} from "@/features/urdf/inertia/inertialSynthesis";
import { buildInertialSynthesisDraft } from "@/features/urdf/inertia/inertialSynthesisDraft";
import type { InertialDensityPresetId } from "@/features/urdf/inertia/inertialSynthesisParams";
import type { RobotOrientationCard } from "@/shared/lib/urdfCore";
import type { UrdfBakedMeshPlan } from "@/features/urdf/bake/virtualBake";
import type {
  CapturedKinematicState,
  KinematicSynthesisPreview,
} from "@/features/urdf/synthesis/kinematicSynthesizer";
import { synthesizeKinematicPreviewFromCapturedState } from "@/features/urdf/synthesis/kinematicSynthesizer";
import type {
  SupportPlaneAxis,
  SupportPlaneOptimizationResult,
} from "@/features/urdf/synthesis/supportPlaneOptimization";
import * as THREE from "three";

export type RobotMasteringGeneratePhysicsInput = {
  sourceUrdf: string;
  meshFiles: Record<string, Blob>;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  densityPresetId: InertialDensityPresetId;
  repairMode: InertialRepairMode;
  linkNames?: string[];
  meshSolveMode?: InertialMeshSolveMode;
  regularizeNearMissTensors?: boolean;
  canonicalizeRepeatedMeshes?: boolean;
};

export type RobotMasteringGeneratePhysicsOutput = {
  draftUrdfContent: string;
  auditSummary: InertialAuditSummary | null;
  synthesisResult: InertialSynthesisResult;
  plausibilitySummary: InertialPlausibilitySummary | null;
};

export type RobotMasteringGeneratePhysicsPreflightOutput = {
  auditSummary: InertialAuditSummary | null;
  plausibilitySummary: InertialPlausibilitySummary | null;
};

export type RobotMasteringFramePreflightOutput = {
  orientationCard: RobotOrientationCard | null;
  frameLint: RobotFrameLintResult | null;
};

export type RobotMasteringBakeExportExecuteInput = {
  planEntries: UrdfBakedMeshPlan["entries"];
  planConflicts: UrdfBakedMeshPlan["conflicts"];
  meshFiles: Record<string, Blob>;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
};

type SerializedBlob = {
  base64Content: string;
  mimeType: string | null;
};

type SerializedSidecar = {
  filename: string;
  blob: SerializedBlob;
};

type SerializedOverride = {
  sourceReference: string;
  resolvedPath: string;
  outputFilename: string;
  blob: SerializedBlob;
  sidecars: SerializedSidecar[];
};

export type RobotMasteringBakeExportExecuteOutput = {
  overrides: SerializedOverride[];
  unsupported: Awaited<ReturnType<typeof executeMeshBakePlan>>["unsupported"];
};

export type RobotMasteringCanonicalSynthesisInput = {
  sourceUrdf: string;
  synthesisSourceUrdf: string;
  robotName: string | null;
  capturedLinkWorldPoses: CapturedKinematicState["capturedLinkWorldPoses"];
  supportPlane: {
    success: boolean;
    confidence: number;
    evidence: string;
    inferredUpAxis?: SupportPlaneAxis | null;
    inferredUpSign?: 1 | -1 | null;
    targetUpAxis?: "z" | null;
    targetUpSign?: 1 | null;
    fallbackReason?: string | null;
  };
};

export type RobotMasteringCanonicalSynthesisOutput = {
  preview: {
    robotName: string | null;
    rootLinkName: string;
    linkCount: number;
    jointCount: number;
    supportPlane: RobotMasteringCanonicalSynthesisInput["supportPlane"];
    links: KinematicSynthesisPreview["links"];
    joints: KinematicSynthesisPreview["joints"];
    sampleJoints: KinematicSynthesisPreview["sampleJoints"];
  };
  draftContent: string;
};

const blobToBase64 = async (blob: Blob): Promise<string> =>
  await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to serialize baked mesh blob."));
    };
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = dataUrl.indexOf(",");
      if (commaIndex < 0) {
        reject(new Error("Failed to encode baked mesh blob."));
        return;
      }
      resolve(dataUrl.slice(commaIndex + 1));
    };
    reader.readAsDataURL(blob);
  });

const serializeBlob = async (blob: Blob): Promise<SerializedBlob> => ({
  base64Content: await blobToBase64(blob),
  mimeType: blob.type || null,
});

export const runBakeExportExecute = async ({
  planEntries,
  planConflicts,
  meshFiles,
  urdfBasePath,
  packageRoots,
}: RobotMasteringBakeExportExecuteInput): Promise<RobotMasteringBakeExportExecuteOutput> => {
  const bakeExecution = await executeMeshBakePlan({
    plan: {
      entries: planEntries,
      conflicts: planConflicts,
    },
    meshFiles,
    urdfBasePath,
    packageRoots,
  });

  const overrides = await Promise.all(
    bakeExecution.overrides.map(async (override) => ({
      sourceReference: override.sourceReference,
      resolvedPath: override.resolvedPath,
      outputFilename: override.outputFilename,
      blob: await serializeBlob(override.blob),
      sidecars: await Promise.all(
        override.sidecars.map(async (sidecar) => ({
          filename: sidecar.filename,
          blob: await serializeBlob(sidecar.blob),
        }))
      ),
    }))
  );

  return {
    overrides,
    unsupported: bakeExecution.unsupported,
  };
};

const toSupportPlaneResult = (
  supportPlane: RobotMasteringCanonicalSynthesisInput["supportPlane"]
): SupportPlaneOptimizationResult => {
  if (supportPlane.success) {
    return {
      success: true,
      inferredUpAxis: supportPlane.inferredUpAxis ?? "z",
      inferredUpSign: supportPlane.inferredUpSign ?? 1,
      targetUpAxis: supportPlane.targetUpAxis ?? "z",
      targetUpSign: supportPlane.targetUpSign ?? 1,
      confidence: supportPlane.confidence,
      alignmentQuaternion: new THREE.Quaternion(),
      alignmentMatrix: new THREE.Matrix4(),
      candidates: [],
      evidence: supportPlane.evidence,
    };
  }

  return {
    success: false,
    fallbackReason: supportPlane.fallbackReason ?? "Support-plane inference failed.",
    confidence: 0,
    candidates: [],
    evidence: supportPlane.evidence,
  };
};

export const runCanonicalSynthesis = async ({
  sourceUrdf,
  synthesisSourceUrdf,
  robotName,
  capturedLinkWorldPoses,
  supportPlane,
}: RobotMasteringCanonicalSynthesisInput): Promise<RobotMasteringCanonicalSynthesisOutput> => {
  const capturedState: CapturedKinematicState = {
    robotName,
    capturedLinkWorldPoses,
    supportPlane: toSupportPlaneResult(supportPlane),
  };
  const preview = synthesizeKinematicPreviewFromCapturedState({
    urdfContent: sourceUrdf,
    capturedState,
  });
  if (!preview) {
    throw new Error("Failed to synthesize a canonical preview from the captured robot state.");
  }
  const draftContent = buildCanonicalSynthesisDraft(synthesisSourceUrdf, preview);
  if (!draftContent) {
    throw new Error("Failed to generate a canonical URDF draft from the captured synthesis.");
  }

  return {
    preview: {
      robotName: preview.robotName,
      rootLinkName: preview.rootLinkName,
      linkCount: preview.linkCount,
      jointCount: preview.jointCount,
      supportPlane,
      links: preview.links,
      joints: preview.joints,
      sampleJoints: preview.sampleJoints,
    },
    draftContent,
  };
};

export const runFramePreflight = async ({
  sourceUrdf,
}: {
  sourceUrdf: string;
}): Promise<RobotMasteringFramePreflightOutput> => {
  const trimmedUrdf = sourceUrdf.trim();
  if (!trimmedUrdf) {
    return {
      orientationCard: null,
      frameLint: null,
    };
  }

  return {
    orientationCard: getIluRobotOrientationCard(trimmedUrdf),
    frameLint: lintRobotFrame(trimmedUrdf),
  };
};

export const runGeneratePhysicsPreflight = async ({
  sourceUrdf,
  meshFiles,
  urdfBasePath,
  packageRoots,
}: Omit<
  RobotMasteringGeneratePhysicsInput,
  "densityPresetId" | "repairMode"
>): Promise<RobotMasteringGeneratePhysicsPreflightOutput> => {
  const urdfAnalysis = analyzeUrdf(sourceUrdf);
  if (!urdfAnalysis?.isValid) {
    throw new Error("Failed to analyze URDF for backend physics preflight.");
  }

  return {
    auditSummary: buildInertialAuditSummary(urdfAnalysis),
    plausibilitySummary: await buildInertialPlausibilitySummary({
      urdfAnalysis,
      meshFiles,
      urdfBasePath,
      packageRoots,
    }),
  };
};

export const runGeneratePhysicsMastering = async ({
  sourceUrdf,
  meshFiles,
  urdfBasePath,
  packageRoots,
  densityPresetId,
  repairMode,
  linkNames,
  meshSolveMode,
  regularizeNearMissTensors,
  canonicalizeRepeatedMeshes,
}: RobotMasteringGeneratePhysicsInput): Promise<RobotMasteringGeneratePhysicsOutput> => {
  const urdfAnalysis = analyzeUrdf(sourceUrdf);
  if (!urdfAnalysis?.isValid) {
    throw new Error("Failed to analyze URDF for backend physics generation.");
  }

  const [synthesisResult, plausibilitySummary] = await Promise.all([
    synthesizeInertialsFromGeometry({
      urdfAnalysis,
      meshFiles,
      urdfBasePath,
      packageRoots,
      densityPresetId,
      repairMode,
      linkNames,
      meshSolveMode,
      regularizeNearMissTensors,
      canonicalizeRepeatedMeshes,
    }),
    buildInertialPlausibilitySummary({
      urdfAnalysis,
      meshFiles,
      urdfBasePath,
      packageRoots,
    }),
  ]);

  if (!synthesisResult) {
    throw new Error("Failed to synthesize inertials from the provided robot geometry.");
  }

  const draftUrdfContent = buildInertialSynthesisDraft(sourceUrdf, synthesisResult);
  if (!draftUrdfContent) {
    throw new Error("Failed to build an inertial synthesis draft URDF.");
  }

  return {
    draftUrdfContent,
    auditSummary: buildInertialAuditSummary(urdfAnalysis),
    synthesisResult,
    plausibilitySummary,
  };
};
