import type { IluGalleryEntry, IluGalleryGenerateAssetKind } from "@/features/dataset/iluGalleryApi";
import { GALLERY_GENERATE_ASSET_KINDS } from "@/features/dataset/iluGalleryParams";

export type GalleryEntryMediaState = {
  hasImageAsset: boolean;
  hasVideoAsset: boolean;
  hasPreviewAsset: boolean;
  hasMotionAsset: boolean;
};

export type GalleryEntryGenerateAction = {
  assetKinds: IluGalleryGenerateAssetKind[];
  label: "Generate" | "Regenerate";
};

const hasGalleryAssetUrl = (url: string | null | undefined): boolean => Boolean((url || "").trim());

const hasGalleryImageAsset = (entry: IluGalleryEntry): boolean => hasGalleryAssetUrl(entry.thumbnailUrl);

const hasGalleryVideoAsset = (entry: IluGalleryEntry): boolean => hasGalleryAssetUrl(entry.videoUrl);

const hasGalleryPreviewAsset = (entry: IluGalleryEntry): boolean => hasGalleryAssetUrl(entry.previewUrl);

export const resolveGalleryEntryMediaState = (entry: IluGalleryEntry): GalleryEntryMediaState => {
  const hasImageAsset = hasGalleryImageAsset(entry);
  const hasVideoAsset = hasGalleryVideoAsset(entry);
  const hasPreviewAsset = hasGalleryPreviewAsset(entry);
  const hasMotionAsset = hasVideoAsset || hasPreviewAsset;

  return {
    hasImageAsset,
    hasVideoAsset,
    hasPreviewAsset,
    hasMotionAsset,
  };
};

export const resolveGalleryEntryGenerateAction = (entry: IluGalleryEntry): GalleryEntryGenerateAction => {
  const mediaState = resolveGalleryEntryMediaState(entry);
  const assetKinds: IluGalleryGenerateAssetKind[] = [];

  if (!mediaState.hasImageAsset) {
    assetKinds.push("image");
  }
  if (!mediaState.hasMotionAsset) {
    assetKinds.push("video");
  }

  return {
    assetKinds: assetKinds.length > 0 ? assetKinds : [...GALLERY_GENERATE_ASSET_KINDS],
    label: assetKinds.length > 0 ? "Generate" : "Regenerate",
  };
};
