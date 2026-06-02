export type EpisodePreviewMode = "all" | "focus" | "list";
export type ExtendedEpisodePreviewMode = EpisodePreviewMode | "recorded";

export const EPISODE_PREVIEW_PANEL_PARAMS = {
  layout: {
    defaultEpisodeViewHeightRatio: 0.4,
    panelPercentMultiplier: 100,
    resizeEpsilonPx: 0.5,
  },
  allCameraGrid: {
    fallbackAspect: {
      width: 16,
      height: 9,
    },
    viewportMinPx: 1,
    horizontalAspectThreshold: 1,
    singleCameraCount: 1,
    dualCameraCount: 2,
    compactCameraCount: 3,
    mediumCameraCount: 4,
    denseCameraCount: 8,
    compactMaxColumns: 2,
    mediumMaxColumns: 3,
    denseMaxColumns: 4,
    score: {
      emptySlotPenalty: 0.2,
      deepStackRowThreshold: 3,
      deepStackPenalty: 0.12,
      crowdedColumnThreshold: 3,
      crowdedPenalty: 0.08,
      horizontalStackBonus: 0.1,
      verticalPairGridBonus: 0.05,
    },
  },
  recordedVideo: {
    cameraKey: {
      observationImagesPrefix: "observation.images.",
    },
    visibleLimits: {
      liveCameraCount: 10,
      recordedCameraCount: 24,
      playableStreamCount: 12,
    },
    sync: {
      seekToleranceSec: {
        idle: 0.02,
        playing: 0.08,
      },
      endPauseMarginSec: 0.02,
      durationEndMarginSec: 0.016,
    },
    layout: {
      previewMaxHeightPx: 180,
    },
  },
} as const;

export const shouldShowOperatorLiveCameraInEpisodePreviewMode = (
  previewMode: ExtendedEpisodePreviewMode
): boolean =>
  previewMode === "recorded";
