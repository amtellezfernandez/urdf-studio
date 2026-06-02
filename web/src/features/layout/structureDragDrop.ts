export const STRUCTURE_DROP_GROUP_LABEL_ATTRIBUTE = "data-structure-group-label";

const STRUCTURE_DROP_GROUP_SELECTOR = `[${STRUCTURE_DROP_GROUP_LABEL_ATTRIBUTE}]`;

const normalizeStructureDropGroupLabel = (label: string | null): string | null => {
  const normalized = label?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
};

const toPointCandidateElements = (
  documentRef: Document,
  clientX: number,
  clientY: number
): Element[] => {
  if (typeof documentRef.elementsFromPoint === "function") {
    const stack = documentRef.elementsFromPoint(clientX, clientY);
    if (stack.length > 0) {
      return stack;
    }
  }
  const topElement = documentRef.elementFromPoint(clientX, clientY);
  return topElement ? [topElement] : [];
};

const findDropGroupElement = (
  candidates: readonly Element[],
  container: HTMLElement
): HTMLElement | null => {
  for (const candidate of candidates) {
    const groupElement = candidate.closest(STRUCTURE_DROP_GROUP_SELECTOR);
    if (!(groupElement instanceof HTMLElement)) {
      continue;
    }
    if (!container.contains(groupElement)) {
      continue;
    }
    return groupElement;
  }
  return null;
};

export const readStructureDropGroupLabel = (element: Element | null): string | null => {
  if (!element) return null;
  return normalizeStructureDropGroupLabel(
    element.getAttribute(STRUCTURE_DROP_GROUP_LABEL_ATTRIBUTE)
  );
};

export const resolveStructureDropGroupLabelFromPoint = ({
  container,
  clientX,
  clientY,
}: {
  container: HTMLElement;
  clientX: number;
  clientY: number;
}): string | null => {
  const candidates = toPointCandidateElements(container.ownerDocument, clientX, clientY);
  if (candidates.length === 0) {
    return null;
  }
  const dropGroupElement = findDropGroupElement(candidates, container);
  return readStructureDropGroupLabel(dropGroupElement);
};
