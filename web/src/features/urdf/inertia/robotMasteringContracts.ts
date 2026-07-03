import type {
  MeshBakePlanExecutionInput,
  MeshBakePlanExecutionResult,
} from "@/features/urdf/bake/meshBakeProcessor";
import type {
  InertialAuditSummary,
  InertialMeshSolveMode,
  InertialPlausibilitySummary,
  InertialRepairMode,
  InertialSynthesisResult,
} from "@/features/urdf/inertia/inertialSynthesis";
import type { InertialDensityPresetId } from "@/features/urdf/inertia/inertialSynthesisParams";
import type { RobotFrameLintResult } from "@/features/urdf/lint/robotFrameLinter";
import type {
  CapturedKinematicState,
  KinematicSynthesisPreview,
} from "@/features/urdf/synthesis/kinematicSynthesizer";
import type { SupportPlaneAxis } from "@/features/urdf/synthesis/supportPlaneOptimization";
import type { SerializedBlobPayload } from "@/shared/lib/blobEncoding";
import type { RobotOrientationCard } from "@/shared/lib/urdfCore";

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

export type RobotMasteringGeneratePhysicsPreflightInput = Omit<
  RobotMasteringGeneratePhysicsInput,
  "densityPresetId" | "repairMode"
>;

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
  planEntries: MeshBakePlanExecutionInput["plan"]["entries"];
  planConflicts: MeshBakePlanExecutionInput["plan"]["conflicts"];
  meshFiles: MeshBakePlanExecutionInput["meshFiles"];
  urdfBasePath?: MeshBakePlanExecutionInput["urdfBasePath"];
  packageRoots?: MeshBakePlanExecutionInput["packageRoots"];
};

export type RobotMasteringBakeExportSerializedSidecar = {
  filename: string;
  blob: SerializedBlobPayload;
};

export type RobotMasteringBakeExportSerializedOverride = {
  sourceReference: string;
  resolvedPath: string;
  outputFilename: string;
  blob: SerializedBlobPayload;
  sidecars: RobotMasteringBakeExportSerializedSidecar[];
};

export type RobotMasteringBakeExportExecuteOutput = {
  overrides: RobotMasteringBakeExportSerializedOverride[];
  unsupported: MeshBakePlanExecutionResult["unsupported"];
};

export type RobotMasteringCanonicalSupportPlane = {
  success: boolean;
  confidence: number;
  evidence: string;
  inferredUpAxis?: SupportPlaneAxis | null;
  inferredUpSign?: 1 | -1 | null;
  targetUpAxis?: "z" | null;
  targetUpSign?: 1 | null;
  fallbackReason?: string | null;
};

export type RobotMasteringCanonicalSynthesisInput = {
  sourceUrdf: string;
  synthesisSourceUrdf: string;
  robotName: string | null;
  capturedLinkWorldPoses: CapturedKinematicState["capturedLinkWorldPoses"];
  supportPlane: RobotMasteringCanonicalSupportPlane;
};

export type RobotMasteringCanonicalSynthesisPreview = Omit<
  KinematicSynthesisPreview,
  "supportPlane"
> & {
  supportPlane: RobotMasteringCanonicalSupportPlane;
};

export type RobotMasteringCanonicalSynthesisOutput = {
  preview: RobotMasteringCanonicalSynthesisPreview;
  draftContent: string;
};
