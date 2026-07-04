export const buildAssemblyContactPairKey = (lhs: string, rhs: string): string => {
  return lhs < rhs ? `${lhs}::${rhs}` : `${rhs}::${lhs}`;
};

export const parseAssemblyContactPairKey = (pairKey: string): [string, string] | null => {
  const parts = pairKey.split("::");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return [parts[0], parts[1]];
};
