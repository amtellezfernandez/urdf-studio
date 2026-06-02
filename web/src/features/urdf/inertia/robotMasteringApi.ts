import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import type { RobotFrameLintResult } from "@/features/urdf/lint/robotFrameLinter";
import type {
  InertialAuditSummary,
  InertialMeshSolveMode,
  InertialPlausibilitySummary,
  InertialRepairMode,
  InertialSynthesisResult,
} from "@/features/urdf/inertia/inertialSynthesis";
import type { InertialDensityPresetId } from "@/features/urdf/inertia/inertialSynthesisParams";
import type { RobotOrientationCard } from "@/shared/lib/urdfCore";
import {
  ROBOT_MASTERING_JOB_POLL_INTERVAL_MS,
  ROBOT_MASTERING_JOB_TIMEOUT_MS,
} from "./robotMasteringApiParams";
import type { UrdfBakedMeshPlan } from "@/features/urdf/bake/virtualBake";
import type { MeshBakePlanExecutionResult } from "@/features/urdf/bake/meshBakeProcessor";
import type { CapturedKinematicState } from "@/features/urdf/synthesis/kinematicSynthesizer";
import type { SynthesizedUrdfJointFrame, SynthesizedUrdfLinkFrame } from "@/features/urdf/synthesis/kinematicSynthesizer";
import type { SupportPlaneAxis } from "@/features/urdf/synthesis/supportPlaneOptimization";

const CORE_API_OPTIONS = {
  requiredBackends: ["core-api"] as const,
};

type RobotMasteringMeshFilePayload = {
  path: string;
  base64Content: string;
  mimeType: string | null;
};

type GeneratePhysicsJobRequest = {
  jobType: "generate-physics";
  sourceUrdf: string;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  meshFiles: RobotMasteringMeshFilePayload[];
  densityPresetId: InertialDensityPresetId;
  repairMode: InertialRepairMode;
  linkNames?: string[];
  meshSolveMode?: InertialMeshSolveMode;
  regularizeNearMissTensors?: boolean;
  canonicalizeRepeatedMeshes?: boolean;
};

type GeneratePhysicsPreflightRequest = {
  sourceUrdf: string;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  meshFiles: RobotMasteringMeshFilePayload[];
};

type FramePreflightRequest = {
  sourceUrdf: string;
};

type BakeExportExecuteRequest = {
  planEntries: UrdfBakedMeshPlan["entries"];
  planConflicts: UrdfBakedMeshPlan["conflicts"];
  meshFiles: RobotMasteringMeshFilePayload[];
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
};

type CanonicalSynthesisRequest = {
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

type RobotMasteringJobCreatedResponse = {
  jobId: string;
  jobType: "generate-physics";
  status: "queued" | "running" | "succeeded" | "failed";
};

type RobotMasteringJobStatusResponse = {
  jobId: string;
  jobType: "generate-physics";
  status: "queued" | "running" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  error?: string | null;
};

export type GeneratePhysicsJobResult = {
  jobId: string;
  jobType: "generate-physics";
  draftUrdfContent: string;
  auditSummary: InertialAuditSummary | null;
  synthesisResult: InertialSynthesisResult;
  plausibilitySummary: InertialPlausibilitySummary | null;
};

export type GeneratePhysicsPreflightResult = {
  auditSummary: InertialAuditSummary | null;
  plausibilitySummary: InertialPlausibilitySummary | null;
};

export type FramePreflightResult = {
  orientationCard: RobotOrientationCard | null;
  frameLint: RobotFrameLintResult | null;
};

type SerializedBlobPayload = {
  base64Content: string;
  mimeType: string | null;
};

type BakeExportExecuteResponse = {
  overrides: Array<{
    sourceReference: string;
    resolvedPath: string;
    outputFilename: string;
    blob: SerializedBlobPayload;
    sidecars: Array<{
      filename: string;
      blob: SerializedBlobPayload;
    }>;
  }>;
  unsupported: MeshBakePlanExecutionResult["unsupported"];
};

export type CanonicalSynthesisResult = {
  preview: {
    robotName: string | null;
    rootLinkName: string;
    linkCount: number;
    jointCount: number;
    supportPlane: CanonicalSynthesisRequest["supportPlane"];
    links: SynthesizedUrdfLinkFrame[];
    joints: SynthesizedUrdfJointFrame[];
    sampleJoints: SynthesizedUrdfJointFrame[];
  };
  draftContent: string;
};

const toCanonicalSynthesisSupportPlanePayload = (
  supportPlane: CapturedKinematicState["supportPlane"]
): CanonicalSynthesisRequest["supportPlane"] => {
  if (supportPlane.success) {
    return {
      success: true,
      confidence: supportPlane.confidence,
      evidence: supportPlane.evidence,
      inferredUpAxis: supportPlane.inferredUpAxis,
      inferredUpSign: supportPlane.inferredUpSign,
      targetUpAxis: supportPlane.targetUpAxis,
      targetUpSign: supportPlane.targetUpSign,
    };
  }

  return {
    success: false,
    confidence: 0,
    evidence: supportPlane.evidence,
    fallbackReason:
      "fallbackReason" in supportPlane
        ? supportPlane.fallbackReason
        : "Support-plane inference failed.",
  };
};

const sleep = (delayMs: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const assertOk = async (response: Response, fallbackMessage: string) => {
  if (response.ok) {
    return;
  }
  let detail = fallbackMessage;
  try {
    const payload = (await response.json()) as { detail?: string };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      detail = payload.detail;
    }
  } catch {
    // Ignore malformed backend payloads and use fallback text.
  }
  throw new Error(detail);
};

const blobToBase64 = async (blob: Blob): Promise<string> =>
  await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read mesh blob for backend physics generation."));
    };
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = dataUrl.indexOf(",");
      if (commaIndex < 0) {
        reject(new Error("Failed to encode mesh blob for backend physics generation."));
        return;
      }
      resolve(dataUrl.slice(commaIndex + 1));
    };
    reader.readAsDataURL(blob);
  });

const base64ToBlob = ({
  base64Content,
  mimeType,
}: SerializedBlobPayload): Blob => {
  const binary = atob(base64Content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType ?? "" });
};

const serializeMeshFiles = async (
  meshFiles: Record<string, Blob>
): Promise<RobotMasteringMeshFilePayload[]> => {
  const entries = Object.entries(meshFiles);
  return Promise.all(
    entries.map(async ([path, blob]) => ({
      path,
      base64Content: await blobToBase64(blob),
      mimeType: blob.type || null,
    }))
  );
};

const createGeneratePhysicsJob = async (
  request: GeneratePhysicsJobRequest
): Promise<RobotMasteringJobCreatedResponse> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/robot-mastering/jobs`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
    {
      ...CORE_API_OPTIONS,
      context: "Generate physics",
    }
  );
  await assertOk(response, "Failed to create robot mastering job.");
  return (await response.json()) as RobotMasteringJobCreatedResponse;
};

const fetchGeneratePhysicsPreflight = async (
  request: GeneratePhysicsPreflightRequest
): Promise<GeneratePhysicsPreflightResult> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/robot-mastering/generate-physics/preflight`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
    {
      ...CORE_API_OPTIONS,
      context: "Load physics preflight",
    }
  );
  await assertOk(response, "Failed to load physics preflight.");
  return (await response.json()) as GeneratePhysicsPreflightResult;
};

const fetchFramePreflight = async (request: FramePreflightRequest): Promise<FramePreflightResult> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/robot-mastering/frame-preflight`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
    {
      ...CORE_API_OPTIONS,
      context: "Load frame preflight",
    }
  );
  await assertOk(response, "Failed to load frame preflight.");
  return (await response.json()) as FramePreflightResult;
};

const executeBakeExport = async (
  request: BakeExportExecuteRequest
): Promise<BakeExportExecuteResponse> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/robot-mastering/bake-export/execute`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
    {
      ...CORE_API_OPTIONS,
      context: "Execute bake export",
    }
  );
  await assertOk(response, "Failed to execute bake export.");
  return (await response.json()) as BakeExportExecuteResponse;
};

const executeCanonicalSynthesis = async (
  request: CanonicalSynthesisRequest
): Promise<CanonicalSynthesisResult> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/robot-mastering/canonical-synthesis`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
    {
      ...CORE_API_OPTIONS,
      context: "Execute canonical synthesis",
    }
  );
  await assertOk(response, "Failed to execute canonical synthesis.");
  return (await response.json()) as CanonicalSynthesisResult;
};

const fetchJobStatus = async (jobId: string): Promise<RobotMasteringJobStatusResponse> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/robot-mastering/jobs/${encodeURIComponent(jobId)}`,
    undefined,
    {
      ...CORE_API_OPTIONS,
      context: "Poll robot mastering job",
    }
  );
  await assertOk(response, "Failed to poll robot mastering job.");
  return (await response.json()) as RobotMasteringJobStatusResponse;
};

const fetchGeneratePhysicsResult = async (jobId: string): Promise<GeneratePhysicsJobResult> => {
  const response = await guardedFetch(
    `${API_BASE_URL}/robot-mastering/jobs/${encodeURIComponent(jobId)}/result`,
    undefined,
    {
      ...CORE_API_OPTIONS,
      context: "Load generated physics draft",
    }
  );
  await assertOk(response, "Failed to load generated physics draft.");
  return (await response.json()) as GeneratePhysicsJobResult;
};

export const generatePhysicsDraftViaBackend = async ({
  sourceUrdf,
  urdfBasePath,
  packageRoots,
  meshFiles,
  densityPresetId,
  repairMode,
  linkNames,
  meshSolveMode,
  regularizeNearMissTensors,
  canonicalizeRepeatedMeshes,
}: {
  sourceUrdf: string;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  meshFiles: Record<string, Blob>;
  densityPresetId: InertialDensityPresetId;
  repairMode: InertialRepairMode;
  linkNames?: string[];
  meshSolveMode?: InertialMeshSolveMode;
  regularizeNearMissTensors?: boolean;
  canonicalizeRepeatedMeshes?: boolean;
}): Promise<GeneratePhysicsJobResult> => {
  const created = await createGeneratePhysicsJob({
    jobType: "generate-physics",
    sourceUrdf,
    urdfBasePath,
    packageRoots,
    meshFiles: await serializeMeshFiles(meshFiles),
    densityPresetId,
    repairMode,
    linkNames,
    meshSolveMode,
    regularizeNearMissTensors,
    canonicalizeRepeatedMeshes,
  });

  const deadline = Date.now() + ROBOT_MASTERING_JOB_TIMEOUT_MS;
  let latestStatus: RobotMasteringJobStatusResponse | null = null;
  while (Date.now() <= deadline) {
    latestStatus = await fetchJobStatus(created.jobId);
    if (latestStatus.status === "succeeded") {
      return fetchGeneratePhysicsResult(created.jobId);
    }
    if (latestStatus.status === "failed") {
      throw new Error(latestStatus.error?.trim() || "Robot mastering job failed.");
    }
    await sleep(ROBOT_MASTERING_JOB_POLL_INTERVAL_MS);
  }

  throw new Error(
    latestStatus?.error?.trim() || "Timed out while waiting for robot mastering job completion."
  );
};

export const generatePhysicsPreflightViaBackend = async ({
  sourceUrdf,
  urdfBasePath,
  packageRoots,
  meshFiles,
}: {
  sourceUrdf: string;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  meshFiles: Record<string, Blob>;
}): Promise<GeneratePhysicsPreflightResult> =>
  await fetchGeneratePhysicsPreflight({
    sourceUrdf,
    urdfBasePath,
    packageRoots,
    meshFiles: await serializeMeshFiles(meshFiles),
  });

export const framePreflightViaBackend = async ({
  sourceUrdf,
}: {
  sourceUrdf: string;
}): Promise<FramePreflightResult> =>
  await fetchFramePreflight({
    sourceUrdf,
  });

export const executeBakeExportViaBackend = async ({
  plan,
  meshFiles,
  urdfBasePath,
  packageRoots,
}: {
  plan: UrdfBakedMeshPlan;
  meshFiles: Record<string, Blob>;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
}): Promise<MeshBakePlanExecutionResult> => {
  const result = await executeBakeExport({
    planEntries: plan.entries,
    planConflicts: plan.conflicts,
    meshFiles: await serializeMeshFiles(meshFiles),
    urdfBasePath,
    packageRoots,
  });

  return {
    overrides: result.overrides.map((override) => ({
      sourceReference: override.sourceReference,
      resolvedPath: override.resolvedPath,
      outputFilename: override.outputFilename,
      blob: base64ToBlob(override.blob),
      sidecars: override.sidecars.map((sidecar) => ({
        filename: sidecar.filename,
        blob: base64ToBlob(sidecar.blob),
      })),
    })),
    unsupported: result.unsupported,
  };
};

export const executeCanonicalSynthesisViaBackend = async ({
  sourceUrdf,
  synthesisSourceUrdf,
  capturedState,
}: {
  sourceUrdf: string;
  synthesisSourceUrdf: string;
  capturedState: CapturedKinematicState;
}): Promise<CanonicalSynthesisResult> => {
  return await executeCanonicalSynthesis({
    sourceUrdf,
    synthesisSourceUrdf,
    robotName: capturedState.robotName,
    capturedLinkWorldPoses: capturedState.capturedLinkWorldPoses,
    supportPlane: toCanonicalSynthesisSupportPlanePayload(capturedState.supportPlane),
  });
};
