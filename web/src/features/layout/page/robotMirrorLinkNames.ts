export const toSortedUniqueRobotMirrorLinkNames = (
  linkNames: Iterable<string>
): string[] =>
  Array.from(
    new Set(Array.from(linkNames).map((linkName) => linkName.trim()).filter(Boolean))
  ).sort((left, right) => left.localeCompare(right));
