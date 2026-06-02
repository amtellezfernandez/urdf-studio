import { useCallback, useMemo, useRef, useState } from "react";

import type { Episode } from "@/features/dataset";
import {
  appendEpisodeEditorHistory,
  createEpisodeEditorHistoryState,
  resolveEpisodeEditorRedo,
  resolveEpisodeEditorUndo,
  type EpisodeEditorHistoryNavigation,
  type EpisodeEditorHistoryState,
} from "@/features/dataset/episode-editor/episodeEditorHistory";
import {
  EMPTY_EPISODE_EDITOR_HISTORY_INDEX,
  EPISODE_EDITOR_INITIAL_HISTORY_INDEX,
} from "@/features/dataset/episode-editor/episodeEditorParams";

const EMPTY_EPISODE_EDITOR_HISTORY_STATE: EpisodeEditorHistoryState = {
  editHistory: [],
  historyIndex: EMPTY_EPISODE_EDITOR_HISTORY_INDEX,
};

const toStoredHistoryState = ({
  editHistory,
  historyIndex,
}: EpisodeEditorHistoryState): EpisodeEditorHistoryState => ({
  editHistory,
  historyIndex,
});

export const useEpisodeEditorHistoryState = () => {
  const [historyState, setHistoryState] = useState<EpisodeEditorHistoryState>(
    EMPTY_EPISODE_EDITOR_HISTORY_STATE
  );
  const historyStateRef = useRef<EpisodeEditorHistoryState>(
    EMPTY_EPISODE_EDITOR_HISTORY_STATE
  );

  const commitHistoryState = useCallback((nextState: EpisodeEditorHistoryState) => {
    const storedState = toStoredHistoryState(nextState);
    historyStateRef.current = storedState;
    setHistoryState(storedState);
    return storedState;
  }, []);

  const replaceHistoryState = useCallback(
    (nextState: EpisodeEditorHistoryState) => {
      commitHistoryState(nextState);
    },
    [commitHistoryState]
  );

  const initializeHistory = useCallback(
    (episode: Episode) => {
      const nextState = createEpisodeEditorHistoryState(episode);
      commitHistoryState(nextState);
      return nextState;
    },
    [commitHistoryState]
  );

  const appendHistory = useCallback(
    (nextEpisode: Episode) => {
      const nextState = appendEpisodeEditorHistory({
        ...historyStateRef.current,
        nextEpisode,
      });
      commitHistoryState(nextState);
      return nextState;
    },
    [commitHistoryState]
  );

  const undoHistory = useCallback((): EpisodeEditorHistoryNavigation | null => {
    const nextState = resolveEpisodeEditorUndo(historyStateRef.current);
    if (!nextState) {
      return null;
    }
    commitHistoryState(nextState);
    return nextState;
  }, [commitHistoryState]);

  const redoHistory = useCallback((): EpisodeEditorHistoryNavigation | null => {
    const nextState = resolveEpisodeEditorRedo(historyStateRef.current);
    if (!nextState) {
      return null;
    }
    commitHistoryState(nextState);
    return nextState;
  }, [commitHistoryState]);

  const canUndo = historyState.historyIndex > EPISODE_EDITOR_INITIAL_HISTORY_INDEX;
  const canRedo =
    historyState.historyIndex >= EPISODE_EDITOR_INITIAL_HISTORY_INDEX &&
    historyState.historyIndex < historyState.editHistory.length - 1;

  return useMemo(
    () => ({
      editHistory: historyState.editHistory,
      historyIndex: historyState.historyIndex,
      canUndo,
      canRedo,
      replaceHistoryState,
      initializeHistory,
      appendHistory,
      undoHistory,
      redoHistory,
    }),
    [
      appendHistory,
      canRedo,
      canUndo,
      historyState.editHistory,
      historyState.historyIndex,
      initializeHistory,
      redoHistory,
      replaceHistoryState,
      undoHistory,
    ]
  );
};
