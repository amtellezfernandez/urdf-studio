import type { UrdfFileInput } from "@/features/urdf/loader/urdfLoaderTypes";

export type SourceEntryGitHubParams = {
  repoUrl: string;
  urdfPath?: string;
  token?: string;
};

export type SourceEntryActions = {
  onFolderSelected: (
    fileList: UrdfFileInput,
    options?: { preserveCameras?: boolean }
  ) => Promise<void>;
  onGitHubSelected: (params: SourceEntryGitHubParams) => Promise<void>;
  onUrlSelected: (url: string) => Promise<void>;
  onPlayDemoMotion: () => void | Promise<void>;
  onImportWorldLayout: (worldLayoutUrl: string) => Promise<void>;
  onOpenWorldOnlyWorkspace: () => void;
};
