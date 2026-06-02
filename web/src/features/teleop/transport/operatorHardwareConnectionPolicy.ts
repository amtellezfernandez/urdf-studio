import type {
  OperatorDeviceRole,
  OperatorDeviceRoleAssignments,
} from "@/features/teleop/transport/operatorDeviceRoleAssignments";
import {
  normalizeOperatorDeviceRoleKeys,
  resolveOperatorDeviceRoleConflictForKeys,
} from "@/features/teleop/transport/operatorDeviceRoleAssignments";

export type OperatorHardwareConnectionReadinessItem = {
  id: string;
  label: string;
  ready: boolean;
  detail: string;
};

export type OperatorHardwareConnectionStatus = "connected" | "ready" | "blocked";

export type BuildOperatorHardwareConnectionReadinessItemParams = {
  id: string;
  label: string;
  ready: boolean;
  readyDetail: string;
  blockedDetail: string;
};

export type ResolveOperatorHardwareRoleConflictParams = {
  assignments: OperatorDeviceRoleAssignments;
  deviceKey:
    | string
    | readonly (string | null | undefined)[]
    | null
    | undefined;
  requestedRole: OperatorDeviceRole;
};

export type ResolveOperatorHardwareConnectionStateParams = {
  deviceAvailable: boolean;
  operationBusy: boolean;
  alreadyConnected: boolean;
  connectionPrerequisitesReady: boolean;
  roleConflict: string | null;
};

export type OperatorHardwareConnectBlockReason =
  | "operation_busy"
  | "device_unavailable"
  | "role_conflict"
  | "prerequisites_not_ready";

export type OperatorHardwareTargetSelectionBlockReason =
  | "device_unavailable"
  | "role_conflict"
  | "already_connected";

export type OperatorHardwareConnectionState = {
  status: OperatorHardwareConnectionStatus;
  connectDisabled: boolean;
  connectBlockReason: OperatorHardwareConnectBlockReason | null;
  targetSelectionBlocked: boolean;
  targetSelectionBlockReason: OperatorHardwareTargetSelectionBlockReason | null;
};

export const buildOperatorHardwareConnectionReadinessItem = ({
  id,
  label,
  ready,
  readyDetail,
  blockedDetail,
}: BuildOperatorHardwareConnectionReadinessItemParams): OperatorHardwareConnectionReadinessItem => ({
  id,
  label,
  ready,
  detail: ready ? readyDetail : blockedDetail,
});

export const resolveOperatorHardwareRoleConflict = ({
  assignments,
  deviceKey,
  requestedRole,
}: ResolveOperatorHardwareRoleConflictParams): string | null => {
  const deviceKeys = (
    typeof deviceKey === "string" || deviceKey == null
      ? [deviceKey]
      : deviceKey
  ) as readonly (string | null | undefined)[];
  const normalizedDeviceKeys = normalizeOperatorDeviceRoleKeys(deviceKeys);
  if (normalizedDeviceKeys.length === 0) return null;
  return resolveOperatorDeviceRoleConflictForKeys(
    assignments,
    normalizedDeviceKeys,
    requestedRole,
  );
};

const resolveOperatorHardwareConnectBlockReason = (
  state: ResolveOperatorHardwareConnectionStateParams,
):
  | OperatorHardwareConnectBlockReason
  | null => {
  if (state.alreadyConnected) return null;
  if (state.operationBusy) return "operation_busy";
  if (!state.deviceAvailable) return "device_unavailable";
  if (state.roleConflict) return "role_conflict";
  if (!state.connectionPrerequisitesReady) return "prerequisites_not_ready";
  return null;
};

const resolveOperatorHardwareTargetSelectionBlockReason = (
  state: ResolveOperatorHardwareConnectionStateParams,
): OperatorHardwareTargetSelectionBlockReason | null => {
  if (!state.deviceAvailable) return "device_unavailable";
  if (state.roleConflict) return "role_conflict";
  if (state.alreadyConnected) return "already_connected";
  return null;
};

export const resolveOperatorHardwareConnectionState = (
  state: ResolveOperatorHardwareConnectionStateParams,
): OperatorHardwareConnectionState => {
  const connectBlockReason = resolveOperatorHardwareConnectBlockReason(state);
  const targetSelectionBlockReason =
    resolveOperatorHardwareTargetSelectionBlockReason(state);

  return {
    status: state.alreadyConnected
      ? "connected"
      : connectBlockReason
        ? "blocked"
        : "ready",
    connectDisabled: connectBlockReason !== null,
    connectBlockReason,
    targetSelectionBlocked: targetSelectionBlockReason !== null,
    targetSelectionBlockReason,
  };
};
