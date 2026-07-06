export type SelectedWorldObjectKeyboardAction =
  | "clear-selection"
  | "focus"
  | "duplicate"
  | "delete";

export const resolveSelectedWorldObjectKeyboardAction = ({
  key,
  shiftKey,
  readOnlyMode,
  isEditableTarget,
}: {
  key: string;
  shiftKey: boolean;
  readOnlyMode: boolean;
  isEditableTarget: boolean;
}): SelectedWorldObjectKeyboardAction | null => {
  if (isEditableTarget) {
    return null;
  }
  if (key === "Escape") {
    return "clear-selection";
  }
  if (key.toLowerCase() === "f") {
    return "focus";
  }
  if (readOnlyMode) {
    return null;
  }
  if (shiftKey && key.toLowerCase() === "d") {
    return "duplicate";
  }
  if (key === "Delete" || key === "Backspace") {
    return "delete";
  }
  return null;
};
