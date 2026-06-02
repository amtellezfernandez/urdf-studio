import type {
  OperatorCommandMetadata,
  OperatorJointJogCommand,
  OperatorTwistCommand,
} from "@/features/teleop/contracts/operatorControlTypes";
import {
  createOperatorControlDatagramClient,
  type OperatorControlDatagramAck,
  type OperatorControlDatagramAuthorization,
  type OperatorControlDatagramClient,
} from "@/features/teleop/transport/operatorControlDatagramClient";
import type { OperatorControlTransportDescriptor } from "@/features/teleop/transport/operatorControlTransport";
import {
  OPERATOR_HELPER_BASE_URL,
  OPERATOR_HELPER_BROWSER_TOKEN,
  sendOperatorEstopCommand,
  sendOperatorJointJogCommand,
  sendOperatorStopCommand,
  sendOperatorTwistCommand,
  type OperatorCollaborationAuthorization,
  type OperatorControlRestAck,
} from "@/features/teleop/transport/operatorHelperApi";
import { OPERATOR_CONTROL_TRANSPORT_MESSAGES } from "@/features/teleop/params/operatorTeleopParams";

export type OperatorControlCommandAck =
  | OperatorControlDatagramAck
  | OperatorControlRestAck
  | null;

export type OperatorControlCommandTransportKind =
  | "datagram"
  | "rest"
  | "unavailable";

export type OperatorControlCommandTransport = {
  kind: OperatorControlCommandTransportKind;
  sendTwist: (
    command: OperatorTwistCommand,
    metadata: OperatorCommandMetadata,
  ) => Promise<OperatorControlCommandAck>;
  sendStop: (
    metadata: OperatorCommandMetadata,
  ) => Promise<OperatorControlCommandAck>;
  sendEstop: (
    metadata: OperatorCommandMetadata,
  ) => Promise<OperatorControlCommandAck>;
  sendJointJog: (
    command: OperatorJointJogCommand,
    metadata: OperatorCommandMetadata,
  ) => Promise<OperatorControlCommandAck>;
  close: () => void;
};

type OperatorDatagramControlCommandTransportOptions = {
  controlTransport: OperatorControlTransportDescriptor;
  sessionId: string;
  peerId: string;
  authorization?: OperatorCollaborationAuthorization | null;
  datagramClient?: OperatorControlDatagramClient;
};

type OperatorRestControlCommandTransportOptions = {
  baseUrl?: string;
  browserToken?: string;
  peerId: string;
  authorization?: OperatorCollaborationAuthorization | null;
};

type OperatorControlCommandTransportAvailabilityOptions = {
  controlTransport?: OperatorControlTransportDescriptor | null;
  sessionId?: string | null;
  authorization?: OperatorCollaborationAuthorization | null;
};

type OperatorControlCommandTransportAvailability =
  | {
      available: true;
      controlTransport: OperatorControlTransportDescriptor;
      sessionId: string;
    }
  | {
      available: false;
      reason: string;
    };

export type OperatorControlCommandTransportOptions = {
  controlTransport?: OperatorControlTransportDescriptor | null;
  sessionId?: string | null;
  peerId: string;
  authorization?: OperatorCollaborationAuthorization | null;
  restControlAvailable?: boolean;
  baseUrl?: string;
  browserToken?: string;
};

const toDatagramAuthorization = (
  authorization?: OperatorCollaborationAuthorization | null,
): OperatorControlDatagramAuthorization | null =>
  authorization?.teleopCapabilityToken?.trim()
    ? {
        collaboration_session_id: authorization.sessionId,
        teleop_capability_token: authorization.teleopCapabilityToken.trim(),
      }
    : null;

const hasDatagramTeleopCapabilityAuthorization = (
  authorization?: OperatorCollaborationAuthorization | null,
): boolean => Boolean(authorization?.teleopCapabilityToken?.trim());

const createUnavailableControlCommandTransport = (
  reason: string,
): OperatorControlCommandTransport => {
  const rejectCommand = async (): Promise<never> => {
    throw new Error(reason);
  };
  return {
    kind: "unavailable",
    sendTwist: rejectCommand,
    sendStop: rejectCommand,
    sendEstop: rejectCommand,
    sendJointJog: rejectCommand,
    close: () => undefined,
  };
};

const getControlCommandTransportAvailability = ({
  controlTransport,
  sessionId,
  authorization,
}: OperatorControlCommandTransportAvailabilityOptions):
  OperatorControlCommandTransportAvailability => {
  if (!controlTransport || !controlTransport.sidecarReady) {
    return {
      available: false,
      reason: OPERATOR_CONTROL_TRANSPORT_MESSAGES.mismatch,
    };
  }
  if (!sessionId) {
    return {
      available: false,
      reason: OPERATOR_CONTROL_TRANSPORT_MESSAGES.sessionMissing,
    };
  }
  if (
    controlTransport.requiresTeleopCapability &&
    !hasDatagramTeleopCapabilityAuthorization(authorization)
  ) {
    return {
      available: false,
      reason: OPERATOR_CONTROL_TRANSPORT_MESSAGES.capabilityRequired,
    };
  }
  return {
    available: true,
    controlTransport,
    sessionId,
  };
};

export const createOperatorDatagramControlCommandTransport = ({
  controlTransport,
  sessionId,
  peerId,
  authorization = null,
  datagramClient = createOperatorControlDatagramClient({
    descriptor: controlTransport,
    sessionId,
    peerId,
  }),
}: OperatorDatagramControlCommandTransportOptions): OperatorControlCommandTransport => {
  const datagramAuthorization = toDatagramAuthorization(authorization);
  const sendPriorityCommand = (metadata: OperatorCommandMetadata) =>
    datagramClient.send(
      metadata,
      {},
      {
        authorization: datagramAuthorization,
        priority: true,
      },
    );

  return {
    kind: "datagram",
    sendTwist: (command, metadata) =>
      datagramClient.send(metadata, command, {
        ackRequested: false,
        authorization: datagramAuthorization,
      }),
    sendStop: sendPriorityCommand,
    sendEstop: sendPriorityCommand,
    sendJointJog: (command, metadata) =>
      datagramClient.send(metadata, command, {
        authorization: datagramAuthorization,
      }),
    close: () => datagramClient.close(),
  };
};

export const createOperatorRestControlCommandTransport = ({
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  peerId,
  authorization = null,
}: OperatorRestControlCommandTransportOptions): OperatorControlCommandTransport => ({
  kind: "rest",
  sendTwist: (command, metadata) =>
    sendOperatorTwistCommand(
      command,
      metadata,
      baseUrl,
      browserToken,
      authorization,
    ),
  sendStop: (metadata) =>
    sendOperatorStopCommand(metadata, baseUrl, browserToken, authorization),
  sendEstop: (metadata) =>
    sendOperatorEstopCommand(metadata, baseUrl, browserToken, authorization),
  sendJointJog: (command, metadata) =>
    sendOperatorJointJogCommand(
      command,
      metadata,
      baseUrl,
      browserToken,
      authorization,
      peerId,
    ),
  close: () => undefined,
});

export const createOperatorControlCommandTransport = ({
  controlTransport,
  sessionId,
  peerId,
  authorization = null,
  restControlAvailable = false,
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
}: OperatorControlCommandTransportOptions): OperatorControlCommandTransport => {
  const availability = getControlCommandTransportAvailability({
    controlTransport,
    sessionId,
    authorization,
  });
  if (availability.available === false) {
    if (restControlAvailable) {
      return createOperatorRestControlCommandTransport({
        baseUrl,
        browserToken,
        peerId,
        authorization,
      });
    }
    return createUnavailableControlCommandTransport(availability.reason);
  }
  return createOperatorDatagramControlCommandTransport({
    controlTransport: availability.controlTransport,
    sessionId: availability.sessionId,
    peerId,
    authorization,
  });
};
