import { resolveEpisodeJointNames, type Episode } from "@/features/dataset";
import {
  EMPTY_EPISODE_EDITOR_HISTORY_INDEX,
  EPISODE_EDITOR_INITIAL_HISTORY_INDEX,
} from "@/features/dataset/episode-editor/episodeEditorParams";
import { cloneRobotBasePose } from "@/shared/lib/robotBasePose";

export type EpisodeEditorDraftState = {
  selectedJoints: Set<string>;
  modifiedEpisode: Episode | null;
  editHistory: Episode[];
  historyIndex: number;
};

export const cloneEpisodeForEditing = (source: Episode): Episode => ({
  ...source,
  frames: source.frames.map((frame) => ({
    ...frame,
    jointPositions: { ...frame.jointPositions },
    basePose: cloneRobotBasePose(frame.basePose),
  })),
});

export const createEmptyEpisodeEditorDraftState = (): EpisodeEditorDraftState => ({
  selectedJoints: new Set(),
  modifiedEpisode: null,
  editHistory: [],
  historyIndex: EMPTY_EPISODE_EDITOR_HISTORY_INDEX,
});

export const createEpisodeEditorDraftState = (
  episode: Episode
): EpisodeEditorDraftState => {
  const initialEpisode = cloneEpisodeForEditing(episode);
  return {
    selectedJoints: new Set(resolveEpisodeJointNames(episode)),
    modifiedEpisode: initialEpisode,
    editHistory: [initialEpisode],
    historyIndex: EPISODE_EDITOR_INITIAL_HISTORY_INDEX,
  };
};
