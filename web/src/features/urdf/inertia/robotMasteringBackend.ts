import { analyzeUrdf } from "@/shared/lib/urdfCore";
import { getIluRobotOrientationCard } from "@/shared/lib/iluStudio";
import { lintRobotFrame } from "@/features/urdf/lint/robotFrameLinter";
import { executeMeshBakePlan } from "@/features/urdf/bake/meshBakeProcessor";
import { buildCanonicalSynthesisDraft } from "@/features/urdf/synthesis/canonicalSynthesisDraft";
import {
  buildInertialAuditSummary,
  buildInertialPlausibilitySummary,
  synthesizeInertialsFromGeometry,
} from "@/features/urdf/inertia/inertialSynthesis";
import { buildInertialSynthesisDraft } from "@/features/urdf/inertia/inertialSynthesisDraft";
import type {
  CapturedKinematicState,
} from "@/features/urdf/synthesis/kinematicSynthesizer";
import { synthesizeKinematicPreviewFromCapturedState } from "@/features/urdf/synthesis/kinematicSynthesizer";
import type {
  SupportPlaneOptimizationResult,
} from "@/features/urdf/synthesis/supportPlaneOptimization";
import {
  serializeBlobPayload,
  type SerializedBlobPayload,
} from "@/shared/lib/blobEncoding";
import type {
  RobotMasteringBakeExportExecuteInput,
  RobotMasteringBakeExportExecuteOutput,
  RobotMasteringCanonicalSynthesisInput,
  RobotMasteringCanonicalSynthesisOutput,
  RobotMasteringFramePreflightOutput,
  RobotMasteringGeneratePhysicsInput,
  RobotMasteringGeneratePhysicsOutput,
  RobotMasteringGeneratePhysicsPreflightInput,
  RobotMasteringGeneratePhysicsPreflightOutput,
} from "@/features/urdf/inertia/robotMasteringContracts";
import * as THREE from "three";

const serializeBlob = async (blob: Blob): Promise<SerializedBlobPayload> =>
  await serializeBlobPayload(blob, {
    readErrorMessage: "Failed to serialize baked mesh blob.",
    encodeErrorMessage: "Failed to encode baked mesh blob.",
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
}: RobotMasteringGeneratePhysicsPreflightInput): Promise<RobotMasteringGeneratePhysicsPreflightOutput> => {
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
