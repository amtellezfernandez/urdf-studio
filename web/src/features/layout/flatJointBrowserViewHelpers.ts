export const resolveFlatJointBrowserEmptyState = ({
  searchQuery,
  typeFilter,
}: {
  searchQuery: string;
  typeFilter: string;
}): string =>
  searchQuery || typeFilter !== "all"
    ? "No joints match the filters"
    : "No joints available";

export const resolveJointGroupLabel = ({
  fallbackSectionLabel,
  jointName,
  structureJointLabels,
}: {
  fallbackSectionLabel: string | null | undefined;
  jointName: string;
  structureJointLabels: Record<string, string | undefined>;
}): string | null => structureJointLabels[jointName] ?? fallbackSectionLabel ?? null;
