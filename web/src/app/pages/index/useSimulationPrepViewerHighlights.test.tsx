/** @vitest-environment jsdom */
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  cloneInertialVisualizationSettings,
  useSimulationPrepViewerHighlights,
} from "@/app/pages/index/useSimulationPrepViewerHighlights";
import type { SimulationPrepVisualizationPreview } from "@/features/layout/page/simulationPrepViewerState";
import type { InertialVisualizationSettings } from "@/shared/types/feature";

const initialSettings: InertialVisualizationSettings = {
  showGlobalCOM: true,
  showInertia: false,
  showLinkCOM: false,
  showReferenceGeometry: false,
  scopedLinkNames: ["original"],
};

type HookResult = ReturnType<typeof useSimulationPrepViewerHighlights>;

type Snapshot = {
  activeScopeKey: string | null;
  handlers: HookResult;
  hoveredPreview: SimulationPrepVisualizationPreview | null;
  loadIssuesOpen: boolean;
  panelOpen: boolean;
  resetPoseRequestKey: string;
  settings: InertialVisualizationSettings;
};

const createHarness = (snapshots: Snapshot[]) => {
  const Harness = () => {
    const [settings, setSettings] = useState<InertialVisualizationSettings>(
      () => cloneInertialVisualizationSettings(initialSettings)
    );
    const [panelOpen, setPanelOpen] = useState(false);
    const [loadIssuesOpen, setLoadIssuesOpen] = useState(true);
    const [resetPoseRequestKey, setResetPoseRequestKey] = useState("");
    const [activeScopeKey, setActiveScopeKey] = useState<string | null>("scope-a");
    const [hoveredPreview, setHoveredPreview] =
      useState<SimulationPrepVisualizationPreview | null>({
        scopeKey: "hover-a",
        scopedLinkNames: ["hovered"],
      });
    const handlers = useSimulationPrepViewerHighlights({
      panelOpen,
      setActiveInertiaVisualizationScopeKey: setActiveScopeKey,
      setHoveredInertiaVisualizationPreview: setHoveredPreview,
      setInertialVisualization: setSettings,
      setShowHealthActionPanel: setPanelOpen,
      setShowLoadIssues: setLoadIssuesOpen,
      setSimulationPrepResetPoseRequestKey: setResetPoseRequestKey,
    });

    snapshots.push({
      activeScopeKey,
      handlers,
      hoveredPreview,
      loadIssuesOpen,
      panelOpen,
      resetPoseRequestKey,
      settings,
    });
    return null;
  };

  return Harness;
};

describe("useSimulationPrepViewerHighlights", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("clones scoped link names instead of sharing the input array", () => {
    const cloned = cloneInertialVisualizationSettings(initialSettings);

    expect(cloned).toEqual(initialSettings);
    expect(cloned.scopedLinkNames).not.toBe(initialSettings.scopedLinkNames);
  });

  it("opens the panel with viewer highlights and resets transient preview state", async () => {
    const snapshots: Snapshot[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(createHarness(snapshots)));
    });
    await act(async () => {
      snapshots.at(-1)!.handlers.openSimulationPrepPanel();
    });

    const latest = snapshots.at(-1)!;
    expect(latest.panelOpen).toBe(true);
    expect(latest.loadIssuesOpen).toBe(false);
    expect(latest.activeScopeKey).toBeNull();
    expect(latest.hoveredPreview).toBeNull();
    expect(latest.resetPoseRequestKey).not.toBe("");
    expect(latest.settings.showInertia).toBe(true);
    expect(latest.settings.showReferenceGeometry).toBe(true);
    expect(latest.settings.scopedLinkNames).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("restores the previous viewer settings when highlights are closed", async () => {
    const snapshots: Snapshot[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(createHarness(snapshots)));
    });
    await act(async () => {
      snapshots.at(-1)!.handlers.enableSimulationPrepViewerHighlights(["link_b", "link_a"]);
    });
    expect(snapshots.at(-1)!.settings.scopedLinkNames).toEqual(["link_a", "link_b"]);

    await act(async () => {
      snapshots.at(-1)!.handlers.closeSimulationPrepPanel();
    });

    const latest = snapshots.at(-1)!;
    expect(latest.panelOpen).toBe(false);
    expect(latest.settings).toEqual({
      ...initialSettings,
      scopedLinkNames: null,
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("can discard the saved snapshot before an external reset", async () => {
    const snapshots: Snapshot[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(createHarness(snapshots)));
    });
    await act(async () => {
      snapshots.at(-1)!.handlers.enableSimulationPrepViewerHighlights(["link_a"]);
    });
    await act(async () => {
      snapshots.at(-1)!.handlers.discardSimulationPrepViewerHighlightSnapshot();
      snapshots.at(-1)!.handlers.closeSimulationPrepPanel();
    });

    const latest = snapshots.at(-1)!;
    expect(latest.settings.showInertia).toBe(true);
    expect(latest.settings.showReferenceGeometry).toBe(true);
    expect(latest.settings.scopedLinkNames).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
