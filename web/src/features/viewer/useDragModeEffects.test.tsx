/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDragModeEffects } from "@/features/viewer/useDragModeEffects";

const renderDragModeEffects = async ({
  isDragModeMenuOpen,
  setIsDragModeMenuOpen,
}: {
  isDragModeMenuOpen: boolean;
  setIsDragModeMenuOpen: (open: boolean) => void;
}) => {
  const Probe = () => {
    useDragModeEffects({
      isDragModeMenuOpen,
      setIsDragModeMenuOpen,
    });
    return null;
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe));
  });
  return root;
};

describe("useDragModeEffects", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("closes the drag mode menu on outside document clicks", async () => {
    const setIsDragModeMenuOpen = vi.fn();
    const root = await renderDragModeEffects({
      isDragModeMenuOpen: true,
      setIsDragModeMenuOpen,
    });

    await act(async () => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(setIsDragModeMenuOpen).toHaveBeenCalledWith(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("does not bind outside click handling when the menu is closed", async () => {
    const setIsDragModeMenuOpen = vi.fn();
    const root = await renderDragModeEffects({
      isDragModeMenuOpen: false,
      setIsDragModeMenuOpen,
    });

    await act(async () => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(setIsDragModeMenuOpen).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
