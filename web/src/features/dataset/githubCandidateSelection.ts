import type { URDFCandidate } from "@/features/urdf/github/githubRepo";
import type { IluGitHubRepoSource } from "@/features/urdf/github/iluGitHubImport";
import { MULTI_GITHUB_CANDIDATE_MIN_COUNT } from "@/features/dataset/githubCandidateSelectionParams";

const URDF_DIRECTORY_SEGMENT = "urdf";
const XACRO_DIRECTORY_SEGMENT = "xacro";

const formatCandidateCountLabel = (candidateCount: number): string =>
  `${candidateCount} robot file${candidateCount === 1 ? "" : "s"}`;

export const formatGitHubCandidateSourceLabel = (sourceInfo: IluGitHubRepoSource): string =>
  `${sourceInfo.owner}/${sourceInfo.repo}${sourceInfo.path ? `/${sourceInfo.path}` : ""}`;

export const resolveSuggestedGitHubFolderPath = (
  candidatePath: string
): string | null => {
  const pathParts = candidatePath.split("/").filter(Boolean);
  const markerIndex = pathParts.findIndex(
    (segment) => segment === URDF_DIRECTORY_SEGMENT || segment === XACRO_DIRECTORY_SEGMENT
  );

  if (markerIndex > 0) {
    return pathParts.slice(0, markerIndex).join("/");
  }
  if (pathParts.length <= 1) {
    return null;
  }
  return pathParts.slice(0, -1).join("/");
};

export const buildGitHubCandidateDialogCopy = (
  sourceInfo: IluGitHubRepoSource,
  candidates: URDFCandidate[]
): {
  sourceLabel: string;
  title: string;
  description: string | null;
  discoveryToast: string | null;
} => {
  const sourceLabel = formatGitHubCandidateSourceLabel(sourceInfo);
  const candidateCount = candidates.length;
  const suggestedFolderPath =
    !sourceInfo.path && candidateCount >= MULTI_GITHUB_CANDIDATE_MIN_COUNT
      ? resolveSuggestedGitHubFolderPath(candidates[0]?.path || "")
      : null;
  const suggestionSuffix = suggestedFolderPath
    ? ` For faster imports, load a folder like ${suggestedFolderPath}.`
    : "";

  if (candidateCount < MULTI_GITHUB_CANDIDATE_MIN_COUNT) {
    return {
      sourceLabel,
      title: `Choose Robot · ${sourceLabel}`,
      description: null,
      discoveryToast: null,
    };
  }

  const candidateCountLabel = formatCandidateCountLabel(candidateCount);
  return {
    sourceLabel,
    title: `Choose Robot · ${sourceLabel}`,
    description: `Found ${candidateCountLabel} in ${sourceLabel}. Choose one below.${suggestionSuffix}`,
    discoveryToast: `Found ${candidateCountLabel} in ${sourceLabel}. Choose one in the dialog.${suggestionSuffix}`,
  };
};
