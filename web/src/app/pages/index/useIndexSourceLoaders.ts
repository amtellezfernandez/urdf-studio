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
import { fetchGitHubFilesAsFileObjects } from "@/features/urdf/github/githubRepo";
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
import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";
import type { GitHubSource } from "@/shared/store/useGitHubSourceStore";
import type { NativeRobotFormat } from "@/features/layout/page/NativeRobotViewer";

type UseIndexSourceLoadersParams = {
  clearCameras: () => void;
  clearGitHubSource: () => void;
  loadFilesFromFolder: (fileList: FileList) => Promise<void>;
  loadUrdfText: (content: string, options?: LoadUrdfTextOptions) => void;
  setGitHubSource: (source: GitHubSource) => void;
  onNativeRobotSelected: (files: File[], primaryPath: string, format: NativeRobotFormat) => Promise<void>;
};

export const useIndexSourceLoaders = ({
  clearCameras,
  clearGitHubSource,
  loadFilesFromFolder,
  loadUrdfText,
  setGitHubSource,
  onNativeRobotSelected,
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
    async ({ repoUrl, urdfPath, assetPath, token }: SourceEntryGitHubParams) => {
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
        const requestedNativePath = assetPath?.trim() || urdfPath?.trim() ||
          (repoInfo.path && /\.(mjcf|xml|usd|usda|usdc|usdz)$/i.test(repoInfo.path) ? repoInfo.path : "");
        const nativeCandidates = files.filter((file) => file.type === "file" &&
          /\.(mjcf|xml|usd|usda|usdc|usdz)$/i.test(file.path));
        const nativePrimary = requestedNativePath
          ? nativeCandidates.find((file) => file.path === requestedNativePath) ||
            files.find((file) => file.path === requestedNativePath && file.type === "file")
          : nativeCandidates.find((file) => /\.(usd|usda|usdc|usdz)$/i.test(file.path)) ||
            nativeCandidates.find((file) => /\.(mjcf|xml)$/i.test(file.path));
        if (nativePrimary) {
          const format: NativeRobotFormat = /\.(usd|usda|usdc|usdz)$/i.test(nativePrimary.path) ? "USD" : "MJCF";
          const parent = nativePrimary.path.includes("/")
            ? nativePrimary.path.slice(0, nativePrimary.path.lastIndexOf("/"))
            : "";
          const packageFiles = files.filter((file) => file.type === "file" &&
            (!parent || file.path === parent || file.path.startsWith(`${parent}/`)));
          const fileObjects = await fetchGitHubFilesAsFileObjects(
            files,
            repoInfo.owner,
            repoInfo.repo,
            token,
            packageFiles
          );
          await onNativeRobotSelected(fileObjects, nativePrimary.path, format);
          toast.success(`Loaded ${nativePrimary.path} from GitHub`);
          return;
        }
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
        const message = readUnknownErrorMessage(error, "Failed to load GitHub repository.");
        toast.error(message);
      }
    },
    [loadFilesFromFolderWithFreshCameras, onNativeRobotSelected, setGitHubSource]
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
        const message = readUnknownErrorMessage(error, "Failed to load URDF URL.");
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
