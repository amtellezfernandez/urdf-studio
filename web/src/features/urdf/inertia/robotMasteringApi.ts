import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { assertBackendResponseOk } from "@/shared/lib/backendResponse";
import {
  base64ToBlob,
  blobToBase64,
  type SerializedBlobPayload,
} from "@/shared/lib/blobEncoding";
import {
  ROBOT_MASTERING_JOB_POLL_INTERVAL_MS,
  ROBOT_MASTERING_JOB_TIMEOUT_MS,
} from "./robotMasteringApiParams";
import type {
  MeshBakePlanExecutionInput,
  MeshBakePlanExecutionResult,
} from "@/features/urdf/bake/meshBakeProcessor";
import type { CapturedKinematicState } from "@/features/urdf/synthesis/kinematicSynthesizer";
import type {
  RobotMasteringBakeExportExecuteInput,
  RobotMasteringCanonicalSynthesisInput,
  RobotMasteringCanonicalSynthesisOutput,
  RobotMasteringGeneratePhysicsInput,
  RobotMasteringGeneratePhysicsOutput,
  RobotMasteringGeneratePhysicsPreflightInput,
  RobotMasteringGeneratePhysicsPreflightOutput,
  RobotMasteringFramePreflightOutput,
} from "@/features/urdf/inertia/robotMasteringContracts";

const CORE_API_OPTIONS = {
  requiredBackends: ["core-api"] as const,
};

type RobotMasteringMeshFilePayload = {
  path: string;
  base64Content: string;
  mimeType: string | null;
};

type SerializedGeneratePhysicsInput = Omit<RobotMasteringGeneratePhysicsInput, "meshFiles"> & {
  meshFiles: RobotMasteringMeshFilePayload[];
};

type SerializedGeneratePhysicsPreflightInput = Omit<
  RobotMasteringGeneratePhysicsPreflightInput,
  "meshFiles"
> & {
  meshFiles: RobotMasteringMeshFilePayload[];
};

type GeneratePhysicsJobRequest = SerializedGeneratePhysicsInput & {
  jobType: "generate-physics";
};

type FramePreflightRequest = {
  sourceUrdf: string;
};

type BakeExportExecuteRequest = Omit<RobotMasteringBakeExportExecuteInput, "meshFiles"> & {
  meshFiles: RobotMasteringMeshFilePayload[];
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

export type GeneratePhysicsJobResult = RobotMasteringGeneratePhysicsOutput & {
  jobId: string;
  jobType: "generate-physics";
};

export type GeneratePhysicsPreflightResult = RobotMasteringGeneratePhysicsPreflightOutput;

export type FramePreflightResult = RobotMasteringFramePreflightOutput;

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

export type CanonicalSynthesisResult = RobotMasteringCanonicalSynthesisOutput;

const toCanonicalSynthesisSupportPlanePayload = (
  supportPlane: CapturedKinematicState["supportPlane"]
): RobotMasteringCanonicalSynthesisInput["supportPlane"] => {
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

const serializeMeshFiles = async (
  meshFiles: Record<string, Blob>
): Promise<RobotMasteringMeshFilePayload[]> => {
  const entries = Object.entries(meshFiles);
  return Promise.all(
    entries.map(async ([path, blob]) => ({
      path,
      base64Content: await blobToBase64(blob, {
        readErrorMessage: "Failed to read mesh blob for backend physics generation.",
        encodeErrorMessage: "Failed to encode mesh blob for backend physics generation.",
      }),
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
  await assertBackendResponseOk(response, "Failed to create robot mastering job.");
  return (await response.json()) as RobotMasteringJobCreatedResponse;
};

const fetchGeneratePhysicsPreflight = async (
  request: SerializedGeneratePhysicsPreflightInput
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
  await assertBackendResponseOk(response, "Failed to load physics preflight.");
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
  await assertBackendResponseOk(response, "Failed to load frame preflight.");
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
  await assertBackendResponseOk(response, "Failed to execute bake export.");
  return (await response.json()) as BakeExportExecuteResponse;
};

const deserializeBakeExportResult = (
  result: BakeExportExecuteResponse
): MeshBakePlanExecutionResult => ({
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
});

const executeCanonicalSynthesis = async (
  request: RobotMasteringCanonicalSynthesisInput
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
  await assertBackendResponseOk(response, "Failed to execute canonical synthesis.");
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
  await assertBackendResponseOk(response, "Failed to poll robot mastering job.");
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
  await assertBackendResponseOk(response, "Failed to load generated physics draft.");
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
}: RobotMasteringGeneratePhysicsInput): Promise<GeneratePhysicsJobResult> => {
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
}: RobotMasteringGeneratePhysicsPreflightInput): Promise<GeneratePhysicsPreflightResult> =>
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
}: MeshBakePlanExecutionInput): Promise<MeshBakePlanExecutionResult> => {
  const result = await executeBakeExport({
    planEntries: plan.entries,
    planConflicts: plan.conflicts,
    meshFiles: await serializeMeshFiles(meshFiles),
    urdfBasePath,
    packageRoots,
  });

  return deserializeBakeExportResult(result);
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
