import * as THREE from "three";

export type ObjectEditMode = "move" | "rotate" | "resize";
export type ObjectTransformSpace = "world" | "local";
export type OrbitStartPoint = "primary" | "secondary";

export type ObjectEditorKeyboardCommand =
  | { type: "redo" | "undo" }
  | { mode: ObjectEditMode; type: "selectMode" }
  | { type: "toggleTransformSpace" }
  | { position: THREE.Vector3; type: "updatePosition" };

type KeyboardModifierState = {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export const toObjectEditModeLabel = (mode: ObjectEditMode): string => {
  if (mode === "move") return "Move";
  if (mode === "rotate") return "Rotate";
  return "Resize";
};

export const normalizeOrbitStartPoint = (
  value: "center" | "primary" | "secondary" | undefined
): OrbitStartPoint => (value && value !== "center" ? value : "primary");

export const normalizeDegrees360 = (value: number): number => ((value % 360) + 360) % 360;

export const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return Boolean(
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
};

export const resolveObjectReferenceSelectValue = ({
  endEffectorLink,
  trackedJointName,
}: {
  endEffectorLink?: string | null;
  trackedJointName: string | null;
}): string => {
  if (trackedJointName) {
    return trackedJointName;
  }
  return endEffectorLink ? "__end_effector__" : "none";
};

export const resolveTrackedJointValueFromSelection = (
  value: string
): string | null => {
  if (value === "none" || value === "__end_effector__") {
    return null;
  }
  return value;
};

const resolvePositionStep = (modifiers: KeyboardModifierState): number => {
  const baseStep = modifiers.metaKey || modifiers.ctrlKey ? 0.002 : 0.01;
  return modifiers.altKey ? 0.05 : baseStep;
};

export const resolveObjectEditorKeyboardCommand = ({
  key,
  modifiers,
  position,
  target,
}: {
  key: string;
  modifiers: KeyboardModifierState;
  position: THREE.Vector3;
  target: EventTarget | null;
}): ObjectEditorKeyboardCommand | null => {
  if (isEditableKeyboardTarget(target)) {
    return null;
  }

  const normalizedKey = key.toLowerCase();
  if ((modifiers.metaKey || modifiers.ctrlKey) && normalizedKey === "z") {
    return { type: modifiers.shiftKey ? "redo" : "undo" };
  }
  if ((modifiers.metaKey || modifiers.ctrlKey) && normalizedKey === "y") {
    return { type: "redo" };
  }
  if (normalizedKey === "g") {
    return { type: "selectMode", mode: "move" };
  }
  if (normalizedKey === "s") {
    return { type: "selectMode", mode: "resize" };
  }
  if (normalizedKey === "r") {
    return { type: "selectMode", mode: "rotate" };
  }
  if (normalizedKey === "q") {
    return { type: "toggleTransformSpace" };
  }
  if (key === "Escape") {
    return { type: "selectMode", mode: "move" };
  }

  const step = resolvePositionStep(modifiers);
  const nextPosition = position.clone();

  switch (key) {
    case "ArrowLeft":
      nextPosition.x -= step;
      break;
    case "ArrowRight":
      nextPosition.x += step;
      break;
    case "ArrowUp":
      if (modifiers.shiftKey) {
        nextPosition.z += step;
      } else {
        nextPosition.y += step;
      }
      break;
    case "ArrowDown":
      if (modifiers.shiftKey) {
        nextPosition.z -= step;
      } else {
        nextPosition.y -= step;
      }
      break;
    default:
      return null;
  }

  return {
    type: "updatePosition",
    position: nextPosition,
  };
};
