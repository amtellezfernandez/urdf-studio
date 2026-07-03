import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import {
  parseMeshReference,
  resolveMeshBlobFromReference,
} from "@/shared/lib/urdfBrowser";
import type { MeshFiles } from "@/shared/types/feature";

export type UrdfLoadIssueSummary = {
  unmatchedRefs: string[];
  absoluteFileRefs: string[];
  missingPackages: string[];
  hasIssues: boolean;
};

export const collectMissingPackages = ({
  meshFiles,
  meshReferences,
  packageRoots,
  urdfBasePath,
}: {
  meshFiles?: MeshFiles;
  meshReferences: readonly string[];
  packageRoots: Record<string, string[]>;
  urdfBasePath?: string;
}): string[] => {
  const missing = new Set<string>();
  meshReferences.forEach((ref) => {
    const refInfo = parseMeshReference(ref);
    if (refInfo.scheme !== "package" || !refInfo.packageName) return;
    if (packageRoots[refInfo.packageName]) return;
    if (meshFiles && resolveMeshBlobFromReference(ref, meshFiles, urdfBasePath, packageRoots)) {
      return;
    }
    missing.add(refInfo.packageName);
  });
  return Array.from(missing);
};

export const summarizeUrdfLoadIssues = ({
  analysis,
  meshFiles,
  packageRoots,
  parsedIsValid,
  urdfBasePath,
}: {
  analysis: UrdfAnalysis;
  meshFiles: MeshFiles;
  packageRoots: Record<string, string[]>;
  parsedIsValid: boolean;
  urdfBasePath: string;
}): UrdfLoadIssueSummary => {
  const unmatchedRefs = analysis.meshReferences.filter((ref) => {
    const refInfo = parseMeshReference(ref);
    if (refInfo.isAbsoluteFile) {
      return false;
    }
    return !resolveMeshBlobFromReference(ref, meshFiles, urdfBasePath, packageRoots);
  });
  const absoluteFileRefs = analysis.absoluteFileMeshRefs;
  const missingPackages = collectMissingPackages({
    meshFiles,
    meshReferences: analysis.meshReferences,
    packageRoots,
    urdfBasePath,
  });
  const hasIssues =
    unmatchedRefs.length > 0 ||
    absoluteFileRefs.length > 0 ||
    missingPackages.length > 0 ||
    !parsedIsValid;

  return {
    absoluteFileRefs,
    hasIssues,
    missingPackages,
    unmatchedRefs,
  };
};
