import { create } from "zustand";

import type { WorkspaceMode, WorkspacePanelId } from "@/features/workspace/types";

type WorkspacePanelsState = Record<WorkspacePanelId, boolean>;

type WorkspaceStoreState = {
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
  panels: WorkspacePanelsState;
  openPanel: (panelId: WorkspacePanelId) => void;
  closePanel: (panelId: WorkspacePanelId) => void;
  togglePanel: (panelId: WorkspacePanelId) => void;
};

const INITIAL_PANELS: WorkspacePanelsState = {
  displays: false,
  runtime_health: false,
};

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  mode: "studio",
  setMode: (mode) => set({ mode }),
  panels: INITIAL_PANELS,
  openPanel: (panelId) =>
    set((state) => ({
      panels: {
        ...state.panels,
        [panelId]: true,
      },
    })),
  closePanel: (panelId) =>
    set((state) => ({
      panels: {
        ...state.panels,
        [panelId]: false,
      },
    })),
  togglePanel: (panelId) => {
    const isOpen = get().panels[panelId];
    if (isOpen) {
      get().closePanel(panelId);
    } else {
      get().openPanel(panelId);
    }
  },
}));
