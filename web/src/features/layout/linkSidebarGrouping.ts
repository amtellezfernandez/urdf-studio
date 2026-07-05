import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { StructureGroupSection } from "@/features/layout/structureGroups";
import {
  resolveLinkMeshGroupLabel,
} from "@/features/layout/linkSidebarGroupingHelpers";

export type LinkSidebarGroupingMode = "body" | "mesh" | "alpha";

export const LINK_SIDEBAR_GROUPING_MODE_OPTIONS: Array<{
  value: LinkSidebarGroupingMode;
  label: string;
}> = [
  { value: "body", label: "Body" },
  { value: "mesh", label: "Mesh" },
  { value: "alpha", label: "A-Z" },
];

const ALPHA_GROUP_LABEL = "A-Z";

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
