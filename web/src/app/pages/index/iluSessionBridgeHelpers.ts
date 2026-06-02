import type { GitHubSource } from "@/shared/store/useGitHubSourceStore";
import type { IluSessionSnapshot } from "@/features/urdf/loader/iluSessionApi";

export const getFilenameFromPath = (
  inputPath: string | null | undefined,
  fallback = "robot.urdf"
) => {
  if (!inputPath) return fallback;
  const normalized = inputPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || fallback;
};

export const getIluSessionLoadTarget = (snapshot: IluSessionSnapshot) => {
  const loadedSource = snapshot.loadedSource;
  return {
    activePath:
      loadedSource?.repositoryUrdfPath ||
      loadedSource?.localPath ||
      loadedSource?.urdfPath ||
      snapshot.workingUrdfPath,
    filename: getFilenameFromPath(
      snapshot.workingUrdfPath,
      getFilenameFromPath(loadedSource?.repositoryUrdfPath, "robot.urdf")
    ),
  };
};

export const shouldSyncAttachedIluSession = ({
  attachedSessionId,
  isAttaching,
  lastSavedContent,
  nextContent,
}: {
  attachedSessionId: string;
  isAttaching: boolean;
  lastSavedContent: string;
  nextContent: string;
}) => {
  return (
    attachedSessionId.trim().length > 0 &&
    !isAttaching &&
    nextContent.trim().length > 0 &&
    nextContent !== lastSavedContent
  );
};

export const getIluSessionSourceKey = (snapshot: IluSessionSnapshot): string =>
  JSON.stringify({
    source: snapshot.loadedSource?.source ?? null,
    localPath: snapshot.loadedSource?.localPath ?? null,
    githubRef: snapshot.loadedSource?.githubRef ?? null,
    githubRevision: snapshot.loadedSource?.githubRevision ?? null,
    repositoryUrdfPath: snapshot.loadedSource?.repositoryUrdfPath ?? null,
    workingUrdfPath: snapshot.workingUrdfPath,
  });

export const shouldApplyAttachedIluSessionUpdate = ({
  attachedSessionId,
  currentContent,
  hasLocalUnsavedChanges,
  isAttaching,
  lastAppliedSourceKey,
  lastAppliedUpdatedAt,
  nextSnapshot,
}: {
  attachedSessionId: string;
  currentContent: string;
  hasLocalUnsavedChanges: boolean;
  isAttaching: boolean;
  lastAppliedSourceKey: string;
  lastAppliedUpdatedAt: string;
  nextSnapshot: IluSessionSnapshot;
}) => {
  if (attachedSessionId.trim().length === 0 || isAttaching || hasLocalUnsavedChanges) {
    return false;
  }

  const nextUpdatedAt = nextSnapshot.updatedAt.trim();
  if (!nextUpdatedAt || nextUpdatedAt === lastAppliedUpdatedAt) {
    return false;
  }

  return (
    nextSnapshot.urdfContent !== currentContent ||
    getIluSessionSourceKey(nextSnapshot) !== lastAppliedSourceKey
  );
};

export const toStudioGitHubSource = (
  snapshot: IluSessionSnapshot,
  files: GitHubSource["files"]
): GitHubSource | null => {
  const loadedSource = snapshot.loadedSource;
  const githubSource = snapshot.githubSource;
  if (!loadedSource?.repositoryUrdfPath || !githubSource) {
    return null;
  }
  return {
    owner: githubSource.owner,
    repo: githubSource.repo,
    branch: githubSource.ref ?? undefined,
    files,
    path: loadedSource.repositoryUrdfPath,
    urdfPath: loadedSource.repositoryUrdfPath,
  };
};
