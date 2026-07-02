import type { Dispatch, SetStateAction } from "react";
import type { ViewerRuntime } from "@/runtime_engine/rosviz/session/runtimeSelector";
import type { ViewerProfile } from "@/features/workspace/viewerProfile";
import type { WorkspaceMode } from "@/features/workspace/types";
import type { ObjectCreatorType } from "@/features/objects/useObjectCreator";
import type { CollaborationLinkAccess } from "@/features/collaboration/collaborationTypes";
import type {
  AngleUnit,
  InertialVisualizationSettings,
  RotationAxis,
  UrdfViewMode,
} from "@/shared/types/feature";

export type CollaborationInviteAction =
  | "creating"
  | "copying"
  | "emailing"
  | "resetting";

export type TopNavBarProps = {
  workspaceMode: WorkspaceMode;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
  onGoHome?: () => void;
  onExportAssemblyUrdf?: () => void;
  showMenus: boolean;
  openExportDialog: () => void;
  onSave: () => void;
  onRevert: () => void;
  canRevert: boolean;
  onResetRotation: () => void;
  hasRotationChanges: boolean;
  onCanonicalOrder: () => void;
  onPrettyPrint: () => void;
  onNormalizeAxes: () => void;
  onFixMeshPaths: () => void;
  rotationAxis: RotationAxis;
  setRotationAxis: (axis: RotationAxis) => void;
  onRotateRobot: (axis: RotationAxis) => void;
  angleUnit: AngleUnit;
  setAngleUnit: (unit: AngleUnit) => void;
  rendererRuntime: ViewerRuntime;
  onRendererRuntimeChange: (runtime: ViewerRuntime) => void;
  rendererRuntimeLocked: boolean;
  rendererRuntimeLockedReason?: string;
  rosVizRuntimeAvailable: boolean;
  rosVizRuntimeUnavailableReason?: string;
  viewerProfile: ViewerProfile;
  onViewerProfileChange: (profile: ViewerProfile) => void;
  viewerProfileLocked: boolean;
  viewerProfileLockedReason?: string;
  displaysPanelOpen: boolean;
  runtimeHealthPanelOpen: boolean;
  onToggleDisplaysPanel: () => void;
  onToggleRuntimeHealthPanel: () => void;
  gpuMode: "low" | "high";
  setGPUMode: (mode: "low" | "high") => void;
  collisionsVisible: boolean;
  setCollisionsVisible: (show: boolean) => void;
  showUrdfEditor: boolean;
  setShowUrdfEditor: (show: boolean) => void;
  urdfViewMode: UrdfViewMode;
  setUrdfViewMode: (mode: UrdfViewMode) => void;
  showPovCameras: boolean;
  setShowPovCameras: (show: boolean) => void;
  inertialVisualization: InertialVisualizationSettings;
  setInertialVisualization: Dispatch<SetStateAction<InertialVisualizationSettings>>;
  onValidateCurrentWorldScenePackage: () => void;
  onPublishCurrentWorldScenePackage: () => void;
  onPublishCurrentWorldScenePackageToHub?: () => void;
  onExportCurrentWorldScenePackage: () => void;
  onImportWorldScenePackage: () => void;
  onExportWorldRolloutCampaign?: () => void;
  onRunLocalWorldRollout?: () => void;
  onImportWorldRolloutResults?: () => void;
  onOpenWorldRolloutReview?: () => void;
  onExportCurrentWorldSceneLayer: () => void;
  onImportSceneLayerFromUrl: () => void;
  onImportWorkspaceChangeSet: () => void;
  onListWorldScenePackages: () => void;
  onOpenWorldHubBrowser?: () => void;
  openObjectCreator: (type?: ObjectCreatorType) => void;
  setShowCameraCreator: (show: boolean) => void;
  setShowCameraUpload: (show: boolean) => void;
  exportCamerasAsJSON: () => void;
  exportCamerasAsYAML: () => void;
  hasCamerasToExport: boolean;
  isIkPanelOpen: boolean;
  onOpenIkPanel: () => void;
  selectedIkSolverId: string;
  ikSolverOptions: Array<{ id: string; label: string }>;
  onSelectIkSolver: (solverId: string) => void;
  workspaceLauncherStatusLabel?: string;
  workspaceLauncherNeedsAttention?: boolean;
  onOpenWorkspaceLauncher?: () => void;
  studioIssueReportUrl?: string;
  collaborationOwner?: boolean;
  collaborationPeerCount?: number;
  collaborationInviteAction?: CollaborationInviteAction | null;
  collaborationSharingEnabled?: boolean;
  collaborationStatus?: "idle" | "connecting" | "connected" | "error";
  onCreateCollaborationLink?: (baseUrl?: string, access?: CollaborationLinkAccess) => void;
  onEmailCollaborationLink?: (email: string, baseUrl?: string, access?: CollaborationLinkAccess) => void;
  onResetCollaborationLink?: () => void;
  onSetCollaborationSharingEnabled?: (enabled: boolean) => void | Promise<void>;
};
