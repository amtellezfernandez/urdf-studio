import type { WorkspaceTransferTargetId } from "@/features/world-share/workspaceTransferApi";
import type {
  WorkspaceTransferAssetFormat,
  WorkspaceTransferStrategy,
  WorkspaceTransferTargetKind,
} from "@/features/world-share/workspaceTransferParams";

export type WorkspaceTransferTargetState = {
  id: WorkspaceTransferTargetId;
  label: string;
  targetKind: WorkspaceTransferTargetKind;
  detail: string;
  robotAssetFormat: WorkspaceTransferAssetFormat;
  sceneAssetFormat: WorkspaceTransferAssetFormat;
  transferStrategy: WorkspaceTransferStrategy;
  transferLabel: string;
  transferDescription: string;
  createsTransferAsset: boolean;
  statusLabel: string;
  openLabel: string;
  openingLabel: string;
  cancelLabel?: string;
  isBusy: boolean;
  isActive?: boolean;
  canOpen: boolean;
  disabledLabel: string;
  onAction: () => void | Promise<void>;
  onCancel?: () => void;
};

export type WorkspaceTransferState = {
  sceneSummary?: string;
  targets: WorkspaceTransferTargetState[];
};
