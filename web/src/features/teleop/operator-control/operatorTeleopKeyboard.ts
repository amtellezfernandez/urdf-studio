export const isOperatorTeleopEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  const editableAncestor = target.closest("[contenteditable]");
  const contentEditableValue = editableAncestor?.getAttribute("contenteditable");
  return (
    target.isContentEditable ||
    (editableAncestor !== null && contentEditableValue?.toLowerCase() !== "false") ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
};
