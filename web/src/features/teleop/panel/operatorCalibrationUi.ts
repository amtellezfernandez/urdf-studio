import type { OperatorLeRobotCalibrationStartResult } from "@/features/teleop/transport/operatorHelperApi";

export type OperatorCalibrationUiCopy = {
  pending: string;
  started: string;
  manual: string;
  failed: string;
};

export type OperatorCalibrationUiEntry = {
  command: string | null;
  message: string | null;
};

export type OperatorCalibrationUiState = {
  activeKey: string | null;
  entries: Record<string, OperatorCalibrationUiEntry>;
};

export const OPERATOR_CALIBRATION_UI_KEYS = {
  follower: "follower",
} as const;

export const OPERATOR_CALIBRATION_UI_COPY = {
  follower: {
    pending: "Opening LeRobot calibration...",
    started: "LeRobot calibration opened. Use its prompt, then reconnect follower.",
    manual: "Run the LeRobot command; it will ask to use or redo calibration.",
    failed: "Could not start follower calibration.",
  },
  leader: {
    pending: "Opening LeRobot calibration...",
    started: "LeRobot calibration opened. Use its prompt, then rescan.",
    manual: "Run the LeRobot command; it will ask to use or redo calibration.",
    failed: "Could not start leader calibration.",
  },
} as const satisfies Record<string, OperatorCalibrationUiCopy>;

export const createOperatorCalibrationUiState =
  (): OperatorCalibrationUiState => ({
    activeKey: null,
    entries: {},
  });

export const readOperatorCalibrationUiEntry = (
  state: OperatorCalibrationUiState,
  key: string,
): OperatorCalibrationUiEntry => state.entries[key] ?? emptyCalibrationUiEntry;

export const isOperatorCalibrationUiActive = (
  state: OperatorCalibrationUiState,
  key: string,
): boolean => state.activeKey === key;

export const beginOperatorCalibrationUi = (
  state: OperatorCalibrationUiState,
  key: string,
  copy: OperatorCalibrationUiCopy,
): OperatorCalibrationUiState => ({
  activeKey: key,
  entries: {
    ...state.entries,
    [key]: {
      command: null,
      message: copy.pending,
    },
  },
});

export const finishOperatorCalibrationUi = (
  state: OperatorCalibrationUiState,
  key: string,
  result: OperatorLeRobotCalibrationStartResult,
  copy: OperatorCalibrationUiCopy,
): OperatorCalibrationUiState => ({
  activeKey: state.activeKey === key ? null : state.activeKey,
  entries: {
    ...state.entries,
    [key]: {
      command: result.displayCommand || null,
      message: resolveOperatorCalibrationResultMessage(result, copy),
    },
  },
});

export const failOperatorCalibrationUi = (
  state: OperatorCalibrationUiState,
  key: string,
  error: unknown,
  copy: OperatorCalibrationUiCopy,
): OperatorCalibrationUiState => ({
  activeKey: state.activeKey === key ? null : state.activeKey,
  entries: {
    ...state.entries,
    [key]: {
      ...readOperatorCalibrationUiEntry(state, key),
      message: resolveOperatorCalibrationErrorMessage(error, copy),
    },
  },
});

export const resolveOperatorCalibrationResultMessage = (
  result: OperatorLeRobotCalibrationStartResult,
  copy: OperatorCalibrationUiCopy,
): string => (result.started ? copy.started : result.message || copy.manual);

export const resolveOperatorCalibrationErrorMessage = (
  error: unknown,
  copy: OperatorCalibrationUiCopy,
): string => (error instanceof Error ? error.message : copy.failed);

const emptyCalibrationUiEntry: OperatorCalibrationUiEntry = {
  command: null,
  message: null,
};
