import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { StructureGroupSection } from "@/features/layout/structureGroups";

export type LinkSidebarGroupingMode = "body" | "mesh" | "alpha";

export const LINK_SIDEBAR_GROUPING_MODE_OPTIONS: Array<{
  value: LinkSidebarGroupingMode;
  label: string;
}> = [
  { value: "body", label: "Body" },
  { value: "mesh", label: "Mesh" },
  { value: "alpha", label: "A-Z" },
];

const DEFAULT_MESH_GROUP_LABEL = "Other";
const ALPHA_GROUP_LABEL = "A-Z";

const extractMeshFilename = (meshReference: string): string => {
  const segments = meshReference.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || meshReference;
};

const resolveLinkMeshGroupLabel = (
  analysis: UrdfAnalysis | null | undefined,
  linkName: string
): string => {
  if (!analysis?.isValid) {
    return DEFAULT_MESH_GROUP_LABEL;
  }
  const linkData = analysis.linkDataByName[linkName];
  if (!linkData) {
    return DEFAULT_MESH_GROUP_LABEL;
  }
  const meshReference =
    linkData.visuals.find(
      (entry) => entry.geometry.type === "mesh" && Boolean(entry.geometry.params.filename?.trim())
    )?.geometry.params.filename?.trim() ??
    linkData.collisions.find(
      (entry) => entry.geometry.type === "mesh" && Boolean(entry.geometry.params.filename?.trim())
    )?.geometry.params.filename?.trim() ??
    "";
  return meshReference ? extractMeshFilename(meshReference) : DEFAULT_MESH_GROUP_LABEL;
};

export const buildMeshGroupedLinkSections = ({
  analysis,
  filteredLinks,
}: {
  analysis: UrdfAnalysis | null | undefined;
  filteredLinks: readonly string[];
}): StructureGroupSection[] => {
  const linksByMeshLabel = new Map<string, string[]>();
  filteredLinks.forEach((linkName) => {
    const meshLabel = resolveLinkMeshGroupLabel(analysis, linkName);
    const currentLinks = linksByMeshLabel.get(meshLabel) ?? [];
    currentLinks.push(linkName);
    linksByMeshLabel.set(meshLabel, currentLinks);
  });
  return Array.from(linksByMeshLabel.entries())
    .sort(([leftLabel], [rightLabel]) => leftLabel.localeCompare(rightLabel))
    .map(([label, items]) => ({
      id: `mesh:${label}`,
      label,
      items: [...items].sort((left, right) => left.localeCompare(right)),
    }));
};

export const buildAlphabeticalLinkSections = (
  filteredLinks: readonly string[]
): StructureGroupSection[] =>
  filteredLinks.length === 0
    ? []
    : [
        {
          id: "alpha:a-z",
          label: ALPHA_GROUP_LABEL,
          items: [...filteredLinks].sort((left, right) => left.localeCompare(right)),
        },
      ];
