import { create } from "zustand";

import { DISPLAY_ORDER, createDefaultDisplays } from "@/features/displays/displayRegistry";
import {
  readBrowserStorageItem,
  writeBrowserStorageItem,
} from "@/shared/lib/browserStorage";
import { isRecord } from "@/shared/lib/records";
import type {
  DisplayInstance,
  DisplayKind,
  DisplayMetrics,
  DisplayParams,
  DisplayStatus,
} from "@/features/displays/types";
import type { ViewerProfile } from "@/features/workspace/viewerProfile";

const STORAGE_KEY = "urdfstudio:displayManager:v1";

type StoredDisplayState = Partial<Record<DisplayKind, { enabled?: boolean }>>;

type DisplayStoreState = {
  displays: Record<DisplayKind, DisplayInstance>;
  setDisplayEnabled: (kind: DisplayKind, enabled: boolean) => void;
  toggleDisplay: (kind: DisplayKind) => void;
  setDisplayStatus: (kind: DisplayKind, status: DisplayStatus) => void;
  setDisplayMetrics: (kind: DisplayKind, metrics: DisplayMetrics) => void;
  updateDisplayParams: (kind: DisplayKind, params: DisplayParams) => void;
  applyProfilePreset: (profile: ViewerProfile) => void;
  resetDisplays: () => void;
};

const PROFILE_PRESETS: Record<ViewerProfile, Record<DisplayKind, boolean>> = {
  studio: {
    robot_model: true,
    tf_frames: false,
    markers: false,
    trajectory: false,
    diagnostics_overlay: false,
  },
  ros_debug: {
    robot_model: true,
    tf_frames: true,
    markers: true,
    trajectory: true,
    diagnostics_overlay: true,
  },
};

const normalizeStoredState = (value: unknown): StoredDisplayState => {
  if (!isRecord(value)) return {};

  return DISPLAY_ORDER.reduce<StoredDisplayState>((state, kind) => {
    const storedDisplay = value[kind];
    if (!isRecord(storedDisplay) || typeof storedDisplay.enabled !== "boolean") {
      return state;
    }
    state[kind] = { enabled: storedDisplay.enabled };
    return state;
  }, {});
};

const readStoredState = (): StoredDisplayState => {
  if (typeof window === "undefined") return {};
  try {
    const raw = readBrowserStorageItem(STORAGE_KEY);
    if (!raw) return {};
    return normalizeStoredState(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
};

const writeStoredState = (displays: Record<DisplayKind, DisplayInstance>): void => {
  if (typeof window === "undefined") return;
  const payload = Object.entries(displays).reduce((acc, [kind, display]) => {
    acc[kind as DisplayKind] = { enabled: display.enabled };
    return acc;
  }, {} as StoredDisplayState);
  writeBrowserStorageItem(STORAGE_KEY, JSON.stringify(payload));
};

const createInitialDisplays = (): Record<DisplayKind, DisplayInstance> => {
  const defaults = createDefaultDisplays();
  const stored = readStoredState();
  (Object.keys(defaults) as DisplayKind[]).forEach((kind) => {
    const storedEnabled = stored[kind]?.enabled;
    if (typeof storedEnabled === "boolean") {
      defaults[kind].enabled = storedEnabled;
    }
  });
  return defaults;
};

const updateDisplay = (
  displays: Record<DisplayKind, DisplayInstance>,
  kind: DisplayKind,
  update: Partial<DisplayInstance>
): Record<DisplayKind, DisplayInstance> => ({
  ...displays,
  [kind]: {
    ...displays[kind],
    ...update,
  },
});

export const useDisplayStore = create<DisplayStoreState>((set, get) => ({
  displays: createInitialDisplays(),
  setDisplayEnabled: (kind, enabled) => {
    set((state) => {
      const nextDisplays = updateDisplay(state.displays, kind, { enabled });
      writeStoredState(nextDisplays);
      return { displays: nextDisplays };
    });
  },
  toggleDisplay: (kind) => {
    const current = get().displays[kind];
    get().setDisplayEnabled(kind, !current.enabled);
  },
  setDisplayStatus: (kind, status) => {
    set((state) => ({
      displays: updateDisplay(state.displays, kind, { status }),
    }));
  },
  setDisplayMetrics: (kind, metrics) => {
    set((state) => ({
      displays: updateDisplay(state.displays, kind, { metrics }),
    }));
  },
  updateDisplayParams: (kind, params) => {
    set((state) => ({
      displays: updateDisplay(state.displays, kind, {
        params: { ...state.displays[kind].params, ...params },
      }),
    }));
  },
  applyProfilePreset: (profile) => {
    set((state) => {
      const preset = PROFILE_PRESETS[profile];
      const nextDisplays = { ...state.displays };
      (Object.keys(nextDisplays) as DisplayKind[]).forEach((kind) => {
        nextDisplays[kind] = {
          ...nextDisplays[kind],
          enabled: preset[kind],
        };
      });
      writeStoredState(nextDisplays);
      return { displays: nextDisplays };
    });
  },
  resetDisplays: () => {
    const defaults = createDefaultDisplays();
    writeStoredState(defaults);
    set(() => ({ displays: defaults }));
  },
}));
