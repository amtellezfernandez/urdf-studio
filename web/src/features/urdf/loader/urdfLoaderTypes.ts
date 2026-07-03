import type { MeshFiles } from "@/shared/types/feature";

export type UrdfFileInput = FileList | File[];

export type LoadUrdfTextOptions = {
  filename?: string;
  activePath?: string;
  basePath?: string;
  urdfDocuments?: Record<string, string>;
  meshFiles?: MeshFiles;
  packageRoots?: Record<string, string[]>;
};
