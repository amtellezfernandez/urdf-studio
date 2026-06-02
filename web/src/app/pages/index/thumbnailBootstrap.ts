import {
  parseGitHubUrl,
  findURDFCandidates,
  resolveRepositoryXacroTargetPath,
  type GitHubFile,
} from "@/features/urdf/github/githubRepo";
import {
  buildIluGitHubCandidateFileList,
  fetchIluGitHubRepoFiles,
} from "@/features/urdf/github/iluGitHubImport";
import { normalizeMeshPathForMatch } from "@/shared/lib/urdfBrowser";
import { THUMBNAIL_BOOTSTRAP_PARAMS } from "@/app/pages/index/thumbnailBootstrapParams";

type CandidateLike = {
  name: string;
  path: string;
};

type LoadThumbnailGitHubRobotParams = {
  loadFilesFromFolderWithFreshCameras: (
    files: FileList,
    options?: { preserveCameras?: boolean }
  ) => void | Promise<void>;
  repoUrl: string;
  urdfTarget: string;
};

export const resolveThumbnailHintedPath = (repoPath: string | undefined, urdfTarget: string) => {
  const normalizedTarget = normalizeMeshPathForMatch(urdfTarget);
  if (repoPath) {
    return repoPath;
  }
  if (!normalizedTarget.includes("/")) {
    return "";
  }
  return normalizedTarget.split("/").slice(0, -1).join("/");
};

export const selectThumbnailCandidate = <T extends CandidateLike>(
  candidates: T[],
  urdfTarget: string
) => {
  const normalizedTarget = normalizeMeshPathForMatch(urdfTarget).toLowerCase();
  if (!normalizedTarget) {
    return candidates[0];
  }
  return (
    candidates.find((item) => {
      const fileName = item.path.split("/").pop() || item.path;
      return (
        item.path.toLowerCase().endsWith(normalizedTarget) ||
        item.name.toLowerCase() === normalizedTarget ||
        fileName.toLowerCase() === normalizedTarget
      );
    }) || candidates[0]
  );
};

const resolveThumbnailTargetPath = (
  filePaths: ArrayLike<{ path: string; type?: string }>,
  urdfTarget: string
): string => {
  const repositoryFiles = Array.from(filePaths).map((file) => ({
    path: file.path,
    type: file.type === "dir" ? "dir" : "file",
  }));
  return resolveRepositoryXacroTargetPath(
    repositoryFiles,
    normalizeMeshPathForMatch(urdfTarget) || urdfTarget
  );
};

const resolveThumbnailCandidatePath = (
  files: GitHubFile[],
  urdfTarget: string
): string | null => {
  const directTargetPath = resolveThumbnailTargetPath(files, urdfTarget);
  const hasDirectTarget = files.some(
    (file) =>
      file.type === "file" &&
      normalizeMeshPathForMatch(file.path) === normalizeMeshPathForMatch(directTargetPath)
  );
  if (hasDirectTarget) {
    return directTargetPath;
  }
  return selectThumbnailCandidate(findURDFCandidates(files), urdfTarget)?.path || null;
};

export const THUMBNAIL_MISSING_TARGET_ERROR = THUMBNAIL_BOOTSTRAP_PARAMS.missingTargetError;

export const loadThumbnailGitHubRobot = async ({
  loadFilesFromFolderWithFreshCameras,
  repoUrl,
  urdfTarget,
}: LoadThumbnailGitHubRobotParams) => {
  const repoInfo = parseGitHubUrl(repoUrl);
  if (!repoInfo) {
    throw new Error("Invalid GitHub repository URL");
  }

  const hintedPath = resolveThumbnailHintedPath(repoInfo.path, urdfTarget);
  const buildSourceInfo = (path?: string) => ({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    path,
    branch: repoInfo.branch,
  });

  let files = await fetchIluGitHubRepoFiles(buildSourceInfo(hintedPath));
  let candidatePath = resolveThumbnailCandidatePath(files, urdfTarget);
  if (!candidatePath && hintedPath) {
    files = await fetchIluGitHubRepoFiles(buildSourceInfo(""));
    candidatePath = resolveThumbnailCandidatePath(files, urdfTarget);
  }
  if (!candidatePath) {
    throw new Error(THUMBNAIL_MISSING_TARGET_ERROR);
  }
  const fileList = await buildIluGitHubCandidateFileList(
    {
      files,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      branch: repoInfo.branch,
    },
    candidatePath
  );
  await loadFilesFromFolderWithFreshCameras(fileList);
};
