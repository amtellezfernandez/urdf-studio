import {
  convertGitHubFilesToFileList,
  fetchRepoContents,
  findURDFCandidates,
  type GitHubFile,
  type URDFCandidate,
} from "@/features/urdf/github/githubRepo";
import { API_BASE_URL } from "@/shared/config/runtime";
import { guardedFetch } from "@/shared/lib/backendGuard";

export type IluGitHubRepoSource = {
  owner: string;
  repo: string;
  path?: string;
  branch?: string;
};

export type IluGitHubRepoCandidateSummary = {
  ref?: string | null;
  candidates: URDFCandidate[];
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

export const fetchIluGitHubRepoCandidates = async (
  sourceInfo: IluGitHubRepoSource,
  token?: string
): Promise<{ files: GitHubFile[]; candidates: URDFCandidate[] }> => {
  const files = await fetchIluGitHubRepoFiles(sourceInfo, token);
  const candidates = findURDFCandidates(files);
  if (candidates.length === 0) {
    throw new Error("No .urdf file found in the repository");
  }
  return { files, candidates };
};

export const fetchIluGitHubRepoCandidateSummary = async (
  sourceInfo: IluGitHubRepoSource,
  token?: string
): Promise<IluGitHubRepoCandidateSummary> => {
  if (token) {
    const { files, candidates } = await fetchIluGitHubRepoCandidates(sourceInfo, token);
    return {
      ref: sourceInfo.branch ?? null,
      candidates,
    };
  }

  const params = new URLSearchParams();
  params.set("owner", sourceInfo.owner);
  params.set("repo", sourceInfo.repo);
  if (sourceInfo.path) {
    params.set("path", sourceInfo.path);
  }
  if (sourceInfo.branch) {
    params.set("branch", sourceInfo.branch);
  }
  const endpoint = `${API_BASE_URL}/ilu/repo-candidates?${params.toString()}`;

  const response = await guardedFetch(endpoint, undefined, {
    requiredBackends: ["core-api"],
    context: "Load GitHub repository candidates",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Failed to load GitHub repository candidates (${response.status})`);
  }

  const payload = (await response.json()) as Partial<IluGitHubRepoCandidateSummary>;
  if (!Array.isArray(payload.candidates)) {
    throw new Error("Backend GitHub candidate summary returned an invalid response.");
  }
  if (payload.candidates.length === 0) {
    throw new Error("No .urdf file found in the repository");
  }
  return {
    ref: typeof payload.ref === "string" ? payload.ref : null,
    candidates: payload.candidates,
  };
};

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
