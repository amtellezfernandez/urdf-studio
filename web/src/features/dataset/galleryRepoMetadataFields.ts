import type { IluGalleryRepoMetadata } from "@/features/dataset/iluGalleryApi";

type CsvGalleryRepoMetadataFieldKey = Exclude<{
  [Key in keyof IluGalleryRepoMetadata]: IluGalleryRepoMetadata[Key] extends string[] ? Key : never;
}[keyof IluGalleryRepoMetadata], "tags">;

type TextGalleryRepoMetadataFieldKey = {
  [Key in keyof IluGalleryRepoMetadata]: IluGalleryRepoMetadata[Key] extends string ? Key : never;
}[keyof IluGalleryRepoMetadata];

type GalleryRepoMetadataFieldBase = {
  label: string;
  columnClassName?: string;
};

type GalleryRepoMetadataTextField = GalleryRepoMetadataFieldBase & {
  key: TextGalleryRepoMetadataFieldKey;
  kind: "text";
};

type GalleryRepoMetadataCsvField = GalleryRepoMetadataFieldBase & {
  key: CsvGalleryRepoMetadataFieldKey;
  kind: "csv";
};

export type GalleryRepoMetadataField = GalleryRepoMetadataTextField | GalleryRepoMetadataCsvField;

export const GALLERY_REPO_METADATA_VISIBLE_FIELDS = [
  { key: "org", label: "Org", kind: "text" },
  { key: "authorWebsite", label: "Web", kind: "text" },
  { key: "authorGithub", label: "GitHub", kind: "text" },
  { key: "authorX", label: "X", kind: "text" },
  { key: "authorLinkedin", label: "LinkedIn", kind: "text" },
  { key: "license", label: "License", kind: "text" },
  { key: "demo", label: "Demo", kind: "text" },
  { key: "contact", label: "Contact", kind: "text" },
  { key: "hfDatasets", label: "HF Datasets", kind: "csv" },
  { key: "summary", label: "Summary", kind: "text", columnClassName: "md:col-span-2 xl:col-span-3" },
  { key: "extra", label: "Extra", kind: "text", columnClassName: "md:col-span-2 xl:col-span-3" },
] as const satisfies readonly GalleryRepoMetadataField[];
