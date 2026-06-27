import { API_BASE_URL } from "@/shared/config/runtime";
import type { OperatorTeleopRecordingEpisode } from "@/features/teleop/recording/operatorTeleopRecording";
import {
  resolveMeshBlobFromReference,
  type PackageRootMap,
} from "@/shared/lib/urdfBrowser";
import {
  OPERATOR_TELEOP_KINEMATIC_LEROBOT_EXPORT_PATH,
  OPERATOR_TELEOP_MJLAB_VALIDATE_PATH,
  OPERATOR_TELEOP_REPLAY_LEROBOT_EXPORT_PATH,
  OPERATOR_TELEOP_REPLAY_VALIDATE_PATH,
} from "@/features/teleop/recording/operatorTeleopRecordingParams";

export type OperatorTeleopReplaySampleResult = {
  sampleIndex: number;
  commandKind: string;
  accepted: boolean;
  maxJointErrorRad: number;
  scheduledTimeMs: number;
  scheduledDelayMs: number;
  reason: string;
};

export type OperatorTeleopReplayValidationResult = {
  success: boolean;
  recordingId: string;
  sampleCount: number;
  replayedSampleCount: number;
  maxJointErrorRad: number;
  jointToleranceRad: number;
  timingMode: string;
  scheduledDurationMs: number;
  scheduledSleepMs: number;
  maxScheduledDelayMs: number;
  sampleResults: OperatorTeleopReplaySampleResult[];
};

export type OperatorTeleopReplayExportResult =
  OperatorTeleopReplayValidationResult & {
    outputPath: string;
    datasetPath: string;
    artifactPaths: string[];
    mjlabValidation?: OperatorTeleopMjlabValidationResult | null;
  };

export type OperatorTeleopMjlabRuntimeStatus = {
  runtimeName: string;
  available: boolean;
  status: string;
  dependencies: { name: string; available: boolean }[];
};

export type OperatorTeleopMjlabMotionIssue = {
  severity: "error" | "warning";
  code: string;
  reason: string;
  sampleIndex?: number | null;
  jointName?: string | null;
  linkNames?: string[];
  value?: number | null;
  limit?: number | null;
};

export type OperatorTeleopMjlabMeshFilePayload = {
  path: string;
  base64Content: string;
  mimeType: string | null;
};

export type OperatorTeleopMjlabRobotModel = {
  name?: string | null;
  urdfXml?: string | null;
  urdfBasePath?: string | null;
  packageRoots?: PackageRootMap;
  meshFiles?: OperatorTeleopMjlabMeshFilePayload[];
};

export type OperatorTeleopMjlabValidationOptions = {
  robotModel?: OperatorTeleopMjlabRobotModel | null;
};

export type OperatorTeleopReplayExportOptions = {
  robotModel?: OperatorTeleopMjlabRobotModel | null;
  outputDir?: string | null;
};

export type OperatorTeleopMjlabValidationResult = {
  success: boolean;
  schemaVersion: string;
  recordingId: string;
  runtime: OperatorTeleopMjlabRuntimeStatus;
  sampleCount: number;
  trajectorySampleCount: number;
  jointNames: string[];
  durationMs: number;
  maxJointVelocityRadPerSec: number;
  maxJointAccelerationRadPerSec2: number;
  maxTimestampGapMs: number;
  selfCollisionChecked: boolean;
  selfCollisionSampleCount: number;
  selfCollisionCount: number;
  issues: OperatorTeleopMjlabMotionIssue[];
};

type ReplayApiEnvelope = {
  recording: OperatorTeleopRecordingEpisode;
};

type MjlabValidationApiEnvelope = ReplayApiEnvelope & {
  robotModel?: OperatorTeleopMjlabRobotModel;
};

const URDF_MESH_FILENAME_PATTERN =
  /<mesh\b[^>]*\bfilename\s*=\s*(["'])(.*?)\1/gi;

const encodeBytesAsBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const blobToBase64 = async (blob: Blob): Promise<string> =>
  encodeBytesAsBase64(new Uint8Array(await blob.arrayBuffer()));

const resolveUrdfMeshReferences = (urdfXml: string): string[] => {
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(urdfXml, "application/xml");
    const parserError = document.querySelector("parsererror");
    if (!parserError) {
      return Array.from(document.querySelectorAll("mesh"))
        .map((mesh) => mesh.getAttribute("filename")?.trim() ?? "")
        .filter((filename) => filename.length > 0);
    }
  }
  return Array.from(urdfXml.matchAll(URDF_MESH_FILENAME_PATTERN))
    .map((match) => match[2]?.trim() ?? "")
    .filter((filename) => filename.length > 0);
};

export const buildTeleopMjlabRobotModel = async ({
  meshFiles,
  name,
  packageRoots,
  urdfBasePath,
  urdfXml,
}: {
  meshFiles?: Record<string, Blob>;
  name?: string | null;
  packageRoots?: PackageRootMap;
  urdfBasePath?: string;
  urdfXml: string;
}): Promise<OperatorTeleopMjlabRobotModel> => {
  const resolvedMeshPayloads = new Map<string, OperatorTeleopMjlabMeshFilePayload>();
  const meshFileMap = meshFiles ?? {};
  if (Object.keys(meshFileMap).length > 0) {
    const meshReferences = Array.from(new Set(resolveUrdfMeshReferences(urdfXml)));
    await Promise.all(
      meshReferences.map(async (meshReference) => {
        const resolvedMesh = resolveMeshBlobFromReference(
          meshReference,
          meshFileMap,
          urdfBasePath,
          packageRoots,
        );
        if (!resolvedMesh || resolvedMeshPayloads.has(resolvedMesh.path)) {
          return;
        }
        resolvedMeshPayloads.set(resolvedMesh.path, {
          path: resolvedMesh.path,
          base64Content: await blobToBase64(resolvedMesh.blob),
          mimeType: resolvedMesh.blob.type || null,
        });
      }),
    );
  }
  return {
    name,
    urdfXml,
    urdfBasePath,
    packageRoots,
    meshFiles: Array.from(resolvedMeshPayloads.values()),
  };
};

const postReplayJson = async <T>(
  path: string,
  recording: OperatorTeleopRecordingEpisode,
  extraBody: Record<string, unknown> = {},
): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recording, ...extraBody } satisfies ReplayApiEnvelope),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { detail?: unknown };
      detail = typeof payload.detail === "string" ? payload.detail : "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `Teleop replay request failed: ${response.status}`);
  }
  return (await response.json()) as T;
};

const buildReplayExportBody = (
  options: OperatorTeleopReplayExportOptions,
): Omit<MjlabValidationApiEnvelope, "recording"> & { outputDir?: string } => {
  const body: Omit<MjlabValidationApiEnvelope, "recording"> & {
    outputDir?: string;
  } = {};
  if (options.robotModel) {
    body.robotModel = options.robotModel;
  }
  if (options.outputDir?.trim()) {
    body.outputDir = options.outputDir.trim();
  }
  return body;
};

export const validateTeleopReplay = (
  recording: OperatorTeleopRecordingEpisode,
): Promise<OperatorTeleopReplayValidationResult> =>
  postReplayJson<OperatorTeleopReplayValidationResult>(
    OPERATOR_TELEOP_REPLAY_VALIDATE_PATH,
    recording,
  );

export const exportTeleopReplayToLeRobot = (
  recording: OperatorTeleopRecordingEpisode,
  options: OperatorTeleopReplayExportOptions = {},
): Promise<OperatorTeleopReplayExportResult> =>
  postReplayJson<OperatorTeleopReplayExportResult>(
    OPERATOR_TELEOP_REPLAY_LEROBOT_EXPORT_PATH,
    recording,
    buildReplayExportBody(options),
  );

export const exportTeleopKinematicToLeRobot = (
  recording: OperatorTeleopRecordingEpisode,
  options: OperatorTeleopReplayExportOptions = {},
): Promise<OperatorTeleopReplayExportResult> =>
  postReplayJson<OperatorTeleopReplayExportResult>(
    OPERATOR_TELEOP_KINEMATIC_LEROBOT_EXPORT_PATH,
    recording,
    buildReplayExportBody(options),
  );

export const validateTeleopMjlabMotion = (
  recording: OperatorTeleopRecordingEpisode,
  options: OperatorTeleopMjlabValidationOptions = {},
): Promise<OperatorTeleopMjlabValidationResult> =>
  postReplayJson<OperatorTeleopMjlabValidationResult>(
    OPERATOR_TELEOP_MJLAB_VALIDATE_PATH,
    recording,
    options.robotModel
      ? ({
          robotModel: options.robotModel,
        } satisfies Omit<MjlabValidationApiEnvelope, "recording">)
      : {},
  );
