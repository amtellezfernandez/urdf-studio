export type SubstitutionTarget = "host" | "element";

export type SubstitutionAssignments = Record<SubstitutionTarget, string | null>;

export const createEmptySubstitutionAssignments = (): SubstitutionAssignments => ({
  host: null,
  element: null,
});

export const assignSubstitutionTarget = (
  current: SubstitutionAssignments,
  target: SubstitutionTarget,
  selectionId: string
): SubstitutionAssignments => {
  const otherTarget: SubstitutionTarget = target === "host" ? "element" : "host";
  return {
    ...current,
    [target]: selectionId,
    [otherTarget]: current[otherTarget] === selectionId ? null : current[otherTarget],
  };
};

export const clearSubstitutionTarget = (
  current: SubstitutionAssignments,
  target: SubstitutionTarget
): SubstitutionAssignments => ({
  ...current,
  [target]: null,
});

export const pruneSubstitutionAssignments = (
  current: SubstitutionAssignments,
  availableSelectionIds: ReadonlySet<string>
): SubstitutionAssignments => ({
  host: current.host && availableSelectionIds.has(current.host) ? current.host : null,
  element: current.element && availableSelectionIds.has(current.element) ? current.element : null,
});
