import type {
  OperatorCommandKind,
  OperatorCommandMetadata,
  OperatorTwistCommand,
} from "@/features/teleop/contracts/operatorControlTypes";
import { OPERATOR_HELPER_COMMAND_SEQUENCE_INITIAL } from "@/features/teleop/params/operatorTeleopParams";

type OperatorQueuedMotionCommand = {
  kind: Extract<OperatorCommandKind, "twist" | "stop">;
  onAccepted?: (metadata: OperatorCommandMetadata) => void;
  onError?: (error: unknown, metadata: OperatorCommandMetadata) => void;
  twist: OperatorTwistCommand;
};

type OperatorCommandQueueParams = {
  nowMs?: () => number;
  send: (
    twist: OperatorTwistCommand,
    metadata: OperatorCommandMetadata,
  ) => Promise<unknown>;
};

export type OperatorCommandQueue = {
  clearQueued: () => void;
  enqueue: (command: OperatorQueuedMotionCommand) => void;
  getLastSequence: () => number;
  isBusy: () => boolean;
  reserveMetadata: (kind: OperatorCommandKind) => OperatorCommandMetadata;
};

export const createOperatorCommandQueue = ({
  nowMs = Date.now,
  send,
}: OperatorCommandQueueParams): OperatorCommandQueue => {
  let inFlight = false;
  let queuedCommand: OperatorQueuedMotionCommand | null = null;
  let lastSequence = OPERATOR_HELPER_COMMAND_SEQUENCE_INITIAL;

  const buildMetadata = (kind: OperatorCommandKind): OperatorCommandMetadata => {
    lastSequence += 1;
    return {
      command_kind: kind,
      sequence: lastSequence,
      source_ts_ms: nowMs(),
    };
  };

  const sendQueuedCommand = async (
    command: OperatorQueuedMotionCommand,
    metadata: OperatorCommandMetadata,
  ): Promise<void> => {
    try {
      await send(command.twist, metadata);
      command.onAccepted?.(metadata);
    } catch (error) {
      command.onError?.(error, metadata);
    }
  };

  const sendPriorityStop = (command: OperatorQueuedMotionCommand): void => {
    queuedCommand = null;
    void sendQueuedCommand(command, buildMetadata(command.kind));
  };

  const drain = async (): Promise<void> => {
    if (inFlight) return;
    const command = queuedCommand;
    if (!command) return;

    queuedCommand = null;
    inFlight = true;
    try {
      await sendQueuedCommand(command, buildMetadata(command.kind));
    } finally {
      inFlight = false;
      if (queuedCommand) {
        void drain();
      }
    }
  };

  return {
    clearQueued: () => {
      queuedCommand = null;
    },
    enqueue: (command) => {
      if (command.kind === "stop" && inFlight) {
        sendPriorityStop(command);
        return;
      }
      queuedCommand = command;
      void drain();
    },
    getLastSequence: () => lastSequence,
    isBusy: () => inFlight,
    reserveMetadata: buildMetadata,
  };
};
