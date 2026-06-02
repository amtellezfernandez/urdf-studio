import type { Episode } from "@/features/dataset";
import {
  EPISODE_EDITOR_HISTORY_LIMIT,
  EPISODE_EDITOR_INITIAL_HISTORY_INDEX,
} from "@/features/dataset/episode-editor/episodeEditorParams";

export type EpisodeEditorHistoryState = {
  editHistory: Episode[];
  historyIndex: number;
};

export type EpisodeEditorHistoryNavigation = EpisodeEditorHistoryState & {
  activeEpisode: Episode;
};

type AppendEpisodeEditorHistoryInput = EpisodeEditorHistoryState & {
  nextEpisode: Episode;
  historyLimit?: number;
};

export const createEpisodeEditorHistoryState = (
  episode: Episode
): EpisodeEditorHistoryState => ({
  editHistory: [episode],
  historyIndex: EPISODE_EDITOR_INITIAL_HISTORY_INDEX,
});

export const appendEpisodeEditorHistory = ({
  editHistory,
  historyIndex,
  nextEpisode,
  historyLimit = EPISODE_EDITOR_HISTORY_LIMIT,
}: AppendEpisodeEditorHistoryInput): EpisodeEditorHistoryState => {
  const retainedHistory = editHistory.slice(
    EPISODE_EDITOR_INITIAL_HISTORY_INDEX,
    historyIndex + 1
  );
  const expandedHistory = [...retainedHistory, nextEpisode];
  const normalizedHistoryLimit = Math.max(1, Math.trunc(historyLimit));
  const overflowCount = Math.max(0, expandedHistory.length - normalizedHistoryLimit);
  const nextHistory = expandedHistory.slice(overflowCount);
  return {
    editHistory: nextHistory,
    historyIndex: Math.max(
      EPISODE_EDITOR_INITIAL_HISTORY_INDEX,
      expandedHistory.length - overflowCount - 1
    ),
  };
};

export const resolveEpisodeEditorUndo = ({
  editHistory,
  historyIndex,
}: EpisodeEditorHistoryState): EpisodeEditorHistoryNavigation | null => {
  if (historyIndex <= EPISODE_EDITOR_INITIAL_HISTORY_INDEX || editHistory.length === 0) {
    return null;
  }
  const nextIndex = historyIndex - 1;
  const activeEpisode = editHistory[nextIndex];
  if (!activeEpisode) {
    return null;
  }
  return {
    editHistory,
    historyIndex: nextIndex,
    activeEpisode,
  };
};

export const resolveEpisodeEditorRedo = ({
  editHistory,
  historyIndex,
}: EpisodeEditorHistoryState): EpisodeEditorHistoryNavigation | null => {
  if (historyIndex >= editHistory.length - 1) {
    return null;
  }
  const nextIndex = historyIndex + 1;
  const activeEpisode = editHistory[nextIndex];
  if (!activeEpisode) {
    return null;
  }
  return {
    editHistory,
    historyIndex: nextIndex,
    activeEpisode,
  };
};
