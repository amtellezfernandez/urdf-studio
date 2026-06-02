import { PREVIEW_READ_ONLY_NOTICE_PARAMS } from "@/features/viewer/previewReadOnlyNoticeParams";

export const shouldShowPreviewReadOnlyNotice = (
  lastShownAtMs: number | null,
  nowMs: number
): boolean =>
  lastShownAtMs == null ||
  nowMs - lastShownAtMs >= PREVIEW_READ_ONLY_NOTICE_PARAMS.cooldownMs;
