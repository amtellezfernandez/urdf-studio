type DocumentBodyInteractionLockOptions = {
  cursor?: string;
  userSelect?: string;
};

const resolveDocumentBody = (
  documentRef: Document | null | undefined
): HTMLElement | null => documentRef?.body ?? null;

export const lockDocumentBodyInteraction = (
  { cursor, userSelect }: DocumentBodyInteractionLockOptions,
  documentRef: Document | null | undefined = typeof document === "undefined" ? undefined : document
): (() => void) => {
  const body = resolveDocumentBody(documentRef);
  if (!body) {
    return () => {};
  }

  const previousCursor = body.style.cursor;
  const previousUserSelect = body.style.userSelect;

  if (cursor !== undefined) {
    body.style.cursor = cursor;
  }
  if (userSelect !== undefined) {
    body.style.userSelect = userSelect;
  }

  return () => {
    body.style.cursor = previousCursor;
    body.style.userSelect = previousUserSelect;
  };
};
