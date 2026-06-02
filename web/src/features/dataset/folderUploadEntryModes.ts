import type { WorkspaceMode } from "@/features/workspace/types";

export type FolderUploadEntryOption =
  | "studio"
  | "gallery"
  | "assembly"
  | "runtime"
  | "training";

export type AssemblyEntryWorkflow = "multi_robot" | "substitution";

export type FolderUploadEntryModeConfig = {
  id: FolderUploadEntryOption;
  workspaceMode: WorkspaceMode;
  label: string;
  loaderDescription: string;
  robotLoaderTitle: string;
  showWorldLoader: boolean;
  showCameraLoader: boolean;
  showLoaders: boolean;
  isCompact: boolean;
  isAssembly: boolean;
  isRuntime: boolean;
};

export type AssemblyEntryWorkflowConfig = {
  id: AssemblyEntryWorkflow;
  label: string;
  loaderDescription: string;
  launchLabel: string;
};

export const FOLDER_UPLOAD_ENTRY_MODE_CONFIGS: readonly FolderUploadEntryModeConfig[] = [
  {
    id: "studio",
    workspaceMode: "studio",
    label: "Single",
    loaderDescription: "Load one or combine different sources.",
    robotLoaderTitle: "Robot",
    showWorldLoader: true,
    showCameraLoader: true,
    showLoaders: true,
    isCompact: false,
    isAssembly: false,
    isRuntime: false,
  },
  {
    id: "gallery",
    workspaceMode: "studio",
    label: "Gallery",
    loaderDescription: "Start with one source, then continue in the main Studio workspace.",
    robotLoaderTitle: "Source",
    showWorldLoader: false,
    showCameraLoader: false,
    showLoaders: true,
    isCompact: false,
    isAssembly: false,
    isRuntime: false,
  },
  {
    id: "training",
    workspaceMode: "studio",
    label: "Training",
    loaderDescription: "",
    robotLoaderTitle: "",
    showWorldLoader: false,
    showCameraLoader: false,
    showLoaders: false,
    isCompact: true,
    isAssembly: false,
    isRuntime: false,
  },
] as const;

export const VISIBLE_FOLDER_UPLOAD_ENTRY_MODE_CONFIGS: readonly FolderUploadEntryModeConfig[] =
  FOLDER_UPLOAD_ENTRY_MODE_CONFIGS.filter((config) => config.id !== "gallery");

export const ASSEMBLY_ENTRY_WORKFLOW_CONFIGS: readonly AssemblyEntryWorkflowConfig[] = [
  {
    id: "multi_robot",
    label: "Multi-Robot",
    loaderDescription: "Add sources, select robots from each one, then open assembly workspace.",
    launchLabel: "Open Assembly",
  },
  {
    id: "substitution",
    label: "Substitution",
    loaderDescription: "Stage both sources, then open the assembly-style substitution workspace.",
    launchLabel: "Open Substitution",
  },
] as const;

const ENTRY_MODE_CONFIG_BY_ID = new Map(
  FOLDER_UPLOAD_ENTRY_MODE_CONFIGS.map((config) => [config.id, config] as const)
);
const ASSEMBLY_ENTRY_WORKFLOW_CONFIG_BY_ID = new Map(
  ASSEMBLY_ENTRY_WORKFLOW_CONFIGS.map((config) => [config.id, config] as const)
);

export const getFolderUploadEntryModeConfig = (
  entryOption: FolderUploadEntryOption
): FolderUploadEntryModeConfig => ENTRY_MODE_CONFIG_BY_ID.get(entryOption) ?? FOLDER_UPLOAD_ENTRY_MODE_CONFIGS[0];

export const getAssemblyEntryWorkflowConfig = (
  workflow: AssemblyEntryWorkflow
): AssemblyEntryWorkflowConfig =>
  ASSEMBLY_ENTRY_WORKFLOW_CONFIG_BY_ID.get(workflow) ?? ASSEMBLY_ENTRY_WORKFLOW_CONFIGS[0];

export const toWorkspaceMode = (entryOption: FolderUploadEntryOption): WorkspaceMode => {
  return getFolderUploadEntryModeConfig(entryOption).workspaceMode;
};

export const syncEntryOptionWithWorkspaceMode = (
  currentEntryOption: FolderUploadEntryOption,
  workspaceMode: WorkspaceMode
): FolderUploadEntryOption => {
  if (toWorkspaceMode(currentEntryOption) === workspaceMode) {
    return currentEntryOption;
  }
  if (workspaceMode === "assembly") {
    return "assembly";
  }
  if (workspaceMode === "runtime") {
    return "runtime";
  }
  return "studio";
};
