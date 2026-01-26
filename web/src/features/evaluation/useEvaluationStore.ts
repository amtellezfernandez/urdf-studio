/**
 * Zustand store for evaluation visualization state management.
 */

import { create } from "zustand";
import type {
  EvaluationResult,
  EvaluationEpisode,
  EvaluationStep,
  PlaybackState,
} from "./types";
import { DEFAULT_PLAYBACK_STATE } from "./types";

// ============================================================================
// Types
// ============================================================================

interface EvaluationState {
  // Evaluation result
  result: EvaluationResult | null;
  isLoading: boolean;
  error: string | null;

  // Playback state
  playback: PlaybackState;
  playbackIntervalId: number | null;

  // Selected data
  selectedEpisodeIndex: number;
  selectedStepIndex: number;

  // UI state
  showOverlay: boolean;
  comparisonMode: boolean;
  comparisonEpisodeIndex: number | null;

  // Actions
  setResult: (result: EvaluationResult | null) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Playback controls
  play: () => void;
  pause: () => void;
  stop: () => void;
  setPlaybackSpeed: (speed: number) => void;
  setLoopMode: (mode: PlaybackState["loopMode"]) => void;
  stepForward: () => void;
  stepBackward: () => void;
  seekToStep: (stepIndex: number) => void;
  seekToEpisode: (episodeIndex: number) => void;

  // Internal playback
  tick: () => void;
  setPlaybackIntervalId: (id: number | null) => void;

  // Selection
  selectEpisode: (index: number) => void;
  selectStep: (index: number) => void;

  // UI
  setShowOverlay: (show: boolean) => void;
  setComparisonMode: (enabled: boolean) => void;
  setComparisonEpisodeIndex: (index: number | null) => void;

  // Reset
  reset: () => void;
}

// ============================================================================
// Store
// ============================================================================

export const useEvaluationStore = create<EvaluationState>((set, get) => ({
  // Initial state
  result: null,
  isLoading: false,
  error: null,

  playback: { ...DEFAULT_PLAYBACK_STATE },
  playbackIntervalId: null,

  selectedEpisodeIndex: 0,
  selectedStepIndex: 0,

  showOverlay: true,
  comparisonMode: false,
  comparisonEpisodeIndex: null,

  // Actions
  setResult: (result) => set({
    result,
    selectedEpisodeIndex: 0,
    selectedStepIndex: 0,
    playback: { ...DEFAULT_PLAYBACK_STATE },
  }),

  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  // Playback controls
  play: () => {
    const { playback, playbackIntervalId, tick } = get();
    if (playback.isPlaying || playbackIntervalId) return;

    const intervalMs = Math.floor(100 / playback.playbackSpeed);
    const id = window.setInterval(tick, intervalMs);

    set({
      playback: { ...playback, isPlaying: true },
      playbackIntervalId: id,
    });
  },

  pause: () => {
    const { playbackIntervalId } = get();
    if (playbackIntervalId) {
      clearInterval(playbackIntervalId);
    }

    set((state) => ({
      playback: { ...state.playback, isPlaying: false },
      playbackIntervalId: null,
    }));
  },

  stop: () => {
    const { playbackIntervalId } = get();
    if (playbackIntervalId) {
      clearInterval(playbackIntervalId);
    }

    set((state) => ({
      playback: {
        ...state.playback,
        isPlaying: false,
        currentStepIndex: 0,
      },
      playbackIntervalId: null,
      selectedStepIndex: 0,
    }));
  },

  setPlaybackSpeed: (speed) => {
    const { playback, playbackIntervalId, tick } = get();

    // Update interval if playing
    if (playbackIntervalId) {
      clearInterval(playbackIntervalId);
      const intervalMs = Math.floor(100 / speed);
      const id = window.setInterval(tick, intervalMs);

      set({
        playback: { ...playback, playbackSpeed: speed },
        playbackIntervalId: id,
      });
    } else {
      set({
        playback: { ...playback, playbackSpeed: speed },
      });
    }
  },

  setLoopMode: (loopMode) => set((state) => ({
    playback: { ...state.playback, loopMode },
  })),

  stepForward: () => {
    const { result, selectedEpisodeIndex, selectedStepIndex, playback } = get();
    if (!result) return;

    const episode = result.episodes[selectedEpisodeIndex];
    if (!episode) return;

    if (selectedStepIndex < episode.steps.length - 1) {
      const newIndex = selectedStepIndex + 1;
      set({
        selectedStepIndex: newIndex,
        playback: { ...playback, currentStepIndex: newIndex },
      });
    }
  },

  stepBackward: () => {
    const { selectedStepIndex, playback } = get();

    if (selectedStepIndex > 0) {
      const newIndex = selectedStepIndex - 1;
      set({
        selectedStepIndex: newIndex,
        playback: { ...playback, currentStepIndex: newIndex },
      });
    }
  },

  seekToStep: (stepIndex) => set((state) => ({
    selectedStepIndex: stepIndex,
    playback: { ...state.playback, currentStepIndex: stepIndex },
  })),

  seekToEpisode: (episodeIndex) => set((state) => ({
    selectedEpisodeIndex: episodeIndex,
    selectedStepIndex: 0,
    playback: {
      ...state.playback,
      currentEpisodeIndex: episodeIndex,
      currentStepIndex: 0,
    },
  })),

  tick: () => {
    const { result, selectedEpisodeIndex, selectedStepIndex, playback } = get();
    if (!result) return;

    const episode = result.episodes[selectedEpisodeIndex];
    if (!episode) return;

    // Check if at end of episode
    if (selectedStepIndex >= episode.steps.length - 1) {
      // Handle loop modes
      if (playback.loopMode === "episode") {
        set({
          selectedStepIndex: 0,
          playback: { ...playback, currentStepIndex: 0 },
        });
      } else if (playback.loopMode === "all") {
        // Move to next episode or loop back
        const nextEpisode = (selectedEpisodeIndex + 1) % result.episodes.length;
        set({
          selectedEpisodeIndex: nextEpisode,
          selectedStepIndex: 0,
          playback: {
            ...playback,
            currentEpisodeIndex: nextEpisode,
            currentStepIndex: 0,
          },
        });
      } else {
        // Stop at end
        get().pause();
      }
    } else {
      // Move to next step
      const newIndex = selectedStepIndex + 1;
      set({
        selectedStepIndex: newIndex,
        playback: { ...playback, currentStepIndex: newIndex },
      });
    }
  },

  setPlaybackIntervalId: (playbackIntervalId) => set({ playbackIntervalId }),

  // Selection
  selectEpisode: (index) => {
    get().pause();
    set({
      selectedEpisodeIndex: index,
      selectedStepIndex: 0,
      playback: { ...get().playback, currentEpisodeIndex: index, currentStepIndex: 0 },
    });
  },

  selectStep: (index) => set((state) => ({
    selectedStepIndex: index,
    playback: { ...state.playback, currentStepIndex: index },
  })),

  // UI
  setShowOverlay: (showOverlay) => set({ showOverlay }),
  setComparisonMode: (comparisonMode) => set({ comparisonMode }),
  setComparisonEpisodeIndex: (comparisonEpisodeIndex) => set({ comparisonEpisodeIndex }),

  // Reset
  reset: () => {
    const { playbackIntervalId } = get();
    if (playbackIntervalId) {
      clearInterval(playbackIntervalId);
    }

    set({
      result: null,
      isLoading: false,
      error: null,
      playback: { ...DEFAULT_PLAYBACK_STATE },
      playbackIntervalId: null,
      selectedEpisodeIndex: 0,
      selectedStepIndex: 0,
      showOverlay: true,
      comparisonMode: false,
      comparisonEpisodeIndex: null,
    });
  },
}));

// ============================================================================
// Selectors
// ============================================================================

export const selectCurrentEpisode = (state: EvaluationState): EvaluationEpisode | null => {
  if (!state.result) return null;
  return state.result.episodes[state.selectedEpisodeIndex] || null;
};

export const selectCurrentStep = (state: EvaluationState): EvaluationStep | null => {
  const episode = selectCurrentEpisode(state);
  if (!episode) return null;
  return episode.steps[state.selectedStepIndex] || null;
};

export const selectEpisodeCount = (state: EvaluationState): number => {
  return state.result?.episodes.length || 0;
};

export const selectStepCount = (state: EvaluationState): number => {
  const episode = selectCurrentEpisode(state);
  return episode?.steps.length || 0;
};

export const selectProgress = (state: EvaluationState): number => {
  const episode = selectCurrentEpisode(state);
  if (!episode || episode.steps.length === 0) return 0;
  return (state.selectedStepIndex / (episode.steps.length - 1)) * 100;
};
