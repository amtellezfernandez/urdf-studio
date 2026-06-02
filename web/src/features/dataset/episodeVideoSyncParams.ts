export const EPISODE_VIDEO_SYNC_PARAMS = {
  statuses: {
    aligned: "aligned",
    clipAligned: "clip-aligned",
    referenceOnly: "reference-only",
  },
  reasons: {
    deleteOutside: "delete_outside",
    deleteInside: "delete_inside",
    retime: "retime",
    resampleFps: "resample_fps",
    trajectoryEdit: "trajectory_edit",
    smooth: "smooth",
    limitFix: "limit_fix",
  },
} as const;
