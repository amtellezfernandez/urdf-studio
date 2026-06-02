type ResolveEffectiveEndEffectorLinkArgs = {
  explicitEndEffectorLink: string | null | undefined;
  endEffectorCandidates: readonly string[];
  availableLinks: readonly string[];
};

const normalizeLinkName = (value: string | null | undefined): string | null => {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
};

export const resolveEffectiveEndEffectorLink = ({
  explicitEndEffectorLink,
  endEffectorCandidates,
  availableLinks,
}: ResolveEffectiveEndEffectorLinkArgs): string | null => {
  const explicit = normalizeLinkName(explicitEndEffectorLink);
  const orderedCandidates = [
    explicit,
    ...endEffectorCandidates
      .map((candidate) => normalizeLinkName(candidate))
      .filter((candidate): candidate is string => candidate !== null),
  ];
  const uniqueCandidates = Array.from(new Set(orderedCandidates.filter(Boolean)));
  if (uniqueCandidates.length === 0) {
    return null;
  }

  const availableLinkSet = new Set(availableLinks);
  if (availableLinkSet.size === 0) {
    return uniqueCandidates[0] ?? null;
  }

  const firstKnownCandidate = uniqueCandidates.find((candidate) =>
    availableLinkSet.has(candidate)
  );
  if (firstKnownCandidate) {
    return firstKnownCandidate;
  }
  return uniqueCandidates[0] ?? null;
};
