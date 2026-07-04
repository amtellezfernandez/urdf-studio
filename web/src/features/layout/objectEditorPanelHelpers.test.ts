// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  applyObjectEditorKeyboardCommand,
  isEditableKeyboardTarget,
  normalizeDegrees360,
  normalizeOrbitStartPoint,
  resolveObjectEditorKeyboardCommand,
  resolveObjectReferenceSelectValue,
  resolveTrackedJointValueFromSelection,
  toObjectEditModeLabel,
} from "@/features/layout/objectEditorPanelHelpers";

describe("objectEditorPanelHelpers", () => {
  it("formats edit mode labels", () => {
    expect(toObjectEditModeLabel("move")).toBe("Move");
    expect(toObjectEditModeLabel("rotate")).toBe("Rotate");
    expect(toObjectEditModeLabel("resize")).toBe("Resize");
  });

  it("normalizes orbit start point", () => {
    expect(normalizeOrbitStartPoint(undefined)).toBe("primary");
    expect(normalizeOrbitStartPoint("center")).toBe("primary");
    expect(normalizeOrbitStartPoint("secondary")).toBe("secondary");
  });

  it("normalizes wrapped degree values", () => {
    expect(normalizeDegrees360(450)).toBe(90);
    expect(normalizeDegrees360(-90)).toBe(270);
  });

  it("recognizes editable keyboard targets", () => {
    const input = document.createElement("input");
    const div = document.createElement("div");
    Object.defineProperty(div, "isContentEditable", { value: true });

    expect(isEditableKeyboardTarget(input)).toBe(true);
    expect(isEditableKeyboardTarget(div)).toBe(true);
    expect(isEditableKeyboardTarget(document.createElement("button"))).toBe(false);
  });

  it("resolves the reference select value", () => {
    expect(
      resolveObjectReferenceSelectValue({
        trackedJointName: "wrist_link",
        endEffectorLink: "tool0",
      })
    ).toBe("wrist_link");
    expect(
      resolveObjectReferenceSelectValue({
        trackedJointName: null,
        endEffectorLink: "tool0",
      })
    ).toBe("__end_effector__");
    expect(
      resolveObjectReferenceSelectValue({
        trackedJointName: null,
        endEffectorLink: null,
      })
    ).toBe("none");
  });

  it("maps reference selections back to tracked joints", () => {
    expect(resolveTrackedJointValueFromSelection("none")).toBeNull();
    expect(resolveTrackedJointValueFromSelection("__end_effector__")).toBeNull();
    expect(resolveTrackedJointValueFromSelection("wrist_link")).toBe("wrist_link");
  });

  it("returns null for editable keyboard targets", () => {
    const input = document.createElement("input");
    expect(
      resolveObjectEditorKeyboardCommand({
        key: "g",
        modifiers: { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
        position: new THREE.Vector3(1, 2, 3),
        target: input,
      })
    ).toBeNull();
  });

  it("resolves mode and undo/redo keyboard commands", () => {
    expect(
      resolveObjectEditorKeyboardCommand({
        key: "g",
        modifiers: { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
        position: new THREE.Vector3(),
        target: null,
      })
    ).toEqual({ type: "selectMode", mode: "move" });

    expect(
      resolveObjectEditorKeyboardCommand({
        key: "z",
        modifiers: { altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
        position: new THREE.Vector3(),
        target: null,
      })
    ).toEqual({ type: "undo" });

    expect(
      resolveObjectEditorKeyboardCommand({
        key: "z",
        modifiers: { altKey: false, ctrlKey: true, metaKey: false, shiftKey: true },
        position: new THREE.Vector3(),
        target: null,
      })
    ).toEqual({ type: "redo" });
  });

  it("resolves arrow movement with modifier-sensitive steps", () => {
    const result = resolveObjectEditorKeyboardCommand({
      key: "ArrowUp",
      modifiers: { altKey: false, ctrlKey: true, metaKey: false, shiftKey: true },
      position: new THREE.Vector3(1, 2, 3),
      target: null,
    });

    expect(result?.type).toBe("updatePosition");
    if (result?.type === "updatePosition") {
      expect(result.position.toArray()).toEqual([1, 2, 3.002]);
    }
  });

  it("applies resolved keyboard commands through the provided callbacks", () => {
    const events: string[] = [];

    applyObjectEditorKeyboardCommand({
      command: { type: "undo" },
      onRedo: () => events.push("redo"),
      onSelectMode: (mode) => events.push(`mode:${mode}`),
      onToggleTransformSpace: () => events.push("space"),
      onUndo: () => events.push("undo"),
      onUpdatePosition: (position) => events.push(`pos:${position.toArray().join(",")}`),
    });
    applyObjectEditorKeyboardCommand({
      command: { type: "selectMode", mode: "rotate" },
      onRedo: () => events.push("redo"),
      onSelectMode: (mode) => events.push(`mode:${mode}`),
      onToggleTransformSpace: () => events.push("space"),
      onUndo: () => events.push("undo"),
      onUpdatePosition: (position) => events.push(`pos:${position.toArray().join(",")}`),
    });
    applyObjectEditorKeyboardCommand({
      command: { type: "toggleTransformSpace" },
      onRedo: () => events.push("redo"),
      onSelectMode: (mode) => events.push(`mode:${mode}`),
      onToggleTransformSpace: () => events.push("space"),
      onUndo: () => events.push("undo"),
      onUpdatePosition: (position) => events.push(`pos:${position.toArray().join(",")}`),
    });
    applyObjectEditorKeyboardCommand({
      command: { type: "updatePosition", position: new THREE.Vector3(4, 5, 6) },
      onRedo: () => events.push("redo"),
      onSelectMode: (mode) => events.push(`mode:${mode}`),
      onToggleTransformSpace: () => events.push("space"),
      onUndo: () => events.push("undo"),
      onUpdatePosition: (position) => events.push(`pos:${position.toArray().join(",")}`),
    });

    expect(events).toEqual(["undo", "mode:rotate", "space", "pos:4,5,6"]);
  });
});
