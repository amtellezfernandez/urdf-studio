export type EpisodeViewerEditSessionLifecycleAction =
  | "clear"
  | "reset"
  | "preserve"
  | "refresh";

type ResolveEpisodeViewerEditSessionLifecycleActionInput = {
  previousEpisodeId: string | null;
  nextEpisodeId: string | null;
  isEditMode: boolean;
};

export const resolveEpisodeViewerEditSessionLifecycleAction = ({
  previousEpisodeId,
  nextEpisodeId,
  isEditMode,
}: ResolveEpisodeViewerEditSessionLifecycleActionInput): EpisodeViewerEditSessionLifecycleAction => {
  if (!nextEpisodeId) {
    return "clear";
  }
  if (previousEpisodeId !== nextEpisodeId) {
    return "reset";
  }
  if (isEditMode) {
    return "preserve";
  }
  return "refresh";
};
