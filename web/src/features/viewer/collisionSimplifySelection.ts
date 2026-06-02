export const applyCollisionSimplifyToSelectedLinks = (
  existingSimplifiedLinks: string[],
  selectedLinks: string[],
  simplify: boolean
) => {
  const existingSet = new Set(existingSimplifiedLinks);
  if (simplify) {
    selectedLinks.forEach((linkName) => existingSet.add(linkName));
  } else {
    selectedLinks.forEach((linkName) => existingSet.delete(linkName));
  }
  return Array.from(existingSet).sort((lhs, rhs) => lhs.localeCompare(rhs));
};
