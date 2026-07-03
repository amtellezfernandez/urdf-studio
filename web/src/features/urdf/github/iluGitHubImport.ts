import {
  convertGitHubFilesToFileList,
  fetchRepoContents,
  type GitHubFile,
} from "@/features/urdf/github/githubRepo";

export type IluGitHubRepoSource = {
  owner: string;
  repo: string;
  path?: string;
  branch?: string;
};

export const fetchIluGitHubRepoFiles = async (
  sourceInfo: IluGitHubRepoSource,
  token?: string
): Promise<GitHubFile[]> =>
  fetchRepoContents(
    sourceInfo.owner,
    sourceInfo.repo,
    sourceInfo.path,
    token,
    {
      branch: sourceInfo.branch,
      strategy: (!token && !sourceInfo.path ? "archive-first" : "auto") as
        | "archive-first"
        | "auto",
    }
);

export const buildIluGitHubCandidateFileList = (
  source: IluGitHubRepoSource & { files: GitHubFile[]; token?: string },
  candidatePath: string,
  options?: { additionalUrdfPaths?: string[] }
): Promise<FileList> =>
  convertGitHubFilesToFileList(
    source.files,
    candidatePath,
    source.owner,
    source.repo,
    source.token,
    {
      additionalUrdfPaths: options?.additionalUrdfPaths,
      branch: source.branch,
    }
  );
