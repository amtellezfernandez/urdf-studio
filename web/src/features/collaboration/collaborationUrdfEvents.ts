import {
  COLLABORATION_CLIENT_SEQUENCE_INITIAL,
  COLLABORATION_DEFAULT_URDF_FILENAME,
  COLLABORATION_URDF_PATCH_EVENT_TYPE,
  COLLABORATION_URDF_REVISION_INITIAL,
  COLLABORATION_URDF_PATCH_KIND,
  COLLABORATION_URDF_SNAPSHOT_EVENT_TYPE,
  COLLABORATION_URDF_SNAPSHOT_KIND,
  COLLABORATION_URDF_SNAPSHOT_REQUEST_EVENT_TYPE,
  COLLABORATION_URDF_SNAPSHOT_REQUEST_KIND,
} from "@/features/collaboration/collaborationParams";
import {
  hashCollaborationContent,
  type CollaborationUrdfPatchPayload,
  type CollaborationUrdfSnapshotPayload,
  type CollaborationUrdfSnapshotRequestPayload,
} from "@/features/collaboration/collaborationPatch";
import type { CollaborationEventSnapshot } from "@/features/collaboration/collaborationTypes";

const normalizeSnapshotPath = (
  value: string | null | undefined,
  filename: string,
): string => value?.trim() || filename;

export const buildCollaborationUrdfSnapshotPayload = ({
  activePath,
  basePath,
  clientSequence = COLLABORATION_CLIENT_SEQUENCE_INITIAL,
  clientSentAtMs,
  content,
  filename,
  revision = COLLABORATION_URDF_REVISION_INITIAL,
}: {
  activePath?: string | null;
  basePath?: string;
  clientSequence?: number;
  clientSentAtMs?: number;
  content: string;
  filename?: string | null;
  revision?: number;
}): CollaborationUrdfSnapshotPayload => {
  const normalizedFilename =
    filename?.trim() || COLLABORATION_DEFAULT_URDF_FILENAME;
  return {
    kind: COLLABORATION_URDF_SNAPSHOT_KIND,
    content,
    filename: normalizedFilename,
    activePath: normalizeSnapshotPath(activePath, normalizedFilename),
    basePath: basePath?.trim() || "",
    clientSequence,
    clientSentAtMs: clientSentAtMs ?? Date.now(),
    revision,
    contentHash: hashCollaborationContent(content),
  };
};

export const isCollaborationUrdfSnapshotEvent = (
  event: CollaborationEventSnapshot,
): event is CollaborationEventSnapshot & {
  payload: CollaborationUrdfSnapshotPayload;
} =>
  event.event_type === COLLABORATION_URDF_SNAPSHOT_EVENT_TYPE &&
  event.payload.kind === COLLABORATION_URDF_SNAPSHOT_KIND &&
  typeof event.payload.content === "string" &&
  typeof event.payload.filename === "string" &&
  typeof event.payload.activePath === "string" &&
  typeof event.payload.basePath === "string" &&
  typeof event.payload.clientSequence === "number" &&
  typeof event.payload.clientSentAtMs === "number" &&
  typeof event.payload.revision === "number" &&
  typeof event.payload.contentHash === "string";

export const isCollaborationUrdfPatchEvent = (
  event: CollaborationEventSnapshot,
): event is CollaborationEventSnapshot & {
  payload: CollaborationUrdfPatchPayload;
} =>
  event.event_type === COLLABORATION_URDF_PATCH_EVENT_TYPE &&
  event.payload.kind === COLLABORATION_URDF_PATCH_KIND &&
  typeof event.payload.activePath === "string" &&
  typeof event.payload.basePath === "string" &&
  typeof event.payload.filename === "string" &&
  typeof event.payload.clientSequence === "number" &&
  typeof event.payload.clientSentAtMs === "number" &&
  typeof event.payload.baseRevision === "number" &&
  typeof event.payload.revision === "number" &&
  typeof event.payload.baseHash === "string" &&
  typeof event.payload.resultHash === "string" &&
  typeof event.payload.start === "number" &&
  typeof event.payload.deleteCount === "number" &&
  typeof event.payload.insert === "string";

export const isCollaborationUrdfSnapshotRequestEvent = (
  event: CollaborationEventSnapshot,
): event is CollaborationEventSnapshot & {
  payload: CollaborationUrdfSnapshotRequestPayload;
} =>
  event.event_type === COLLABORATION_URDF_SNAPSHOT_REQUEST_EVENT_TYPE &&
  event.payload.kind === COLLABORATION_URDF_SNAPSHOT_REQUEST_KIND &&
  typeof event.payload.requestedRevision === "number" &&
  typeof event.payload.targetClientId === "string" &&
  typeof event.payload.clientSequence === "number" &&
  (event.payload.reason === "patch-base-mismatch" ||
    event.payload.reason === "patch-apply-failed") &&
  typeof event.payload.clientSentAtMs === "number";
