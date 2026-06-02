import { describe, expect, it } from "vitest";

import type { IluGalleryEntry } from "@/features/dataset/iluGalleryApi";
import { resolveGalleryEntryGenerateAction, resolveGalleryEntryMediaState } from "@/features/dataset/galleryEntryMedia";

const BASE_ENTRY: IluGalleryEntry = {
  id: "robot-1",
  owner: "acme",
  repo: "bot-repo",
  path: "robots",
  branch: "main",
  urdfPath: "robots/robot.urdf",
  sourceFile: "robot.urdf",
  title: "Robot",
  summary: null,
  thumbnailUrl: "https://example.com/thumb.png",
  previewUrl: null,
  videoUrl: "https://example.com/preview.mp4",
  galleryRepoKey: null,
  galleryFileBase: null,
  robotTraits: null,
  tags: [],
};

describe("galleryEntryMedia", () => {
  it("recognizes missing image assets", () => {
    const mediaState = resolveGalleryEntryMediaState({
      ...BASE_ENTRY,
      thumbnailUrl: null,
    });

    expect(mediaState).toMatchObject({
      hasImageAsset: false,
      hasMotionAsset: true,
    });
  });

  it("returns generate with only the missing image kind", () => {
    expect(
      resolveGalleryEntryGenerateAction({
        ...BASE_ENTRY,
        thumbnailUrl: null,
      })
    ).toEqual({
      assetKinds: ["image"],
      label: "Generate",
    });
  });

  it("returns generate with only the missing motion kind when no video or preview exists", () => {
    expect(
      resolveGalleryEntryGenerateAction({
        ...BASE_ENTRY,
        videoUrl: null,
        previewUrl: null,
      })
    ).toEqual({
      assetKinds: ["video"],
      label: "Generate",
    });
  });

  it("returns regenerate with both asset kinds when the card already has image and motion assets", () => {
    expect(resolveGalleryEntryGenerateAction(BASE_ENTRY)).toEqual({
      assetKinds: ["image", "video"],
      label: "Regenerate",
    });
  });
});
