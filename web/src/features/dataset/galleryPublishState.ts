export type GalleryPendingPublishTitleChange = {
  id: string;
  previousTitle: string;
  nextTitle: string;
};

export type GalleryPendingPublishState = {
  hasGeneratedAssets: boolean;
  repoMetadataFieldLabels: string[];
  renamedRobots: GalleryPendingPublishTitleChange[];
};

export const EMPTY_GALLERY_PENDING_PUBLISH_STATE: GalleryPendingPublishState = {
  hasGeneratedAssets: false,
  repoMetadataFieldLabels: [],
  renamedRobots: [],
};

export const hasGalleryPendingPublishChanges = (state: GalleryPendingPublishState): boolean =>
  state.hasGeneratedAssets || state.repoMetadataFieldLabels.length > 0 || state.renamedRobots.length > 0;

export const withGalleryGeneratedAssetsChange = (
  state: GalleryPendingPublishState
): GalleryPendingPublishState => ({
  ...state,
  hasGeneratedAssets: true,
});

export const mergeGalleryRepoMetadataFieldLabels = (
  state: GalleryPendingPublishState,
  labels: string[]
): GalleryPendingPublishState => {
  const merged = [...state.repoMetadataFieldLabels];
  for (const label of labels) {
    if (!merged.includes(label)) {
      merged.push(label);
    }
  }
  return {
    ...state,
    repoMetadataFieldLabels: merged,
  };
};

export const upsertGalleryPendingRobotRename = (
  state: GalleryPendingPublishState,
  change: GalleryPendingPublishTitleChange
): GalleryPendingPublishState => {
  if (change.previousTitle === change.nextTitle) {
    return {
      ...state,
      renamedRobots: state.renamedRobots.filter((entry) => entry.id !== change.id),
    };
  }

  const existing = state.renamedRobots.find((entry) => entry.id === change.id);
  const nextChange: GalleryPendingPublishTitleChange = existing
    ? { ...existing, nextTitle: change.nextTitle }
    : change;

  return {
    ...state,
    renamedRobots: [
      ...state.renamedRobots.filter((entry) => entry.id !== change.id),
      nextChange,
    ],
  };
};
