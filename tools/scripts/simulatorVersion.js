function parseVersion(version) {
  return (typeof version === 'string' ? version : '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
}

export function compareVersions(actual, required) {
  const actualParts = parseVersion(actual);
  const requiredParts = parseVersion(required);
  const count = Math.max(actualParts.length, requiredParts.length);
  for (let index = 0; index < count; index += 1) {
    const actualPart = actualParts[index] || 0;
    const requiredPart = requiredParts[index] || 0;
    if (actualPart > requiredPart) return 1;
    if (actualPart < requiredPart) return -1;
  }
  return 0;
}
