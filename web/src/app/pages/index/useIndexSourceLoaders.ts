import { useCallback } from "react";
import { toast } from "sonner";

import {
  inferRemoteUrdfFileName,
  resolveRemoteUrdfFileUrl,
} from "@/app/pages/index/indexPageHelpers";
import {
  buildIluGitHubCandidateFileList,
  fetchIluGitHubRepoFiles,
} from "@/features/urdf/github/iluGitHubImport";
import {
  findURDFCandidates,
  parseGitHubUrl,
  resolveRepositoryXacroTargetPath,
} from "@/features/urdf/github/githubRepo";
import type {
  LoadUrdfTextOptions,
  UrdfFileInput,
} from "@/features/urdf/loader/urdfLoaderTypes";
import type { SourceEntryGitHubParams } from "@/app/pages/index/sourceEntryTypes";
import type { GitHubSource } from "@/shared/store/useGitHubSourceStore";

type UseIndexSourceLoadersParams = {
  clearCameras: () => void;
  clearGitHubSource: () => void;
  loadFilesFromFolder: (fileList: FileList) => Promise<void>;
  loadUrdfText: (content: string, options?: LoadUrdfTextOptions) => void;
  setGitHubSource: (source: GitHubSource) => void;
};

export const useIndexSourceLoaders = ({
  clearCameras,
  clearGitHubSource,
  loadFilesFromFolder,
  loadUrdfText,
  setGitHubSource,
}: UseIndexSourceLoadersParams) => {
  const loadFilesFromFolderWithFreshCameras = useCallback(
    async (fileList: UrdfFileInput, options?: { preserveCameras?: boolean }) => {
      if (!options?.preserveCameras) {
        clearCameras();
      }
      await loadFilesFromFolder(fileList as FileList);
    },
    [clearCameras, loadFilesFromFolder]
  );

  const handleLoadGitHubSource = useCallback(
    async ({ repoUrl, urdfPath, token }: SourceEntryGitHubParams) => {
      try {
        const repoInfo = parseGitHubUrl(repoUrl);
        if (!repoInfo) {
          throw new Error("Enter a valid GitHub repository URL.");
        }

        const sourceInfo = {
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          path: repoInfo.path,
          branch: repoInfo.branch,
        };
        const files = await fetchIluGitHubRepoFiles(sourceInfo, token);
        const candidates = findURDFCandidates(files);
        const requestedPath = urdfPath?.trim() ||
          (repoInfo.path && /\.(urdf|xacro)$/i.test(repoInfo.path) ? repoInfo.path : "");
        const candidatePath = requestedPath
          ? resolveRepositoryXacroTargetPath(files, requestedPath)
          : candidates[0]?.path;

        if (!candidatePath) {
          throw new Error("No URDF or Xacro file was found in that repository.");
        }

        const fileList = await buildIluGitHubCandidateFileList(
          {
            files,
            owner: repoInfo.owner,
            repo: repoInfo.repo,
            branch: repoInfo.branch,
            path: repoInfo.path,
            token,
          },
          candidatePath
        );

        setGitHubSource({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          branch: repoInfo.branch,
          path: repoInfo.path,
          token,
          files,
          urdfPath: candidatePath,
        });
        await loadFilesFromFolderWithFreshCameras(fileList);
        toast.success(`Loaded ${candidatePath} from GitHub`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load GitHub repository.";
        toast.error(message);
      }
    },
    [loadFilesFromFolderWithFreshCameras, setGitHubSource]
  );

  const handleLoadUrlSource = useCallback(
    async (url: string) => {
      try {
        const resolvedUrl = resolveRemoteUrdfFileUrl(url);
        const response = await fetch(resolvedUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch URDF URL (${response.status})`);
        }
        const content = await response.text();
        const file = new File([content], inferRemoteUrdfFileName(resolvedUrl), {
          type: response.headers.get("content-type") || "application/xml",
        });
        clearGitHubSource();
        await loadFilesFromFolderWithFreshCameras([file]);
        toast.success("Loaded URDF from URL");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load URDF URL.";
        toast.error(message);
      }
    },
    [clearGitHubSource, loadFilesFromFolderWithFreshCameras]
  );

  const loadDemoUrdfTextWithFreshCameras = useCallback(
    (content: string, options?: LoadUrdfTextOptions) => {
      clearCameras();
      loadUrdfText(content, options);
    },
    [clearCameras, loadUrdfText]
  );

  return {
    handleLoadGitHubSource,
    handleLoadUrlSource,
    loadDemoUrdfTextWithFreshCameras,
    loadFilesFromFolderWithFreshCameras,
  };
};
