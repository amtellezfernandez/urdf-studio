import { describe, expect, it } from "vitest";
import { shouldShowPreviewReadOnlyNotice } from "@/features/viewer/previewReadOnlyNotice";
import { PREVIEW_READ_ONLY_NOTICE_PARAMS } from "@/features/viewer/previewReadOnlyNoticeParams";

const NOW_MS = 10_000;

describe("shouldShowPreviewReadOnlyNotice", () => {
  it("shows the notice when no preview notice has been shown yet", () => {
    expect(shouldShowPreviewReadOnlyNotice(null, NOW_MS)).toBe(true);
  });

  it("suppresses duplicate notices during the cooldown window", () => {
    const lastShownAtMs = NOW_MS - PREVIEW_READ_ONLY_NOTICE_PARAMS.cooldownMs + 1;
    expect(shouldShowPreviewReadOnlyNotice(lastShownAtMs, NOW_MS)).toBe(false);
  });

  it("allows the notice again after the cooldown window elapses", () => {
    const lastShownAtMs = NOW_MS - PREVIEW_READ_ONLY_NOTICE_PARAMS.cooldownMs;
    expect(shouldShowPreviewReadOnlyNotice(lastShownAtMs, NOW_MS)).toBe(true);
  });
});
