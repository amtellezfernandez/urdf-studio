import {
  OPERATOR_HELPER_DEFAULT_JOINT_JOG_STEP_RAD,
  OPERATOR_HELPER_DEFAULT_LINEAR_SPEED_MPS,
  OPERATOR_HELPER_DEFAULT_OPERATOR_ID,
  OPERATOR_HELPER_DEFAULT_YAW_SPEED_RPS,
  OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
  OPERATOR_TELEOPERATION_MODE_SIMULATED,
  OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC,
  OPERATOR_TELEOP_PANEL_STATE_STORAGE,
} from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorTeleoperationMode } from "@/features/teleop/profiles/operatorTeleopProfiles";
import {
  OPERATOR_HELPER_BASE_URL,
  type OperatorProviderManifest,
  normalizeOperatorProviderManifest,
} from "@/features/teleop/transport/operatorHelperApi";
import { resolveBrowserStorage } from "@/shared/lib/browserStorage";

export type OperatorTeleopPanelPersistedState = {
  baseUrl: string;
  operatorId: string;
  requestedTeleoperationMode: OperatorTeleoperationMode;
  selectedProfileId: string | null;
  selectedFollowerProfileId: string | null;
  selectedCameraStreamId: string;
  selectedJointJogName: string;
  linearSpeedMps: number;
  yawSpeedRps: number;
  jointJogStepRad: number;
  providerManifestBaseUrl: string | null;
  providerManifest: OperatorProviderManifest | null;
};

export type OperatorTeleopPanelPersistencePatch =
  Partial<OperatorTeleopPanelPersistedState>;

const DEFAULT_OPERATOR_TELEOP_PANEL_STATE: OperatorTeleopPanelPersistedState = {
  baseUrl: OPERATOR_HELPER_BASE_URL,
  operatorId: OPERATOR_HELPER_DEFAULT_OPERATOR_ID,
  requestedTeleoperationMode: OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC,
  selectedProfileId: null,
  selectedFollowerProfileId: null,
  selectedCameraStreamId: "",
  selectedJointJogName: "",
  linearSpeedMps: OPERATOR_HELPER_DEFAULT_LINEAR_SPEED_MPS,
  yawSpeedRps: OPERATOR_HELPER_DEFAULT_YAW_SPEED_RPS,
  jointJogStepRad: OPERATOR_HELPER_DEFAULT_JOINT_JOG_STEP_RAD,
  providerManifestBaseUrl: null,
  providerManifest: null,
};

type StoredOperatorTeleopPanelState = {
  version?: unknown;
  state?: unknown;
};

const resolveOperatorTeleopPanelStorage = (): Storage | undefined => {
  return resolveBrowserStorage("local");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeString = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized || fallback;
};

const normalizeNullableString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

const normalizeNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizeTeleoperationMode = (
  value: unknown,
): OperatorTeleoperationMode => {
  switch (value) {
    case OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE:
    case OPERATOR_TELEOPERATION_MODE_SIMULATED:
    case OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC:
      return value;
    default:
      return DEFAULT_OPERATOR_TELEOP_PANEL_STATE.requestedTeleoperationMode;
  }
};

const normalizeProviderManifest = (
  value: unknown,
): OperatorProviderManifest | null => {
  if (value === null || value === undefined) return null;
  try {
    return normalizeOperatorProviderManifest(value);
  } catch {
    return null;
  }
};

const normalizeOperatorTeleopPanelState = (
  value: unknown,
): OperatorTeleopPanelPersistedState => {
  const state = isRecord(value) ? value : {};
  return {
    baseUrl: normalizeString(
      state.baseUrl,
      DEFAULT_OPERATOR_TELEOP_PANEL_STATE.baseUrl,
    ),
    operatorId: normalizeString(
      state.operatorId,
      DEFAULT_OPERATOR_TELEOP_PANEL_STATE.operatorId,
    ),
    requestedTeleoperationMode: normalizeTeleoperationMode(
      state.requestedTeleoperationMode,
    ),
    selectedProfileId: normalizeNullableString(state.selectedProfileId),
    selectedFollowerProfileId: normalizeNullableString(
      state.selectedFollowerProfileId,
    ),
    selectedCameraStreamId: normalizeString(
      state.selectedCameraStreamId,
      DEFAULT_OPERATOR_TELEOP_PANEL_STATE.selectedCameraStreamId,
    ),
    selectedJointJogName: normalizeString(
      state.selectedJointJogName,
      DEFAULT_OPERATOR_TELEOP_PANEL_STATE.selectedJointJogName,
    ),
    linearSpeedMps: normalizeNumber(
      state.linearSpeedMps,
      DEFAULT_OPERATOR_TELEOP_PANEL_STATE.linearSpeedMps,
    ),
    yawSpeedRps: normalizeNumber(
      state.yawSpeedRps,
      DEFAULT_OPERATOR_TELEOP_PANEL_STATE.yawSpeedRps,
    ),
    jointJogStepRad: normalizeNumber(
      state.jointJogStepRad,
      DEFAULT_OPERATOR_TELEOP_PANEL_STATE.jointJogStepRad,
    ),
    providerManifestBaseUrl: normalizeNullableString(
      state.providerManifestBaseUrl,
    ),
    providerManifest: normalizeProviderManifest(state.providerManifest),
  };
};

export const readOperatorTeleopPanelState = (
  storage: Storage | undefined = resolveOperatorTeleopPanelStorage(),
): OperatorTeleopPanelPersistedState => {
  if (!storage) return DEFAULT_OPERATOR_TELEOP_PANEL_STATE;
  try {
    const rawValue = storage.getItem(OPERATOR_TELEOP_PANEL_STATE_STORAGE.key);
    if (!rawValue) return DEFAULT_OPERATOR_TELEOP_PANEL_STATE;
    const parsedValue = JSON.parse(rawValue) as StoredOperatorTeleopPanelState;
    if (
      !isRecord(parsedValue) ||
      parsedValue.version !== OPERATOR_TELEOP_PANEL_STATE_STORAGE.version
    ) {
      return DEFAULT_OPERATOR_TELEOP_PANEL_STATE;
    }
    return normalizeOperatorTeleopPanelState(parsedValue.state);
  } catch {
    return DEFAULT_OPERATOR_TELEOP_PANEL_STATE;
  }
};

export const writeOperatorTeleopPanelState = (
  patch: OperatorTeleopPanelPersistencePatch,
  storage: Storage | undefined = resolveOperatorTeleopPanelStorage(),
): void => {
  if (!storage) return;
  try {
    const nextState = normalizeOperatorTeleopPanelState({
      ...readOperatorTeleopPanelState(storage),
      ...patch,
    });
    storage.setItem(
      OPERATOR_TELEOP_PANEL_STATE_STORAGE.key,
      JSON.stringify({
        version: OPERATOR_TELEOP_PANEL_STATE_STORAGE.version,
        state: nextState,
      }),
    );
  } catch {
    // The panel can operate with defaults when storage is unavailable.
  }
};
