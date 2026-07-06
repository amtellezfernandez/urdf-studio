import { describe, expect, it } from "vitest";

import { resolveSelectedWorldObjectKeyboardAction } from "@/features/viewer/selectedWorldObjectKeyboardAction";

describe("resolveSelectedWorldObjectKeyboardAction", () => {
  it("ignores editable targets", () => {
    expect(
      resolveSelectedWorldObjectKeyboardAction({
        key: "Escape",
        shiftKey: false,
        readOnlyMode: false,
        isEditableTarget: true,
      })
    ).toBeNull();
  });

  it("allows non-mutating actions in read-only mode", () => {
    expect(
      resolveSelectedWorldObjectKeyboardAction({
        key: "Escape",
        shiftKey: false,
        readOnlyMode: true,
        isEditableTarget: false,
      })
    ).toBe("clear-selection");
    expect(
      resolveSelectedWorldObjectKeyboardAction({
        key: "F",
        shiftKey: false,
        readOnlyMode: true,
        isEditableTarget: false,
      })
    ).toBe("focus");
  });

  it("blocks mutating actions in read-only mode", () => {
    expect(
      resolveSelectedWorldObjectKeyboardAction({
        key: "D",
        shiftKey: true,
        readOnlyMode: true,
        isEditableTarget: false,
      })
    ).toBeNull();
    expect(
      resolveSelectedWorldObjectKeyboardAction({
        key: "Delete",
        shiftKey: false,
        readOnlyMode: true,
        isEditableTarget: false,
      })
    ).toBeNull();
  });

  it("resolves duplicate and delete actions outside read-only mode", () => {
    expect(
      resolveSelectedWorldObjectKeyboardAction({
        key: "d",
        shiftKey: true,
        readOnlyMode: false,
        isEditableTarget: false,
      })
    ).toBe("duplicate");
    expect(
      resolveSelectedWorldObjectKeyboardAction({
        key: "Backspace",
        shiftKey: false,
        readOnlyMode: false,
        isEditableTarget: false,
      })
    ).toBe("delete");
  });

  it("ignores unrelated keys and unshifted d", () => {
    expect(
      resolveSelectedWorldObjectKeyboardAction({
        key: "d",
        shiftKey: false,
        readOnlyMode: false,
        isEditableTarget: false,
      })
    ).toBeNull();
    expect(
      resolveSelectedWorldObjectKeyboardAction({
        key: "x",
        shiftKey: false,
        readOnlyMode: false,
        isEditableTarget: false,
      })
    ).toBeNull();
  });
});
