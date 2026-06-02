import {
  COLLABORATION_CONTENT_HASH_OFFSET,
  COLLABORATION_CONTENT_HASH_PRIME,
  COLLABORATION_CONTENT_HASH_RADIX,
  COLLABORATION_HASH_BYTE_MASK,
  COLLABORATION_HASH_UNSIGNED_SHIFT,
  COLLABORATION_PATCH_MAX_CHANGED_BYTES,
  COLLABORATION_PATCH_MAX_SNAPSHOT_RATIO,
  COLLABORATION_PATCH_MIN_BASE_BYTES,
  COLLABORATION_PATCH_MIN_INDEX,
  COLLABORATION_PATCH_REVISION_INCREMENT,
  COLLABORATION_URDF_PATCH_KIND,
  COLLABORATION_URDF_SNAPSHOT_KIND,
  COLLABORATION_URDF_SNAPSHOT_REQUEST_KIND,
} from "@/features/collaboration/collaborationParams";

export type CollaborationUrdfSnapshotPayload = {
  kind: typeof COLLABORATION_URDF_SNAPSHOT_KIND;
  content: string;
  filename: string;
  activePath: string;
  basePath: string;
  clientSequence: number;
  clientSentAtMs: number;
  revision: number;
  contentHash: string;
};

export type CollaborationUrdfPatchPayload = {
  kind: typeof COLLABORATION_URDF_PATCH_KIND;
  activePath: string;
  basePath: string;
  filename: string;
  clientSequence: number;
  clientSentAtMs: number;
  baseRevision: number;
  revision: number;
  baseHash: string;
  resultHash: string;
  start: number;
  deleteCount: number;
  insert: string;
};

export type CollaborationUrdfSnapshotRequestPayload = {
  kind: typeof COLLABORATION_URDF_SNAPSHOT_REQUEST_KIND;
  requestedRevision: number;
  reason: "patch-base-mismatch" | "patch-apply-failed";
  targetClientId: string;
  clientSequence: number;
  clientSentAtMs: number;
};

export type CollaborationUrdfPatchApplyResult =
  | { ok: true; content: string; revision: number; contentHash: string }
  | { ok: false; reason: "patch-base-mismatch" | "patch-apply-failed" };

export const hashCollaborationContent = (content: string): string => {
  let hash = COLLABORATION_CONTENT_HASH_OFFSET;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index) & COLLABORATION_HASH_BYTE_MASK;
    hash = Math.imul(hash, COLLABORATION_CONTENT_HASH_PRIME);
  }
  return (hash >>> COLLABORATION_HASH_UNSIGNED_SHIFT).toString(COLLABORATION_CONTENT_HASH_RADIX);
};

const countCommonPrefix = (previousContent: string, nextContent: string): number => {
  const maxPrefixLength = Math.min(previousContent.length, nextContent.length);
  let prefixLength = 0;
  while (
    prefixLength < maxPrefixLength &&
    previousContent.charCodeAt(prefixLength) === nextContent.charCodeAt(prefixLength)
  ) {
    prefixLength += 1;
  }
  return prefixLength;
};

const countCommonSuffix = (
  previousContent: string,
  nextContent: string,
  prefixLength: number
): number => {
  const maxSuffixLength =
    Math.min(previousContent.length, nextContent.length) - prefixLength;
  let suffixLength = 0;
  while (
    suffixLength < maxSuffixLength &&
    previousContent.charCodeAt(previousContent.length - suffixLength - 1) ===
      nextContent.charCodeAt(nextContent.length - suffixLength - 1)
  ) {
    suffixLength += 1;
  }
  return suffixLength;
};

export const buildCollaborationUrdfPatchPayload = ({
  activePath,
  basePath,
  baseRevision,
  clientSequence,
  clientSentAtMs = Date.now(),
  filename,
  nextContent,
  previousContent,
}: {
  activePath: string;
  basePath: string;
  baseRevision: number;
  clientSequence: number;
  clientSentAtMs?: number;
  filename: string;
  nextContent: string;
  previousContent: string;
}): CollaborationUrdfPatchPayload | null => {
  if (previousContent === nextContent) return null;
  if (previousContent.length < COLLABORATION_PATCH_MIN_BASE_BYTES) return null;

  const prefixLength = countCommonPrefix(previousContent, nextContent);
  const suffixLength = countCommonSuffix(previousContent, nextContent, prefixLength);
  const deleteCount = previousContent.length - prefixLength - suffixLength;
  const insert = nextContent.slice(prefixLength, nextContent.length - suffixLength);
  const changedBytes = deleteCount + insert.length;
  const snapshotRatio = changedBytes / Math.max(nextContent.length, previousContent.length);

  if (changedBytes > COLLABORATION_PATCH_MAX_CHANGED_BYTES) return null;
  if (snapshotRatio > COLLABORATION_PATCH_MAX_SNAPSHOT_RATIO) return null;

  return {
    kind: COLLABORATION_URDF_PATCH_KIND,
    activePath,
    basePath,
    filename,
    clientSequence,
    clientSentAtMs,
    baseRevision,
    revision: baseRevision + COLLABORATION_PATCH_REVISION_INCREMENT,
    baseHash: hashCollaborationContent(previousContent),
    resultHash: hashCollaborationContent(nextContent),
    start: prefixLength,
    deleteCount,
    insert,
  };
};

export const applyCollaborationUrdfPatchPayload = ({
  currentContent,
  currentRevision,
  patch,
}: {
  currentContent: string;
  currentRevision: number;
  patch: CollaborationUrdfPatchPayload;
}): CollaborationUrdfPatchApplyResult => {
  if (
    currentRevision !== patch.baseRevision ||
    hashCollaborationContent(currentContent) !== patch.baseHash
  ) {
    return { ok: false, reason: "patch-base-mismatch" };
  }
  if (
    !Number.isSafeInteger(patch.start) ||
    !Number.isSafeInteger(patch.deleteCount) ||
    patch.start < COLLABORATION_PATCH_MIN_INDEX ||
    patch.deleteCount < COLLABORATION_PATCH_MIN_INDEX ||
    patch.start + patch.deleteCount > currentContent.length
  ) {
    return { ok: false, reason: "patch-apply-failed" };
  }

  const nextContent =
    currentContent.slice(0, patch.start) +
    patch.insert +
    currentContent.slice(patch.start + patch.deleteCount);
  const nextHash = hashCollaborationContent(nextContent);
  if (nextHash !== patch.resultHash) {
    return { ok: false, reason: "patch-apply-failed" };
  }
  return {
    ok: true,
    content: nextContent,
    revision: patch.revision,
    contentHash: nextHash,
  };
};

export const buildCollaborationUrdfSnapshotRequestPayload = ({
  clientSentAtMs = Date.now(),
  clientSequence,
  reason,
  requestedRevision,
  targetClientId,
}: {
  clientSentAtMs?: number;
  clientSequence: number;
  reason: CollaborationUrdfSnapshotRequestPayload["reason"];
  requestedRevision: number;
  targetClientId: string;
}): CollaborationUrdfSnapshotRequestPayload => ({
  kind: COLLABORATION_URDF_SNAPSHOT_REQUEST_KIND,
  clientSentAtMs,
  clientSequence,
  reason,
  requestedRevision,
  targetClientId,
});
