import { validateInertiaTensor } from "@/features/viewer/inertialMath";
import { getPathSegments } from "@/shared/lib/pathNames";
import { normalizeMeshPathForMatch, resolveMeshBlobFromReference } from "@/shared/lib/urdfBrowser";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { DebugMeshInfo, MeshFiles } from "@/shared/types/feature";

export type InertialIssueSummary = {
  missing: string[];
  invalidMass: string[];
  invalidTensor: string[];
};

export type CollisionMeshStats = {
  total: number;
  matched: number;
  missing: string[];
};

export type LoadReviewAttentionInput = {
  urdfValidationError?: string | null;
  unmatchedURDFRefs: readonly string[];
  absoluteFileMeshRefs: readonly string[];
  missingPackageRefs: readonly string[];
  inertialIssues: InertialIssueSummary;
  collisionMeshStats: CollisionMeshStats;
  orientationNeedsAttention: boolean;
};

export const buildMeshRootHints = (debugMeshInfo: readonly DebugMeshInfo[]): string[] => {
  if (debugMeshInfo.length === 0) return [];
  const roots = new Set<string>();
  const score = (path: string) => {
    let value = 0;
    if (path.includes("/meshes")) value += 2;
    if (path.includes("/assets")) value += 2;
    const depthPenalty = getPathSegments(path).length;
    return value * 100 - depthPenalty;
  };

  for (const info of debugMeshInfo) {
    const normalized = normalizeMeshPathForMatch(info.webkitRelativePath || "");
    if (!normalized) continue;
    const parts = getPathSegments(normalized);
    if (parts.length <= 1) continue;
    const dir = parts.slice(0, -1).join("/");
    if (dir) roots.add(dir);
    const meshesIndex = parts.lastIndexOf("meshes");
    const assetsIndex = parts.lastIndexOf("assets");
    const folderIndex = Math.max(meshesIndex, assetsIndex);
    if (folderIndex !== -1) {
      roots.add(parts.slice(0, folderIndex + 1).join("/"));
    }
  }

  return Array.from(roots)
    .sort((left, right) => score(right) - score(left))
    .slice(0, 3);
};

export const buildInertialIssues = (
  urdfAnalysis: UrdfAnalysis | null | undefined
): InertialIssueSummary => {
  if (!urdfAnalysis?.isValid) {
    return {
      missing: [],
      invalidMass: [],
      invalidTensor: [],
    };
  }
  const missing: string[] = [];
  const invalidMass: string[] = [];
  const invalidTensor: string[] = [];
  urdfAnalysis.linkNames.forEach((linkName) => {
    const data = urdfAnalysis.linkDataByName[linkName];
    if (!data?.inertial) {
      missing.push(linkName);
      return;
    }
    const mass = Number(data.inertial.mass ?? 0);
    if (!Number.isFinite(mass) || mass <= 0) {
      invalidMass.push(linkName);
      return;
    }
    const tensorCheck = validateInertiaTensor(data.inertial.inertia);
    if (!tensorCheck.valid) {
      invalidTensor.push(linkName);
    }
  });
  return { missing, invalidMass, invalidTensor };
};

export const buildCollisionMeshStats = ({
  urdfAnalysis,
  meshFiles,
  urdfBasePath,
  packageRoots,
}: {
  urdfAnalysis: UrdfAnalysis | null | undefined;
  meshFiles: MeshFiles;
  urdfBasePath?: string;
  packageRoots?: Record<string, string[]>;
}): CollisionMeshStats => {
  if (!urdfAnalysis?.isValid) {
    return { total: 0, matched: 0, missing: [] };
  }
  let total = 0;
  let matched = 0;
  const missing: string[] = [];
  urdfAnalysis.collisionEntries.forEach((entry) => {
    if (entry.geometry.type !== "mesh") return;
    total += 1;
    const resolved = resolveMeshBlobFromReference(
      entry.geometry.filename,
      meshFiles,
      urdfBasePath,
      packageRoots
    );
    if (resolved) {
      matched += 1;
    } else {
      missing.push(entry.geometry.filename);
    }
  });
  return { total, matched, missing };
};

export const hasLoadReviewAttention = ({
  urdfValidationError,
  unmatchedURDFRefs,
  absoluteFileMeshRefs,
  missingPackageRefs,
  inertialIssues,
  collisionMeshStats,
  orientationNeedsAttention,
}: LoadReviewAttentionInput): boolean =>
  Boolean(
    urdfValidationError ||
      unmatchedURDFRefs.length > 0 ||
      absoluteFileMeshRefs.length > 0 ||
      missingPackageRefs.length > 0 ||
      inertialIssues.missing.length > 0 ||
      inertialIssues.invalidMass.length > 0 ||
      inertialIssues.invalidTensor.length > 0 ||
      collisionMeshStats.missing.length > 0 ||
      orientationNeedsAttention
  );
