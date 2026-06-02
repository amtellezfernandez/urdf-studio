import { create } from "zustand";
import type { IkdApproachTaskEvent, IkdApproachTaskSnapshot } from "@/features/viewer/ikdApproachTaskTypes";

export type IkdApproachTaskConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error";

export type IkdApproachTaskStoreSnapshot = {
  connectionStatus: IkdApproachTaskConnectionStatus;
  lastError: string | null;
  sceneRevision: number | null;
  lastEventKind: IkdApproachTaskEvent["event_kind"] | null;
  activeTask: IkdApproachTaskSnapshot | null;
};

type IkdApproachTaskStore = IkdApproachTaskStoreSnapshot & {
  setConnectionStatus: (
    status: IkdApproachTaskConnectionStatus,
    error?: string | null
  ) => void;
  applyEvent: (event: IkdApproachTaskEvent) => void;
  reset: () => void;
};

const INITIAL_STATE: IkdApproachTaskStoreSnapshot = {
  connectionStatus: "idle",
  lastError: null,
  sceneRevision: null,
  lastEventKind: null,
  activeTask: null,
};

export const reduceIkdApproachTaskEvent = (
  state: IkdApproachTaskStoreSnapshot,
  event: IkdApproachTaskEvent
): IkdApproachTaskStoreSnapshot => {
  const hasTaskField = Object.prototype.hasOwnProperty.call(event, "task");
  return {
    ...state,
    sceneRevision:
      typeof event.scene_revision === "number" ? event.scene_revision : state.sceneRevision,
    lastEventKind: event.event_kind,
    activeTask: hasTaskField ? event.task ?? null : state.activeTask,
  };
};

export const useIkdApproachTaskStore = create<IkdApproachTaskStore>((set) => ({
  ...INITIAL_STATE,
  setConnectionStatus: (connectionStatus, error = null) =>
    set(() => ({
      connectionStatus,
      lastError: error,
    })),
  applyEvent: (event) =>
    set((state) => reduceIkdApproachTaskEvent(state, event)),
  reset: () => set(() => INITIAL_STATE),
}));
