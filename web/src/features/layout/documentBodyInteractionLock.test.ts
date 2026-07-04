/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { lockDocumentBodyInteraction } from "@/features/layout/documentBodyInteractionLock";

describe("documentBodyInteractionLock", () => {
  it("applies temporary body interaction styles and restores them on cleanup", () => {
    document.body.style.cursor = "crosshair";
    document.body.style.userSelect = "text";

    const release = lockDocumentBodyInteraction({
      cursor: "col-resize",
      userSelect: "none",
    });

    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    release();

    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
  });

  it("only overwrites the provided body style properties", () => {
    document.body.style.cursor = "grab";
    document.body.style.userSelect = "text";

    const release = lockDocumentBodyInteraction({
      userSelect: "none",
    });

    expect(document.body.style.cursor).toBe("grab");
    expect(document.body.style.userSelect).toBe("none");

    release();

    expect(document.body.style.cursor).toBe("grab");
    expect(document.body.style.userSelect).toBe("text");
  });
});
