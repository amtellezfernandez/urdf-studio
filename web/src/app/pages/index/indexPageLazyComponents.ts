import { lazy } from "react";

export const FolderUploadScreen = lazy(() =>
  import("@/features/dataset/FolderUploadScreen").then((module) => ({
    default: module.FolderUploadScreen,
  }))
);

export const IkDebuggerPanel = lazy(() =>
  import("@/features/ik/IkDebuggerPanel").then((module) => ({
    default: module.IkDebuggerPanel,
  }))
);

export const OperatorTeleopPanelShell = lazy(() =>
  import("@/features/teleop/panel/OperatorTeleopPanel").then((module) => ({
    default: module.OperatorTeleopPanelShell,
  }))
);

export const WorldPublishDialog = lazy(() =>
  import("@/features/world-share/WorldPublishDialog").then((module) => ({
    default: module.WorldPublishDialog,
  }))
);

export const WorldRegistryPanel = lazy(() =>
  import("@/features/world-share/WorldRegistryPanel").then((module) => ({
    default: module.WorldRegistryPanel,
  }))
);

export const WorldRolloutReviewPanel = lazy(() =>
  import("@/features/world-share/WorldRolloutReviewPanel").then((module) => ({
    default: module.WorldRolloutReviewPanel,
  }))
);

export const WorldSceneImportDialog = lazy(() =>
  import("@/features/world-share/WorldSceneImportDialog").then((module) => ({
    default: module.WorldSceneImportDialog,
  }))
);
