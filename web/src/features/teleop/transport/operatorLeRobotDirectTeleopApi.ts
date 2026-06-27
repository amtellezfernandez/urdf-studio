import { OPERATOR_HELPER_LEROBOT_DIRECT_TELEOP_PATHS } from "@/features/teleop/params/operatorTeleopParams";
import {
  OPERATOR_HELPER_BASE_URL,
  OPERATOR_HELPER_BROWSER_TOKEN,
  buildOperatorAuthorizationHeaders,
  buildOperatorLeaderReleasePayload,
  parseOperatorJson,
  postOperatorJson,
  type OperatorCollaborationAuthorization,
  type OperatorLeaderReleaseRequest,
} from "@/features/teleop/transport/operatorHelperApi";

export type OperatorLeRobotDirectTeleopState =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

export type OperatorLeRobotDirectTeleopLeaderRequest = Pick<
  OperatorLeaderReleaseRequest,
  | "port"
  | "portLeft"
  | "portRight"
  | "calibrationCategory"
  | "calibrationProfile"
  | "calibrationId"
  | "calibrationGroup"
>;

export type OperatorLeRobotDirectTeleopStartRequest = {
  operatorId: string;
  leader: OperatorLeRobotDirectTeleopLeaderRequest;
  fps?: number;
};

export type OperatorLeRobotDirectTeleopStatus = {
  state: OperatorLeRobotDirectTeleopState;
  running: boolean;
  sessionId: string | null;
  fps: number;
  pid: number | null;
  command: string[];
  displayCommand: string;
  leaderProfile: string | null;
  leaderId: string | null;
  followerRobotType: string | null;
  startedAtMs: number | null;
  stoppedAtMs: number | null;
  returnCode: number | null;
  lastError: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const toBoolean = (value: unknown): boolean => value === true;

const toFiniteNumber = (value: unknown, defaultValue: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : defaultValue;

const toNullableInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const readField = (
  value: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): unknown => value[camelKey] ?? value[snakeKey];

const normalizeOperatorLeRobotDirectTeleopState = (
  value: unknown,
): OperatorLeRobotDirectTeleopState => {
  const state = toTrimmedString(value);
  if (
    state === "starting" ||
    state === "running" ||
    state === "stopping" ||
    state === "stopped" ||
    state === "error"
  ) {
    return state;
  }
  return "idle";
};

const normalizeOperatorLeRobotDirectTeleopStatus = (
  value: unknown,
): OperatorLeRobotDirectTeleopStatus => {
  const status = isRecord(value) ? value : {};
  const command = status.command;
  return {
    state: normalizeOperatorLeRobotDirectTeleopState(status.state),
    running: toBoolean(status.running),
    sessionId:
      toTrimmedString(readField(status, "sessionId", "session_id")) || null,
    fps: toFiniteNumber(status.fps, 0),
    pid: toNullableInteger(status.pid),
    command: Array.isArray(command)
      ? command.map((entry) => toTrimmedString(entry)).filter(Boolean)
      : [],
    displayCommand: toTrimmedString(
      readField(status, "displayCommand", "display_command"),
    ),
    leaderProfile:
      toTrimmedString(readField(status, "leaderProfile", "leader_profile")) ||
      null,
    leaderId:
      toTrimmedString(readField(status, "leaderId", "leader_id")) || null,
    followerRobotType:
      toTrimmedString(
        readField(status, "followerRobotType", "follower_robot_type"),
      ) || null,
    startedAtMs: toNullableInteger(
      readField(status, "startedAtMs", "started_at_ms"),
    ),
    stoppedAtMs: toNullableInteger(
      readField(status, "stoppedAtMs", "stopped_at_ms"),
    ),
    returnCode: toNullableInteger(
      readField(status, "returnCode", "return_code"),
    ),
    lastError:
      toTrimmedString(readField(status, "lastError", "last_error")) || null,
  };
};

export const fetchOperatorLeRobotDirectTeleopStatus = async (
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
): Promise<OperatorLeRobotDirectTeleopStatus> => {
  const headers = buildOperatorAuthorizationHeaders(browserToken, authorization);
  const response = await fetch(
    `${baseUrl}${OPERATOR_HELPER_LEROBOT_DIRECT_TELEOP_PATHS.status}`,
    { headers },
  );
  return normalizeOperatorLeRobotDirectTeleopStatus(
    await parseOperatorJson<unknown>(response, "LeRobot direct teleop status"),
  );
};

export const startOperatorLeRobotDirectTeleop = async (
  request: OperatorLeRobotDirectTeleopStartRequest,
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
): Promise<OperatorLeRobotDirectTeleopStatus> =>
  normalizeOperatorLeRobotDirectTeleopStatus(
    await postOperatorJson<unknown>(
      baseUrl,
      OPERATOR_HELPER_LEROBOT_DIRECT_TELEOP_PATHS.start,
      buildOperatorLeRobotDirectTeleopStartPayload(request),
      "LeRobot direct teleop start",
      browserToken,
      authorization,
    ),
  );

export const stopOperatorLeRobotDirectTeleop = async (
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
): Promise<OperatorLeRobotDirectTeleopStatus> =>
  normalizeOperatorLeRobotDirectTeleopStatus(
    await postOperatorJson<unknown>(
      baseUrl,
      OPERATOR_HELPER_LEROBOT_DIRECT_TELEOP_PATHS.stop,
      {},
      "LeRobot direct teleop stop",
      browserToken,
      authorization,
    ),
  );

const buildOperatorLeRobotDirectTeleopStartPayload = (
  request: OperatorLeRobotDirectTeleopStartRequest,
): Record<string, unknown> => ({
  operator_id: request.operatorId,
  leader: buildOperatorLeaderReleasePayload(request.leader),
  ...(Number.isFinite(request.fps) ? { fps: request.fps } : {}),
});
