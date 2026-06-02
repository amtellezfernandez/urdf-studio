const toSortedUniqueLinks = (links: string[]): string[] =>
  Array.from(new Set(links)).sort((lhs, rhs) => lhs.localeCompare(rhs));

export const replaceMergedCollisionLinks = (selectedLinks: string[]): string[] =>
  toSortedUniqueLinks(selectedLinks);

export const removeMergedCollisionLinks = (
  existingMergedLinks: string[],
  selectedLinks: string[]
): string[] => {
  const selectedSet = new Set(selectedLinks);
  return existingMergedLinks
    .filter((linkName) => !selectedSet.has(linkName))
    .sort((lhs, rhs) => lhs.localeCompare(rhs));
};

