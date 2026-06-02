import type { WorkspaceMode } from "@/features/workspace/types";

const isAssemblyWorkspaceMode = (_workspaceMode: WorkspaceMode) => false;

export const getWorkspaceModeUiPolicy = (workspaceMode: WorkspaceMode) => {
  const isAssembly = isAssemblyWorkspaceMode(workspaceMode);
  const isStudio = workspaceMode === "studio";
  const isRuntime = false;

  return {
    isAssembly,
    isStudio,
    isRuntime,
    showAssemblyActions: isAssembly,
    showStudioChrome: !isAssembly,
    showIkPanel: !isAssembly,
    showWorldDialogs: !isAssembly,
    showStudioIssueReport: isStudio,
  };
};
