export const GALLERY_JOB_POLL_INTERVAL_MS = 1500;
export const GALLERY_GENERATE_ASSET_KINDS = ["image", "video"] as const;
export const GALLERY_PROGRESS_STARTED_PERCENT = 1;
export const GALLERY_PROGRESS_COMPLETE_PERCENT = 100;
export const GALLERY_LOADING_PROGRESS_TICK_MS = 1000;
export const GALLERY_LOADING_PLACEHOLDER_CARD_COUNT = 4;
export const GALLERY_LOADING_SLOW_NOTICE_SECONDS = 15;
export const STUDIO_CANDIDATE_GALLERY_PREVIEW_EAGER_IMAGE_LIMIT = 6;
export const GALLERY_EDITOR_ENTRY_QUERY_PARAM = "entry";
export const GALLERY_EDITOR_ENTRY_QUERY_VALUE = "gallery";
export const GALLERY_EDITOR_SOURCE_QUERY_PARAM = "gallerySource";
export const GALLERY_EDITOR_AUTOSTART_QUERY_PARAM = "galleryAutostart";
export const GALLERY_EDITOR_AUTOSTART_QUERY_VALUE = "1";
const GALLERY_MISSING_TARGET_ERROR = "Unable to find the requested URDF target in the GitHub repository.";

type GallerySourceLike = {
  owner: string;
  repo: string;
  path?: string | null;
};

export const isGalleryJobActive = (status: "queued" | "running" | "completed" | "failed"): boolean =>
  status === "queued" || status === "running";

export const sanitizeGalleryErrorMessage = (
  message: string,
  source?: GallerySourceLike | null
): string => {
  const trimmed = message.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (!trimmed.includes(GALLERY_MISSING_TARGET_ERROR)) {
    return trimmed;
  }
  const repoLabel = source
    ? `https://github.com/${source.owner}/${source.repo}${source.path ? `/${source.path.replace(/^\/+/, "")}` : ""}`
    : "the selected GitHub source";
  return (
    `The live GitHub source ${repoLabel} does not expose a loadable URDF/Xacro target for gallery rendering. ` +
    "This source may only contain MuJoCo MJCF/XML assets or other non-URDF files."
  );
};

export const resolveGalleryStatusLabel = (
  status: "queued" | "running" | "completed" | "failed",
  phase: "inspect" | "generate"
): string => {
  if (status === "failed") {
    return phase === "generate" ? "Generation failed." : "Gallery scan failed.";
  }
  if (status === "completed") {
    return phase === "generate" ? "Image and video generation completed." : "Gallery scan completed.";
  }
  if (status === "running") {
    return phase === "generate" ? "Generating image and video assets..." : "Scanning repository robots...";
  }
  return phase === "generate" ? "Queued for image and video generation..." : "Queued for gallery scan...";
};
