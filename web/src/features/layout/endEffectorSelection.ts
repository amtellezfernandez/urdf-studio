type ResolveEffectiveEndEffectorLinkArgs = {
  explicitEndEffectorLink: string | null | undefined;
  endEffectorCandidates: readonly string[];
  availableLinks: readonly string[];
};

export const normalizeLinkName = (value: string | null | undefined): string | null => {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
};

export const buildOrderedEndEffectorCandidates = ({
  explicitEndEffectorLink,
  endEffectorCandidates,
}: {
  explicitEndEffectorLink: string | null | undefined;
  endEffectorCandidates: readonly string[];
}): string[] => {
  const explicit = normalizeLinkName(explicitEndEffectorLink);
  return Array.from(
    new Set(
      [
        explicit,
        ...endEffectorCandidates
          .map((candidate) => normalizeLinkName(candidate))
          .filter((candidate): candidate is string => candidate !== null),
      ].filter(Boolean)
    )
  );
};

export const resolveFirstKnownEndEffectorCandidate = ({
  availableLinks,
  orderedCandidates,
}: {
  availableLinks: readonly string[];
  orderedCandidates: readonly string[];
}): string | null => {
  if (orderedCandidates.length === 0) {
    return null;
  }

  const availableLinkSet = new Set(availableLinks);
  if (availableLinkSet.size === 0) {
    return orderedCandidates[0] ?? null;
  }

  return (
    orderedCandidates.find((candidate) => availableLinkSet.has(candidate)) ??
    orderedCandidates[0] ??
    null
  );
};

export const resolveEffectiveEndEffectorLink = ({
  explicitEndEffectorLink,
  endEffectorCandidates,
  availableLinks,
}: ResolveEffectiveEndEffectorLinkArgs): string | null => {
  const orderedCandidates = buildOrderedEndEffectorCandidates({
    explicitEndEffectorLink,
    endEffectorCandidates,
  });
  return resolveFirstKnownEndEffectorCandidate({
    availableLinks,
    orderedCandidates,
  });
};
