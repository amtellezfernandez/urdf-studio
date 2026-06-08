import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  type AxisSpec,
  type RobotOrientationCard,
  removeJointsFromUrdf,
} from "@/shared/lib/urdfCore";
import { fixMeshPaths, fixMissingMeshReferences, parseURDF } from "@/shared/lib/urdfBrowser";
import {
  canonicalizeUrdf,
  normalizeAxes,
  prettifyUrdf,
  rotateUrdf,
} from "@/features/urdf/editor/urdfEditorActions";
import {
  buildPackageRootsFromFiles,
  fetchGitHubFilesAsFileObjects,
  resolveGitHubMeshReferences,
  type GitHubFile,
} from "@/features/urdf/github/githubRepo";
import type { GitHubSource } from "@/shared/store/useGitHubSourceStore";
import type { RotationAxis } from "@/shared/types/feature";
import { AXIS_NAMES } from "@/features/layout/page/constants";
import { isSupportedMeshExtension } from "@/shared/lib/urdfCore";
import {
  buildPackageRootsFromMeshBlobMap,
  mergePackageRootsWithMeshFiles,
  normalizeMeshPathForMatch,
} from "@/shared/lib/urdfBrowser";
import { getActionableOrientationSuggestion } from "@/shared/lib/orientationReview";
import {
  alignUrdfToStudioOrientation,
  getIluRobotOrientationCard,
  repairMeshPathsWithIlu,
} from "@/shared/lib/iluStudio";

type UseUrdfUtilityHandlersArgs = {
  vizUrdfContent: string;
  deletedJoints: Set<string>;
  toggleDeletedJoint: (jointName: string) => void;
  handleVizUrdfChange: (newContent: string) => void;
  updateUrdfFile: (content: string) => void;
  meshFiles?: Record<string, Blob>;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
  githubSource?: GitHubSource | null;
  addMeshFilesFromFiles?: (input: FileList | File[], urdfContentOverride?: string) => Promise<number>;
};

export const useUrdfUtilityHandlers = ({
  vizUrdfContent,
  deletedJoints,
  toggleDeletedJoint,
  handleVizUrdfChange,
  updateUrdfFile,
  meshFiles,
  urdfBasePath,
  packageRoots,
  githubSource,
  addMeshFilesFromFiles,
}: UseUrdfUtilityHandlersArgs) => {
  const formatAxisSpec = useCallback((axis: AxisSpec) => axis.replace("+", "").toUpperCase(), []);

  const getOrientationCard = useCallback((): RobotOrientationCard | null => {
    if (!vizUrdfContent.trim()) {
      return null;
    }
    try {
      return getIluRobotOrientationCard(vizUrdfContent);
    } catch (error) {
      console.warn("Failed to build orientation card", error);
      return null;
    }
  }, [vizUrdfContent]);

  const deleteJointsFromURDF = useCallback(
    (urdfContent: string, jointsToDelete: Set<string>): string => {
      if (jointsToDelete.size === 0) return urdfContent;
      const result = removeJointsFromUrdf(urdfContent, jointsToDelete);
      if (!result.success) {
        console.error("URDF parsing error:", result.error);
        return urdfContent;
      }
      return result.content;
    },
    []
  );

  const handleCanonicalOrder = useCallback(() => {
    if (!vizUrdfContent) return;
    const result = canonicalizeUrdf(vizUrdfContent);
    if (!result.success) {
      toast.error(result.error ?? "Failed to reorder URDF");
      return;
    }
    handleVizUrdfChange(result.content);
    toast.success(result.message ?? "URDF elements reordered to canonical format");
  }, [handleVizUrdfChange, vizUrdfContent]);

  const handlePrettyPrint = useCallback(() => {
    if (!vizUrdfContent) return;
    const result = prettifyUrdf(vizUrdfContent);
    if (!result.success) {
      toast.error(result.error ?? "Failed to format URDF");
      return;
    }
    handleVizUrdfChange(result.content);
    toast.success(result.message ?? "URDF formatted with consistent indentation");
  }, [handleVizUrdfChange, vizUrdfContent]);

  const handleNormalizeAxes = useCallback(() => {
    if (!vizUrdfContent) return;
    const result = normalizeAxes(vizUrdfContent);
    if (!result.success) {
      toast.error(result.error ?? "Failed to normalize joint axes");
      return;
    }
    handleVizUrdfChange(result.content);

    if (result.issues.length > 0) {
      toast.warning(`Normalized axes with ${result.issues.length} error(s) fixed`);
      result.issues.forEach((err) => {
        console.warn(`Joint "${err.jointName}" (${err.jointType}): ${err.issue}`);
      });
    } else if (result.corrections.length > 0) {
      toast.success(result.message ?? `Normalized ${result.corrections.length} joint axis(es)`);
      result.corrections.forEach((correction) => {
        console.info(`Joint "${correction.jointName}": ${correction.reason}`);
      });
    } else {
      toast.info("All joint axes are already normalized");
    }
  }, [handleVizUrdfChange, vizUrdfContent]);

  const handleFixMeshPaths = useCallback(async () => {
    if (!vizUrdfContent) return;
    const githubPackageRoots = githubSource ? buildPackageRootsFromFiles(githubSource.files) : {};
    let result:
      | {
          success: boolean;
          content: string;
          corrections: Array<{ original: string; corrected: string }>;
          unresolved: string[];
          error?: string;
        }
      | null = null;
    let contentToResolve = vizUrdfContent;

    if (githubSource) {
      const githubMeshFiles: Record<string, Blob> = {};
      const placeholder = new Blob([]);
      githubSource.files.forEach((file: GitHubFile) => {
        if (file.type !== "file") return;
        if (!isSupportedMeshExtension(file.path)) return;
        const normalized = normalizeMeshPathForMatch(file.path);
        if (!normalized) return;
        if (!githubMeshFiles[normalized]) {
          githubMeshFiles[normalized] = placeholder;
        }
      });
      if (Object.keys(githubMeshFiles).length > 0) {
        result = fixMissingMeshReferences(vizUrdfContent, githubMeshFiles, {
          basePath: urdfBasePath,
          packageRoots: mergePackageRootsWithMeshFiles(githubMeshFiles, githubPackageRoots),
        });
      }
    }

    if (!result && meshFiles && Object.keys(meshFiles).length > 0) {
      const packageRootsForFix = mergePackageRootsWithMeshFiles(
        meshFiles,
        packageRoots && Object.keys(packageRoots).length > 0 ? packageRoots : undefined
      ) ?? buildPackageRootsFromMeshBlobMap(meshFiles);
      result = fixMissingMeshReferences(vizUrdfContent, meshFiles, {
        basePath: urdfBasePath,
        packageRoots: packageRootsForFix,
      });
    }

    if (result) {
      if (!result.success) {
        toast.error(result.error ?? "Failed to fix mesh references");
        return;
      }
      contentToResolve = result.content;
      if (result.corrections.length > 0) {
        handleVizUrdfChange(result.content);
        toast.warning("Autocorrected mesh file paths to match available files");
        toast.success(`Fixed ${result.corrections.length} missing mesh reference(s)`);
        if (result.unresolved.length > 0) {
          toast.warning(`${result.unresolved.length} mesh reference(s) still unresolved`);
        }
      } else if (result.unresolved.length > 0) {
        toast.warning(`${result.unresolved.length} mesh reference(s) still unresolved`);
      } else {
        toast.info("All mesh references are already resolvable");
      }
    } else {
      const fallback = repairMeshPathsWithIlu(vizUrdfContent);
      contentToResolve = fallback.urdfContent;
      handleVizUrdfChange(fallback.urdfContent);
      if (fallback.corrections.length > 0) {
        toast.success(`Fixed ${fallback.corrections.length} mesh path(s)`);
        fallback.corrections.forEach((correction) => {
          console.info(`Fixed path: "${correction.original}" -> "${correction.corrected}"`);
        });
      } else {
        toast.info("All mesh paths are already correct");
      }
    }

    if (githubSource && addMeshFilesFromFiles) {
      const urdfPath = githubSource.urdfPath || "";
      if (urdfPath) {
        const { matches } = resolveGitHubMeshReferences(
          urdfPath,
          contentToResolve,
          githubSource.files,
          githubPackageRoots
        );
        const meshMatches = matches.filter(
          (file) => file.type === "file" && isSupportedMeshExtension(file.path)
        );
        if (meshMatches.length > 0) {
          const fetchedFiles = await fetchGitHubFilesAsFileObjects(
            githubSource.files,
            githubSource.owner,
            githubSource.repo,
            githubSource.token,
            meshMatches
          );
          if (fetchedFiles.length > 0) {
            await addMeshFilesFromFiles(fetchedFiles, contentToResolve);
          }
        }
      }
    }
  }, [
    addMeshFilesFromFiles,
    githubSource,
    handleVizUrdfChange,
    meshFiles,
    packageRoots,
    urdfBasePath,
    vizUrdfContent,
  ]);

  const handleAlignOrientation = useCallback(() => {
    if (!vizUrdfContent) {
      toast.error("No URDF loaded");
      return;
    }

    const orientationCard = getOrientationCard();
    if (!orientationCard?.isValid) {
      toast.error(orientationCard?.error ?? "Unable to determine robot orientation");
      return;
    }

    const suggestion = getActionableOrientationSuggestion(orientationCard);
    if (!suggestion) {
      toast.info("Orientation already matches Z-up / X-forward");
      return;
    }

    const alignedUrdf = alignUrdfToStudioOrientation(vizUrdfContent, {
      sourceUpAxis: suggestion.sourceUpAxis,
      sourceForwardAxis: suggestion.sourceForwardAxis,
      targetUpAxis: suggestion.targetUpAxis,
      targetForwardAxis: suggestion.targetForwardAxis,
    });

    updateUrdfFile(alignedUrdf);
    toast.success(
      `Aligned orientation to ${formatAxisSpec(suggestion.targetUpAxis)}-up / ${formatAxisSpec(
        suggestion.targetForwardAxis
      )}-forward`
    );
  }, [formatAxisSpec, getOrientationCard, updateUrdfFile, vizUrdfContent]);

  const getExportUrdfContent = useCallback(() => {
    if (!vizUrdfContent) return "";
    return deleteJointsFromURDF(vizUrdfContent, deletedJoints);
  }, [deletedJoints, deleteJointsFromURDF, vizUrdfContent]);

  const robotName = useMemo(() => {
    if (!vizUrdfContent) return "robot";
    const parsed = parseURDF(vizUrdfContent);
    if (!parsed.isValid) return "robot";
    const robot = parsed.document.querySelector("robot");
    return robot?.getAttribute("name") || "robot";
  }, [vizUrdfContent]);

  const handleDeleteJoint = useCallback(
    (jointName: string) => {
      if (!vizUrdfContent) {
        toast.error("No URDF content available");
        return;
      }

      const result = removeJointsFromUrdf(vizUrdfContent, new Set([jointName]));
      if (!result.success) {
        toast.error(result.error ?? `Failed to delete joint "${jointName}"`);
        return;
      }

      // Clear any previous soft-delete marker for this joint.
      if (deletedJoints.has(jointName)) {
        toggleDeletedJoint(jointName);
      }

      handleVizUrdfChange(result.content);
      toast.success(`Deleted joint "${jointName}"`);
    },
    [deletedJoints, handleVizUrdfChange, toggleDeletedJoint, vizUrdfContent]
  );

  const handleRotateRobot = useCallback(
    (axis: RotationAxis) => {
      if (!vizUrdfContent) {
        toast.error("No URDF loaded");
        return;
      }

      const result = rotateUrdf(vizUrdfContent, axis);

      if (!result.success) {
        toast.error(result.error ?? "Failed to rotate robot");
        return;
      }

      updateUrdfFile(result.content);
      toast.success(result.message ?? `Robot rotated 90° around ${AXIS_NAMES[axis]}-axis`);
    },
    [updateUrdfFile, vizUrdfContent]
  );

  return {
    handleCanonicalOrder,
    handlePrettyPrint,
    handleNormalizeAxes,
    handleAlignOrientation,
    handleFixMeshPaths,
    handleRotateRobot,
    getOrientationCard,
    getExportUrdfContent,
    robotName,
    handleDeleteJoint,
  };
};
