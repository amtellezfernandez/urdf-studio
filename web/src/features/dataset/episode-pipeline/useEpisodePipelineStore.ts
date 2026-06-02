import { create } from "zustand";
import {
  resolveEpisodeStateTransition,
} from "@/features/dataset/episode-pipeline/episodePipelineController";
import type {
  EpisodeMaterializationState,
  EpisodePipelineProgress,
  EpisodePipelineStage,
} from "@/features/dataset/episode-pipeline/types";

type EpisodePipelineStore = {
  stage: EpisodePipelineStage;
  stageMessage?: string;
  progress: EpisodePipelineProgress;
  episodeStates: Record<string, EpisodeMaterializationState>;
  loadingEpisodeIds: string[];
  setStage: (stage: EpisodePipelineStage, stageMessage?: string) => void;
  setProgress: (patch: Partial<EpisodePipelineProgress>) => void;
  resetProgress: () => void;
  setEpisodeState: (episodeId: string, state: Omit<EpisodeMaterializationState, "updatedAt">) => void;
  beginEpisodeLoad: (episodeId: string, message?: string) => boolean;
  finishEpisodeLoad: (
    episodeId: string,
    state: Omit<EpisodeMaterializationState, "updatedAt" | "status"> & {
      status: EpisodeMaterializationState["status"];
    }
  ) => void;
  syncEpisodeReadiness: (episodes: Array<{ id: string; hasFrames: boolean; isLazy: boolean }>) => void;
  clearMissingEpisodes: (activeEpisodeIds: string[]) => void;
  resetAll: () => void;
};

const defaultProgress = (): EpisodePipelineProgress => ({
  partitionLabel: null,
  currentOffset: 0,
  loadedEpisodes: 0,
  deferredRetryCount: 0,
});

const normalizeRetryAfterMs = (value: number | undefined): number | undefined =>
  Number.isFinite(value) && Number(value) > 0 ? Number(value) : undefined;

const statesEquivalent = (
  current: EpisodeMaterializationState | undefined,
  next: Omit<EpisodeMaterializationState, "updatedAt">
): boolean =>
  Boolean(current) &&
  current.status === next.status &&
  (current.message ?? undefined) === (next.message ?? undefined) &&
  normalizeRetryAfterMs(current.retryAfterMs) === normalizeRetryAfterMs(next.retryAfterMs);

const ensureLoadingMembership = (
  loadingEpisodeIds: string[],
  episodeId: string,
  shouldBeLoading: boolean
): string[] => {
  const exists = loadingEpisodeIds.includes(episodeId);
  if (shouldBeLoading) {
    return exists ? loadingEpisodeIds : [...loadingEpisodeIds, episodeId];
  }
  return exists ? loadingEpisodeIds.filter((id) => id !== episodeId) : loadingEpisodeIds;
};

const listEquals = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export const useEpisodePipelineStore = create<EpisodePipelineStore>((set, get) => ({
  stage: "idle",
  stageMessage: undefined,
  progress: defaultProgress(),
  episodeStates: {},
  loadingEpisodeIds: [],

  setStage: (stage, stageMessage) => {
    set({ stage, stageMessage });
  },

  setProgress: (patch) => {
    set((state) => ({
      progress: {
        ...state.progress,
        ...patch,
      },
    }));
  },

  resetProgress: () => {
    set({ progress: defaultProgress() });
  },

  setEpisodeState: (episodeId, state) => {
    set((current) => {
      const previousState = current.episodeStates[episodeId];
      const resolvedStatus = resolveEpisodeStateTransition(
        previousState?.status,
        state.status,
        episodeId
      );

      const transitionRejected =
        Boolean(previousState) &&
        resolvedStatus === previousState.status &&
        state.status !== resolvedStatus;
      if (transitionRejected) {
        return current;
      }

      const nextState: Omit<EpisodeMaterializationState, "updatedAt"> = {
        status: resolvedStatus,
        message: state.message,
        retryAfterMs: normalizeRetryAfterMs(state.retryAfterMs),
      };

      const nextLoadingIds = ensureLoadingMembership(
        current.loadingEpisodeIds,
        episodeId,
        resolvedStatus === "loading"
      );

      if (statesEquivalent(previousState, nextState) && listEquals(nextLoadingIds, current.loadingEpisodeIds)) {
        return current;
      }

      return {
        episodeStates: {
          ...current.episodeStates,
          [episodeId]: {
            ...nextState,
            updatedAt: Date.now(),
          },
        },
        loadingEpisodeIds: nextLoadingIds,
      };
    });
  },

  beginEpisodeLoad: (episodeId, message) => {
    const current = get();
    if (current.loadingEpisodeIds.includes(episodeId)) {
      return false;
    }
    current.setEpisodeState(episodeId, {
      status: "loading",
      message,
    });
    return true;
  },

  finishEpisodeLoad: (episodeId, state) => {
    get().setEpisodeState(episodeId, state);
  },

  syncEpisodeReadiness: (episodes) => {
    set((state) => {
      const nextStates = { ...state.episodeStates };
      const now = Date.now();
      let statesChanged = false;

      for (const episode of episodes) {
        const existing = nextStates[episode.id];
        if (episode.hasFrames) {
          const resolvedStatus = resolveEpisodeStateTransition(
            existing?.status,
            "ready",
            episode.id
          );
          const nextState: Omit<EpisodeMaterializationState, "updatedAt"> = {
            status: resolvedStatus,
            message: undefined,
            retryAfterMs: undefined,
          };
          if (!statesEquivalent(existing, nextState)) {
            nextStates[episode.id] = {
              ...nextState,
              updatedAt: now,
            };
            statesChanged = true;
          }
          continue;
        }

        if (episode.isLazy && (!existing || existing.status === "ready")) {
          const resolvedStatus = resolveEpisodeStateTransition(
            existing?.status,
            "indexed",
            episode.id
          );
          const nextState: Omit<EpisodeMaterializationState, "updatedAt"> = {
            status: resolvedStatus,
            message: undefined,
            retryAfterMs: undefined,
          };
          if (!statesEquivalent(existing, nextState)) {
            nextStates[episode.id] = {
              ...nextState,
              updatedAt: now,
            };
            statesChanged = true;
          }
        }
      }

      const nextLoadingIds = state.loadingEpisodeIds.filter(
        (episodeId) => nextStates[episodeId]?.status === "loading"
      );
      const loadingChanged = !listEquals(nextLoadingIds, state.loadingEpisodeIds);

      if (!statesChanged && !loadingChanged) {
        return state;
      }

      return {
        episodeStates: nextStates,
        loadingEpisodeIds: nextLoadingIds,
      };
    });
  },

  clearMissingEpisodes: (activeEpisodeIds) => {
    const activeSet = new Set(activeEpisodeIds);
    set((state) => {
      const nextStates: Record<string, EpisodeMaterializationState> = {};
      for (const [episodeId, episodeState] of Object.entries(state.episodeStates)) {
        if (activeSet.has(episodeId)) {
          nextStates[episodeId] = episodeState;
        }
      }
      return {
        episodeStates: nextStates,
        loadingEpisodeIds: state.loadingEpisodeIds.filter((id) => activeSet.has(id)),
      };
    });
  },

  resetAll: () => {
    set({
      stage: "idle",
      stageMessage: undefined,
      progress: defaultProgress(),
      episodeStates: {},
      loadingEpisodeIds: [],
    });
  },
}));
