import { describe, expect, it } from "vitest";

import { GALLERY_REPO_METADATA_VISIBLE_FIELDS } from "@/features/dataset/galleryRepoMetadataFields";

describe("GALLERY_REPO_METADATA_VISIBLE_FIELDS", () => {
  it("omits tags from the published metadata editor", () => {
    expect(GALLERY_REPO_METADATA_VISIBLE_FIELDS.map((field) => field.key)).not.toContain("tags");
    expect(GALLERY_REPO_METADATA_VISIBLE_FIELDS.map((field) => field.label)).not.toContain("Tags");
  });

  it("keeps the core published metadata fields in a stable order", () => {
    expect(GALLERY_REPO_METADATA_VISIBLE_FIELDS.map((field) => field.label)).toEqual([
      "Org",
      "Web",
      "GitHub",
      "X",
      "LinkedIn",
      "License",
      "Demo",
      "Contact",
      "HF Datasets",
      "Summary",
      "Extra",
    ]);
  });
});
