/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ObjectEditorPanel } from "@/features/layout/ObjectEditorPanel";
import { useObjectStore } from "@/features/objects";

vi.mock("@/shared/ui/select", async () => {
  const React = await import("react");

  return {
    Select: ({
      children,
      onValueChange,
      value,
    }: {
      children: React.ReactNode;
      onValueChange: (value: string) => void;
      value: string;
    }) =>
      React.createElement(
        "div",
        { "data-select-value": value },
        React.createElement(
          "button",
          {
            onClick: () =>
              onValueChange(
                value === "none"
                  ? "__end_effector__"
                  : value === "__end_effector__"
                    ? "none"
                    : value === "punctual"
                      ? "orbit"
                      : value === "primary"
                        ? "secondary"
                        : "none"
              ),
            type: "button",
          },
          `select ${value}`
        ),
        children
      ),
    SelectContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", null, children),
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) =>
      React.createElement("div", { "data-select-item": value }, children),
    SelectTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", null, children),
    SelectValue: () => React.createElement("span", null, "value"),
  };
});

vi.mock("@/shared/ui/blender-panel", async () => {
  const React = await import("react");

  return {
    BlenderPanel: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-blender-panel": "true" }, children),
    BlenderPropertyRow: ({
      children,
      label,
    }: {
      children: React.ReactNode;
      label: React.ReactNode;
    }) =>
      React.createElement(
        "div",
        { "data-property-row": String(label) },
        React.createElement("span", null, label),
        children
      ),
  };
});

vi.mock("@/features/layout/sidebarNumberField", async () => {
  const React = await import("react");

  return {
    LabeledNumberField: ({
      label,
      onValueChange,
      value,
    }: {
      label: string;
      onValueChange: (value: number) => void;
      value: number;
    }) =>
      React.createElement(
        "button",
        {
          "data-number-field": label,
          onClick: () => onValueChange(value + 1),
          type: "button",
        },
        `${label}:${value}`
      ),
  };
});

vi.mock("@/features/viewer/trackingTarget", async () => {
  const THREE = await import("three");

  return {
    resolveTrackingReference: ({
      trackedName,
      endEffectorLink,
    }: {
      trackedName?: string | null;
      endEffectorLink?: string | null;
    }) => {
      if (trackedName) {
        return {
          label: `Joint: ${trackedName}`,
          position: new THREE.Vector3(0, 0, 0),
        };
      }
      if (endEffectorLink) {
        return {
          label: `End-effector: ${endEffectorLink}`,
          position: new THREE.Vector3(1, 0, 0),
        };
      }
      return null;
    },
  };
});

const renderObjectEditor = async () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(ObjectEditorPanel, {
        availableLinks: ["wrist_link", "tool0"],
        endEffectorLink: "tool0",
        objectId: "object-a",
        sidebarWidth: 320,
      })
    );
  });

  return { container, root };
};

describe("ObjectEditorPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const store = useObjectStore.getState();
    store.clearObjects();
    store.addObject(
      {
        id: "object-a",
        type: "cube",
        position: new THREE.Vector3(0, 0, 0),
        size: new THREE.Vector3(0.2, 0.2, 0.2),
        color: "#ffffff",
        trackedJointName: null,
        isIkTarget: true,
        ikTargetType: "punctual",
      },
      { select: true }
    );
  });

  it("returns null when the selected object does not exist", async () => {
    useObjectStore.getState().clearObjects();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(ObjectEditorPanel, {
          availableLinks: [],
          objectId: "missing",
          sidebarWidth: 320,
        })
      );
    });

    expect(container.textContent).toBe("");

    await act(async () => {
      root.unmount();
    });
  });

  it("updates vector fields through store actions", async () => {
    const { container, root } = await renderObjectEditor();

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.getAttribute("data-number-field") === "X")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const updatedObject = useObjectStore.getState().objects.find((object) => object.id === "object-a");
    expect(updatedObject?.position.x).toBe(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("updates reference and orbit mode selections", async () => {
    const { container, root } = await renderObjectEditor();

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "select __end_effector__")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "select punctual")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const updatedObject = useObjectStore.getState().objects.find((object) => object.id === "object-a");
    expect(updatedObject?.trackedJointName).toBeNull();
    expect(updatedObject?.ikTargetType).toBe("orbit");
    expect(container.textContent).toContain("Click object: robot moves to orbit start");

    await act(async () => {
      root.unmount();
    });
  });

  it("applies keyboard shortcuts for mode selection, transform toggle, and undo/redo", async () => {
    const { root } = await renderObjectEditor();
    const store = useObjectStore.getState();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "r" }));
    });
    expect(useObjectStore.getState().editMode).toBe("rotate");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "q" }));
    });
    expect(useObjectStore.getState().transformSpace).toBe("local");

    store.updateObjectPosition("object-a", new THREE.Vector3(2, 0, 0));
    expect(useObjectStore.getState().objects.find((object) => object.id === "object-a")?.position.x).toBe(2);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "z", ctrlKey: true })
      );
    });
    expect(useObjectStore.getState().objects.find((object) => object.id === "object-a")?.position.x).toBe(0);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "z",
          ctrlKey: true,
          shiftKey: true,
        })
      );
    });
    expect(useObjectStore.getState().objects.find((object) => object.id === "object-a")?.position.x).toBe(2);

    await act(async () => {
      root.unmount();
    });
  });

  it("deletes the selected object", async () => {
    const { container, root } = await renderObjectEditor();

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Delete object")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useObjectStore.getState().objects).toHaveLength(0);

    await act(async () => {
      root.unmount();
    });
  });
});
