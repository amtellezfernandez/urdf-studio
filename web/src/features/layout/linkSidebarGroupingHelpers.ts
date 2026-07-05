import type { UrdfAnalysis } from "@/shared/lib/urdfCore";

export const LINK_SIDEBAR_GROUPING_DEFAULTS = {
  meshGroupLabel: "Other",
} as const;

const resolveLinkMeshReference = (
  analysis: UrdfAnalysis | null | undefined,
  linkName: string
): string => {
  if (!analysis?.isValid) {
    return "";
  }

  const linkData = analysis.linkDataByName[linkName];
  if (!linkData) {
    return "";
  }

  return (
    linkData.visuals.find(
      (entry) => entry.geometry.type === "mesh" && Boolean(entry.geometry.params.filename?.trim())
    )?.geometry.params.filename?.trim() ??
    linkData.collisions.find(
      (entry) => entry.geometry.type === "mesh" && Boolean(entry.geometry.params.filename?.trim())
    )?.geometry.params.filename?.trim() ??
    ""
  );
};

export const extractMeshFilename = (meshReference: string): string => {
  const segments = meshReference.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || meshReference;
};

export const resolveLinkMeshGroupLabel = (
  analysis: UrdfAnalysis | null | undefined,
  linkName: string
): string => {
  const meshReference = resolveLinkMeshReference(analysis, linkName);
  return meshReference
    ? extractMeshFilename(meshReference)
    : LINK_SIDEBAR_GROUPING_DEFAULTS.meshGroupLabel;
};
