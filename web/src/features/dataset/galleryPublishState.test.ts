import { describe, expect, it } from "vitest";

import {
  EMPTY_GALLERY_PENDING_PUBLISH_STATE,
  hasGalleryPendingPublishChanges,
  mergeGalleryRepoMetadataFieldLabels,
  upsertGalleryPendingRobotRename,
  withGalleryGeneratedAssetsChange,
} from "@/features/dataset/galleryPublishState";

describe("galleryPublishState", () => {
  it("tracks generated assets as a publishable change", () => {
    const next = withGalleryGeneratedAssetsChange(EMPTY_GALLERY_PENDING_PUBLISH_STATE);
    expect(next.hasGeneratedAssets).toBe(true);
    expect(hasGalleryPendingPublishChanges(next)).toBe(true);
  });

  it("deduplicates changed repo metadata labels", () => {
    const next = mergeGalleryRepoMetadataFieldLabels(EMPTY_GALLERY_PENDING_PUBLISH_STATE, [
      "Org",
      "Summary",
      "Org",
    ]);
    expect(next.repoMetadataFieldLabels).toEqual(["Org", "Summary"]);
  });

  it("tracks robot title changes with stable original titles", () => {
    const first = upsertGalleryPendingRobotRename(EMPTY_GALLERY_PENDING_PUBLISH_STATE, {
      id: "robot.urdf",
      previousTitle: "Old",
      nextTitle: "New",
    });
    const second = upsertGalleryPendingRobotRename(first, {
      id: "robot.urdf",
      previousTitle: "New",
      nextTitle: "Newest",
    });

    expect(second.renamedRobots).toEqual([
      { id: "robot.urdf", previousTitle: "Old", nextTitle: "Newest" },
    ]);
  });

  it("removes a robot rename entry when the title returns to its original value", () => {
    const first = upsertGalleryPendingRobotRename(EMPTY_GALLERY_PENDING_PUBLISH_STATE, {
      id: "robot.urdf",
      previousTitle: "Old",
      nextTitle: "New",
    });
    const second = upsertGalleryPendingRobotRename(first, {
      id: "robot.urdf",
      previousTitle: "Old",
      nextTitle: "Old",
    });

    expect(second.renamedRobots).toEqual([]);
    expect(hasGalleryPendingPublishChanges(second)).toBe(false);
  });
});
