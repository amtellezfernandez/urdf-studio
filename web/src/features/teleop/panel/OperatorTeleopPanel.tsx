import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import {
  OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
  fetchOperatorGatewayEnvConfig,
  fetchOperatorLeRobotCalibrationCatalog,
  fetchOperatorLeaderDetection,
  fetchOperatorLeaderState,
  fetchOperatorPointCloud,
  fetchOperatorProviderManifest,
  fetchOperatorSession,
  fetchOperatorStats,
  fetchOperatorState,
  openOperatorGatewayEnvConfigFile,
  releaseOperatorControlLease,
  releaseOperatorControlLeaseKeepalive,
  releaseOperatorFollowerHardware,
  releaseOperatorFollowerHardwareKeepalive,
  releaseOperatorLeaderHardware,
  releaseOperatorLeaderHardwareKeepalive,
  requestOperatorControlLease,
  saveOperatorGatewayEnvConfig,
  sendOperatorOpenArmCalibrationJogCommand,
  sendOperatorStopCommand,
  sendOperatorStopCommandKeepalive,
  startOperatorFollowerCalibration,
  startOperatorLeaderCalibration,
  type OperatorCollaborationAuthorization,
  type OperatorLeaderDevice,
  type OperatorLeaderDetection,
  type OperatorLeaderReleaseRequest,
  type OperatorPointCloudFrame,
  type OperatorHardwareMotionSafetyStatus,
  type OperatorLeRobotCalibrationCatalog,
  type OperatorLeRobotCalibrationStartResult,
  type OperatorProviderManifest,
  type OperatorSessionSnapshot,
  type OperatorStatsSnapshot,
} from "@/features/teleop/transport/operatorHelperApi";
import type {
  OperatorJointJogCommand,
  OperatorTwistCommand,
} from "@/features/teleop/contracts/operatorControlTypes";
import { cn } from "@/shared/lib/utils";
import {
  applyJointDataZeroOffset,
  resolveJointDataZeroReference,
} from "@/shared/lib/jointDataZero";
import {
  OPERATOR_HELPER_DEFAULT_OPERATOR_ID,
  OPERATOR_HELPER_DIRECTION_NEGATIVE,
  OPERATOR_HELPER_DIRECTION_POSITIVE,
  OPERATOR_HELPER_JOINT_JOG_STEP_MAX_RAD,
  OPERATOR_HELPER_JOINT_JOG_STEP_MIN_RAD,
  OPERATOR_HELPER_JOINT_JOG_STEP_RAD,
  OPERATOR_HELPER_LINEAR_SPEED_MAX_MPS,
  OPERATOR_HELPER_LINEAR_SPEED_MIN_MPS,
  OPERATOR_HELPER_LINEAR_SPEED_STEP_MPS,
  OPERATOR_HELPER_OPENARM_FINGER_JOINT_NAME_TOKEN,
  OPERATOR_HELPER_POLL_INTERVAL_MS,
  OPERATOR_HELPER_POINT_CLOUD_POLL_INTERVAL_MS,
  OPERATOR_HELPER_TELEMETRY_POLLING,
  OPERATOR_HELPER_STOP_TWIST,
  OPERATOR_HELPER_TWIST_ZERO,
  OPERATOR_HELPER_YAW_SPEED_MAX_RPS,
  OPERATOR_HELPER_YAW_SPEED_MIN_RPS,
  OPERATOR_HELPER_YAW_SPEED_STEP_RPS,
  OPERATOR_LIVE_CAMERA_ALPHA_CHANNEL_OFFSET,
  OPERATOR_LIVE_CAMERA_ALPHA_CHANNEL_VALUE,
  OPERATOR_LIVE_CAMERA_BLUE_CHANNEL_OFFSET,
  OPERATOR_LIVE_CAMERA_CANVAS_STREAM_FPS,
  OPERATOR_LIVE_CAMERA_COLOR_MAX,
  OPERATOR_LIVE_CAMERA_GREEN_CHANNEL_OFFSET,
  OPERATOR_LIVE_CAMERA_RED_CHANNEL_OFFSET,
  OPERATOR_LIVE_CAMERA_RGBA_COMPONENTS,
  OPERATOR_LIVE_CAMERA_RGB_COMPONENTS,
  OPERATOR_LIVE_JOINT_TELEMETRY_PRECISION,
  OPERATOR_HARDWARE_IK_COMMAND,
  OPERATOR_LEADER_STATE_POLL_INTERVAL_MS,
  OPERATOR_LEADER_STATE_ERROR_VISIBILITY,
  OPERATOR_OPENARM_CALIBRATION_JOG,
  OPERATOR_OPENARM_FOLLOWER,
  OPERATOR_OPENARM_MINI_TELEOPERATOR_TYPE,
  OPERATOR_TELEOP_ADAPTER_IDS,
  OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
} from "@/features/teleop/params/operatorTeleopParams";
import {
  OPERATOR_TELEOP_PANEL_COPY,
  OPERATOR_TELEOP_PANEL_FALLBACK_COPY,
} from "@/features/teleop/params/operatorTeleopUiCopy";
import {
  buildFollowerHardwareTargetOptions,
  isFollowerArmPartProfile,
  type OperatorFollowerTargetOption,
  resolveAssignedFollowerHardwareProfile,
  resolveBlockedOperatorControlMessage,
  resolveFollowerHardwareProfile,
  resolveFollowerHardwareConnectDisabled,
  resolveFollowerHardwareMotionSafetyLabel,
} from "@/features/teleop/panel/operatorFollowerConnectionPolicy";
import { OperatorFollowerConnectionCard } from "@/features/teleop/panel/OperatorFollowerConnectionCard";
import {
  OPERATOR_LEROBOT_CALIBRATION_MESSAGES,
  buildOperatorLeRobotCalibrationOptions,
  findOperatorLeRobotCalibrationOption,
  findOperatorLeRobotCalibrationOptionBySource,
  shouldConfirmOperatorLeRobotCalibrationSource,
} from "@/features/teleop/panel/operatorLeRobotCalibrationCatalog";
import {
  readOperatorTeleopPanelState,
  writeOperatorTeleopPanelState,
} from "@/features/teleop/panel/operatorTeleopPanelPersistence";
import {
  OPERATOR_CALIBRATION_UI_COPY,
  OPERATOR_CALIBRATION_UI_KEYS,
  beginOperatorCalibrationUi,
  createOperatorCalibrationUiState,
  failOperatorCalibrationUi,
  finishOperatorCalibrationUi,
  isOperatorCalibrationUiActive,
  readOperatorCalibrationUiEntry,
  resolveOperatorCalibrationErrorMessage,
  resolveOperatorCalibrationResultMessage,
  type OperatorCalibrationUiCopy,
} from "@/features/teleop/panel/operatorCalibrationUi";
import {
  OperatorCalibrationFileEditControls,
  type OperatorCalibrationFileEditMotionRow,
} from "@/features/teleop/panel/OperatorCalibrationFileEditControls";
import {
  findCalibrationCatalogEntryBySource,
  findCalibrationCatalogEntryForLeaderControlPart,
  useOperatorCalibrationFileEdit,
  type OperatorCalibrationFileEditMotorRow,
} from "@/features/teleop/panel/useOperatorCalibrationFileEdit";
import { applyCalibrationFileEditLeaderTelemetryOverride } from "@/features/teleop/panel/operatorCalibrationFileEditTelemetry";
import {
  applyProfileCapabilities,
  getOperatorStatusMessage,
  isOpenArmDemoRobot,
} from "@/features/teleop/panel/operatorTeleopPanelHelpers";
import { useOperatorLeRobotDirectTeleop } from "@/features/teleop/panel/useOperatorLeRobotDirectTeleop";
import { createOperatorCommandQueue } from "@/features/teleop/operator-control/operatorCommandQueue";
import {
  OPERATOR_LEADER_TELEOP_UNAVAILABLE_STATUS,
  useOperatorLeaderTeleopStore,
} from "@/features/teleop/operator-control/operatorLeaderTeleopStore";
import { isOperatorTeleopEditableKeyboardTarget } from "@/features/teleop/operator-control/operatorTeleopKeyboard";
import {
  addPageVisibilityListener,
  isPageVisible,
  startVisiblePageInterval,
} from "@/shared/lib/pageVisibility";
import {
  clampOperatorProfileSpeed,
  getOperatorTeleoperationModeLabel,
  getOperatorTeleopProfile,
  resolveOperatorTeleoperationMode,
  type OperatorTeleopControlInput,
  type OperatorTeleoperationMode,
  type OperatorTeleopProfile,
  type OperatorTeleopProfileId,
} from "@/features/teleop/profiles/operatorTeleopProfiles";
import {
  buildOperatorTeleopControlGroups,
  type OperatorTeleopControlGroup,
} from "@/features/teleop/profiles/operatorTeleopControlGroups";
import {
  useOperatorPerceptionStore,
  type OperatorLiveJointTelemetry,
} from "@/features/teleop/perception/operatorPerceptionStore";
import { buildOperatorGatewayJointTelemetry } from "@/features/teleop/perception/operatorGatewayTelemetry";
import { useCameraStore } from "@/shared/store/useCameraStore";
import {
  startOpenArmHfLiveObserve,
  stopOpenArmHfLiveObserve,
  type OpenArmHfLiveObserveOptions,
} from "@/features/teleop/perception/openArmHfLiveObserveClient";
import { resolveOpenArmHfLiveCameraConfigPose } from "@/features/teleop/perception/openArmHfLiveCameraConfig";
import {
  OPENARM_HF_LIVE_CAMERA_ID_PREFIX,
  OPENARM_HF_LIVE_DEPTH_TRACK_NAME,
  OPENARM_HF_LIVE_METADATA_TRACK_NAME,
  OPENARM_HF_LIVE_PATH_SEPARATOR,
  OPENARM_HF_LIVE_REAL_SENSE_POSE,
  OPENARM_HF_LIVE_SOURCE_ID,
  OPENARM_HF_LIVE_VIDEO_TRACK_NAME,
} from "@/features/teleop/perception/openArmHfLiveParams";
import {
  createOperatorControlCommandTransport,
  type OperatorControlCommandTransport,
} from "@/features/teleop/transport/operatorControlCommandTransport";
import {
  buildOperatorLiveStreamRegistrySnapshot,
  type OperatorCameraLiveStreamSource,
  type OperatorLiveStreamRegistrySnapshot,
} from "@/features/teleop/transport/operatorLiveStreamRegistry";
import {
  assignOperatorLeaderSide,
  releaseOperatorLeaderAssignment,
  writeOperatorLeaderAssignments,
  type OperatorLeaderAssignments,
  type OperatorLeaderAssignmentSide,
} from "@/features/teleop/transport/operatorLeaderAssignments";
import {
  applyOperatorLeaderTelemetryPoseReferences,
  buildMappedOperatorLeaderTelemetry,
  buildOperatorLeaderCalibrationRequest,
  buildOperatorLeaderHardwareReleaseRequest,
  buildOperatorLeaderTelemetrySourceId,
  buildOperatorLeaderTelemetryTargetReleaseRequest,
  buildOperatorLeaderTelemetryZeroOffsetKey,
  pruneOperatorLeaderTelemetryZeroOffsets,
  resolveOperatorLeaderTelemetryTargets,
  type OperatorLeaderTelemetryTarget,
  type OperatorLeaderTelemetryZeroOffsets,
} from "@/features/teleop/transport/operatorLeaderTelemetry";
import {
  buildLeaderCalibrationSetupLines,
  buildLeaderHardwareDetailLines,
  buildLeaderDeviceRoleKeys,
  findCompatibleLeaderControlPart,
  formatLeaderControlPartChoiceLabel,
  listCompatibleLeaderControlParts,
  resolveLeaderControlPartTargetCompatibility,
  resolveLeaderMappedTargetJointNames,
  resolveLeaderSideForControlGroup,
  resolveLeaderTargetCompatibility,
  resolveLeaderTargetSelection,
  resolveTeleopTargetActuatorJointNames,
} from "@/features/teleop/transport/operatorLeaderConnectionPolicy";
import {
  assignOperatorDeviceRoleForKeys,
  buildOperatorProfileDeviceKey,
  buildOperatorProfileDeviceKeys,
  readOperatorDeviceRoleAssignments,
  releaseOperatorDeviceRoleForKeys,
  type OperatorDeviceRole,
  writeOperatorDeviceRoleAssignments,
} from "@/features/teleop/transport/operatorDeviceRoleAssignments";
import { operatorRobotModelIdsMatch } from "@/features/teleop/transport/operatorRobotIdentity";
import {
  resolveOperatorHardwareConnectionState,
  resolveOperatorHardwareRoleConflict,
} from "@/features/teleop/transport/operatorHardwareConnectionPolicy";
import {
  isStudioKinematicTeleopSampleDetail,
  STUDIO_KINEMATIC_TELEOP_SAMPLE_EVENT,
  type StudioKinematicTeleopSampleDetail,
} from "@/features/teleop/recording/studioKinematicTeleopEvents";
import {
  resolveFollowerHardwareJointJogCommands,
  resolveFollowerHardwareLeaderTargetChanges,
} from "@/features/teleop/panel/operatorFollowerHardwareSafety";
import { useJointStore } from "@/shared/store/useJointStore";
import type { Camera } from "@/shared/types/camera";

const KEY_BINDINGS = new Map<string, TeleopHoldControl>([
  ["KeyW", "forward"],
  ["ArrowUp", "forward"],
  ["KeyS", "backward"],
  ["ArrowDown", "backward"],
  ["KeyA", "rotate-left"],
  ["ArrowLeft", "rotate-left"],
  ["KeyD", "rotate-right"],
  ["ArrowRight", "rotate-right"],
  ["KeyQ", "strafe-left"],
  ["KeyE", "strafe-right"],
]);

const releaseStoredOperatorRoles = (roleToRelease: OperatorDeviceRole) => {
  const currentAssignments = readOperatorDeviceRoleAssignments();
  const nextAssignments = Object.fromEntries(
    Object.entries(currentAssignments).filter(
      ([, role]) => role !== roleToRelease,
    ),
  );
  if (
    Object.keys(nextAssignments).length !==
    Object.keys(currentAssignments).length
  ) {
    writeOperatorDeviceRoleAssignments(nextAssignments);
  }
  return nextAssignments;
};

const releaseStoredOperatorLeaderRoles = () =>
  releaseStoredOperatorRoles("leader");

const releaseStoredOperatorFollowerRoles = () =>
  releaseStoredOperatorRoles("follower");

const readInitialOperatorDeviceRoleAssignments = () =>
  releaseStoredOperatorFollowerRoles();

type TeleopHoldControl =
  | "forward"
  | "backward"
  | "strafe-left"
  | "strafe-right"
  | "rotate-left"
  | "rotate-right";

type OperatorTeleopPanelProps = {
  panelView?: OperatorTeleopPanelView;
  studioRobotName: string | null;
  collaborationSessionId?: string | null;
  teleopCapabilityToken?: string | null;
  collaborationOwnerToken?: string | null;
};

export type OperatorTeleopPanelView = "camera" | "studio" | "hardware";

type PendingOperatorLeaderSelection = {
  identityKey: string;
  targetGroupId: string;
  side: OperatorLeaderAssignmentSide;
};

type PendingOperatorLeaderCalibrationSetup = "pair" | "single";

type CapturableCanvasElement = HTMLCanvasElement & {
  captureStream?: (frameRate?: number) => MediaStream;
};

const controlButtonClass =
  "h-9 rounded-md border border-border/60 bg-background/60 px-2 text-[11px] text-foreground hover:bg-muted/45 disabled:cursor-not-allowed disabled:opacity-40";

const formatOpenArmLiveJointTelemetryValue = (value: number): string =>
  Number.isFinite(value)
    ? value.toFixed(OPERATOR_LIVE_JOINT_TELEMETRY_PRECISION)
    : "NaN";

type OperatorFollowerDetectedSetupTarget = {
  id: string;
  deviceKey: string;
  label: string;
  optionLabel: string;
  detailLines: string[];
  robotType: string;
  robotId: string;
  lerobotId: string;
  configJson: string | null;
  port: string | null;
};

const OPERATOR_FOLLOWER_SETUP_ENV_KEYS = {
  runtimeMode: "URDF_ROBOT_GATEWAY_RUNTIME_MODE",
  adapter: "URDF_ROBOT_GATEWAY_ADAPTER",
  robotId: "URDF_ROBOT_GATEWAY_ROBOT_ID",
  modelId: "URDF_ROBOT_GATEWAY_MODEL_ID",
  lerobotRobotType: "URDF_ROBOT_GATEWAY_LEROBOT_ROBOT_TYPE",
  lerobotPort: "URDF_ROBOT_GATEWAY_LEROBOT_PORT",
  lerobotId: "URDF_ROBOT_GATEWAY_LEROBOT_ID",
  lerobotConfigJson: "URDF_ROBOT_GATEWAY_LEROBOT_CONFIG_JSON",
} as const;

const stripOpenArmFollowerSideSuffix = (calibrationId: string): string => {
  const trimmed = calibrationId.trim();
  for (const suffix of [
    OPERATOR_OPENARM_FOLLOWER.leftCalibrationSuffix,
    OPERATOR_OPENARM_FOLLOWER.rightCalibrationSuffix,
  ]) {
    if (trimmed.endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length);
    }
  }
  return trimmed;
};

const resolveOpenArmFollowerPartSide = (
  part: OperatorLeaderDevice["controlParts"][number],
): "left" | "right" | null => {
  const group = part.calibrationGroup?.trim().toLowerCase() ?? "";
  if (group === OPERATOR_OPENARM_FOLLOWER.leftSide) return "left";
  if (group === OPERATOR_OPENARM_FOLLOWER.rightSide) return "right";
  const calibrationId = part.calibrationId?.trim().toLowerCase() ?? "";
  if (calibrationId.endsWith(OPERATOR_OPENARM_FOLLOWER.leftCalibrationSuffix)) {
    return "left";
  }
  if (calibrationId.endsWith(OPERATOR_OPENARM_FOLLOWER.rightCalibrationSuffix)) {
    return "right";
  }
  return null;
};

const quoteOperatorFollowerEnvValue = (value: string): string =>
  value.includes(" ") || value.includes("{") || value.includes("#")
    ? `'${value.replace(/'/g, "'\\''")}'`
    : value;

const buildOperatorFollowerSetupEnvContent = (
  currentContent: string,
  setup: OperatorFollowerDetectedSetupTarget,
): string => {
  const managedKeys: ReadonlySet<string> = new Set(
    Object.values(OPERATOR_FOLLOWER_SETUP_ENV_KEYS),
  );
  const keptLines = currentContent
    .split(/\r?\n/u)
    .filter((line) => {
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(
        line.trim(),
      );
      return !match || !managedKeys.has(match[1]);
    });
  while (keptLines.length > 0 && keptLines[keptLines.length - 1]?.trim() === "") {
    keptLines.pop();
  }
  const setupLines = [
    "",
    "# URDF Studio detected LeRobot robot target.",
    `${OPERATOR_FOLLOWER_SETUP_ENV_KEYS.runtimeMode}=control`,
    `${OPERATOR_FOLLOWER_SETUP_ENV_KEYS.adapter}=lerobot`,
    `${OPERATOR_FOLLOWER_SETUP_ENV_KEYS.robotId}=${setup.robotId}`,
    `${OPERATOR_FOLLOWER_SETUP_ENV_KEYS.modelId}=openarm`,
    `${OPERATOR_FOLLOWER_SETUP_ENV_KEYS.lerobotRobotType}=${setup.robotType}`,
    `${OPERATOR_FOLLOWER_SETUP_ENV_KEYS.lerobotId}=${setup.lerobotId}`,
    ...(setup.port
      ? [`${OPERATOR_FOLLOWER_SETUP_ENV_KEYS.lerobotPort}=${setup.port}`]
      : []),
    ...(setup.configJson
      ? [
          `${OPERATOR_FOLLOWER_SETUP_ENV_KEYS.lerobotConfigJson}=${quoteOperatorFollowerEnvValue(setup.configJson)}`,
        ]
      : []),
  ];
  return [...keptLines, ...setupLines].join("\n").trimStart() + "\n";
};

const buildOpenArmFollowerConfigJson = ({
  lerobotId,
  leftPort,
  rightPort,
}: {
  lerobotId: string;
  leftPort: string;
  rightPort: string;
}): string =>
  JSON.stringify({
    id: lerobotId,
    left_arm_config: {
      port: leftPort,
      side: OPERATOR_OPENARM_FOLLOWER.leftSide,
      max_relative_target: 5,
    },
    right_arm_config: {
      port: rightPort,
      side: OPERATOR_OPENARM_FOLLOWER.rightSide,
      max_relative_target: 5,
    },
  });

const buildFollowerDetectedSetupTargets = (
  detection: OperatorLeaderDetection | null,
): OperatorFollowerDetectedSetupTarget[] => {
  if (!detection) return [];
  const openArmCandidates: {
    leader: OperatorLeaderDevice;
    part: OperatorLeaderDevice["controlParts"][number];
    baseCalibrationId: string;
    side: "left" | "right";
  }[] = [];
  detection.leaders.forEach((leader) => {
    if (!leader.available) return;
    leader.controlParts.forEach((part) => {
      const side = resolveOpenArmFollowerPartSide(part);
      if (
        part.kind !== "arm" ||
        part.calibrationCategory !== "robots" ||
        part.calibrationProfile !== OPERATOR_OPENARM_FOLLOWER.robotType ||
        !part.calibrationId ||
        side === null
      ) {
        return;
      }
      openArmCandidates.push({
        leader,
        part,
        baseCalibrationId: stripOpenArmFollowerSideSuffix(part.calibrationId),
        side,
      });
    });
  });

  const byBaseCalibration = new Map<string, typeof openArmCandidates>();
  openArmCandidates.forEach((candidate) => {
    const current = byBaseCalibration.get(candidate.baseCalibrationId) ?? [];
    current.push(candidate);
    byBaseCalibration.set(candidate.baseCalibrationId, current);
  });

  return Array.from(byBaseCalibration.entries()).flatMap(
    ([baseCalibrationId, candidates]) => {
      const ports = Array.from(
        new Set(candidates.map((candidate) => candidate.leader.path)),
      ).sort();
      if (ports.length < 2) return [];
      const matchedLeft = candidates.find(
        (candidate) =>
          candidate.side === "left" &&
          candidate.part.configuredPortStatus === "matched",
      );
      const matchedRight = candidates.find(
        (candidate) =>
          candidate.side === "right" &&
          candidate.part.configuredPortStatus === "matched",
      );
      const leftPort = matchedLeft?.leader.path ?? ports[0];
      const rightPort =
        matchedRight?.leader.path ??
        ports.find((port) => port !== leftPort) ??
        null;
      if (!rightPort) return [];
      const leftPart = candidates.find(
        (candidate) =>
          candidate.side === "left" && candidate.leader.path === leftPort,
      );
      const rightPart = candidates.find(
        (candidate) =>
          candidate.side === "right" && candidate.leader.path === rightPort,
      );
      if (!leftPart || !rightPart) return [];
      const robotType = OPERATOR_OPENARM_FOLLOWER.bimanualRobotType;
      const label = `${robotType} · ${baseCalibrationId}`;
      return [
        {
          id: `detected:${robotType}:${baseCalibrationId}:${leftPort}:${rightPort}`,
          deviceKey: `${leftPort}|${rightPort}`,
          label,
          optionLabel: label,
          detailLines: [
            `Left: ${leftPort}`,
            `Right: ${rightPort}`,
            `Calibration: ${leftPart.part.calibrationId} / ${rightPart.part.calibrationId}`,
            "Left/right inferred from serial order.",
          ],
          robotType,
          robotId: "openarm",
          lerobotId: baseCalibrationId,
          configJson: buildOpenArmFollowerConfigJson({
            lerobotId: baseCalibrationId,
            leftPort,
            rightPort,
          }),
          port: null,
        },
      ];
    },
  );
};

const buildFollowerHardwareDetectedTargets = (
  detection: OperatorLeaderDetection | null,
): {
  id: string;
  label: string;
  detailLines: readonly string[];
}[] => {
  const setupTargets = buildFollowerDetectedSetupTargets(detection);
  if (setupTargets.length > 0) {
    return setupTargets.map((target) => ({
      id: target.id,
      label: target.label,
      detailLines: target.detailLines,
    }));
  }
  if (!detection) return [];
  return detection.leaders.flatMap((leader) => {
    const robotParts = leader.controlParts.filter(
      (part) =>
        part.kind === "arm" &&
        part.actuatorCount > 0 &&
        part.calibrationCategory === "robots",
    );
    if (robotParts.length > 0) {
      return robotParts.map((part) => {
        const calibrationLabel = [
          part.calibrationProfile,
          part.calibrationId,
          part.calibrationGroup,
        ]
          .filter(Boolean)
          .join(" · ");
        const detailLines = [
          `Port: ${leader.path}`,
          `${part.actuatorCount} actuators`,
          part.configuredPortStatus === "matched"
            ? "LeRobot port matches this robot"
            : part.configuredPortStatus === "stale"
              ? "LeRobot configured port is missing"
              : part.configuredPortStatus === "unmatched"
                ? "LeRobot port differs from this robot"
                : null,
        ].filter((line): line is string => Boolean(line));
        return {
          id: `${leader.identityKey}:${part.id}`,
          label: calibrationLabel || part.label || "LeRobot robot",
          detailLines,
        };
      });
    }
    if (leader.motorCount <= 0) return [];
    return [
      {
        id: `${leader.identityKey}:motor-chain`,
        label: "Uncalibrated motor chain",
        detailLines: [
          `Port: ${leader.path}`,
          `${leader.motorCount} motors`,
          "No LeRobot robot calibration match",
        ],
      },
    ];
  });
};

const buildOperatorCalibrationFileEditMotionRows = ({
  motorRows,
  telemetryByName,
}: {
  motorRows: readonly OperatorCalibrationFileEditMotorRow[];
  telemetryByName: Record<string, OperatorLiveJointTelemetry>;
}): OperatorCalibrationFileEditMotionRow[] => {
  const telemetryByMotorId = new Map<number, OperatorLiveJointTelemetry>();
  Object.values(telemetryByName).forEach((telemetry) => {
    if (Number.isInteger(telemetry.motorId) && telemetry.motorId > 0) {
      telemetryByMotorId.set(telemetry.motorId, telemetry);
    }
  });
  return motorRows.map((row) => {
    const telemetry =
      row.motorId !== null
        ? telemetryByMotorId.get(row.motorId) ?? telemetryByName[row.jointName]
        : telemetryByName[row.jointName];
    const positionRad =
      telemetry && Number.isFinite(telemetry.positionRad)
        ? telemetry.positionRad
        : null;
    return {
      ...row,
      positionRad,
      targetJointName: null,
    };
  });
};

const assignOperatorCalibrationFileEditTargetJointNames = ({
  motionRows,
  sourceJointNames,
  targetJointNames,
}: {
  motionRows: readonly OperatorCalibrationFileEditMotionRow[];
  sourceJointNames: readonly string[];
  targetJointNames: readonly string[];
}): OperatorCalibrationFileEditMotionRow[] => {
  const targetJointNameBySourceJointName = new Map<string, string>();
  sourceJointNames.forEach((sourceJointName, index) => {
    const targetJointName = targetJointNames[index];
    if (targetJointName) {
      targetJointNameBySourceJointName.set(sourceJointName, targetJointName);
    }
  });
  return motionRows.map((row) => ({
    ...row,
    targetJointName:
      targetJointNameBySourceJointName.get(row.jointName) ?? row.targetJointName,
  }));
};

const waitFollowerHardwareCommandTick = (commandTickMs: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, commandTickMs);
  });

const buildTwist = (
  heldControls: Set<TeleopHoldControl>,
  linearSpeedMps: number,
  yawSpeedRps: number,
): OperatorTwistCommand => ({
  x:
    ((heldControls.has("forward")
      ? OPERATOR_HELPER_DIRECTION_POSITIVE
      : OPERATOR_HELPER_TWIST_ZERO) +
      (heldControls.has("backward")
        ? OPERATOR_HELPER_DIRECTION_NEGATIVE
        : OPERATOR_HELPER_TWIST_ZERO)) *
    linearSpeedMps,
  y:
    ((heldControls.has("strafe-right")
      ? OPERATOR_HELPER_DIRECTION_POSITIVE
      : OPERATOR_HELPER_TWIST_ZERO) +
      (heldControls.has("strafe-left")
        ? OPERATOR_HELPER_DIRECTION_NEGATIVE
        : OPERATOR_HELPER_TWIST_ZERO)) *
    linearSpeedMps,
  omega:
    ((heldControls.has("rotate-left")
      ? OPERATOR_HELPER_DIRECTION_POSITIVE
      : OPERATOR_HELPER_TWIST_ZERO) +
      (heldControls.has("rotate-right")
        ? OPERATOR_HELPER_DIRECTION_NEGATIVE
        : OPERATOR_HELPER_TWIST_ZERO)) *
    yawSpeedRps,
});

const hasMotion = (twist: OperatorTwistCommand): boolean =>
  Math.abs(twist.x) > OPERATOR_HELPER_TWIST_ZERO ||
  Math.abs(twist.y) > OPERATOR_HELPER_TWIST_ZERO ||
  Math.abs(twist.omega) > OPERATOR_HELPER_TWIST_ZERO;

const hasFreshFollowerTelemetryForMotion = (
  telemetryByName: Record<string, OperatorLiveJointTelemetry>,
  controlledJointNames: readonly string[],
  nowMs: number,
): boolean => {
  const checkedJointNames = controlledJointNames.filter(
    (jointName) =>
      !jointName.includes(OPERATOR_HELPER_OPENARM_FINGER_JOINT_NAME_TOKEN),
  );
  if (checkedJointNames.length === 0) return false;
  return checkedJointNames.every((jointName) => {
    const telemetry = telemetryByName[jointName];
    return (
      telemetry !== undefined &&
      Number.isFinite(telemetry.positionRad) &&
      Number.isFinite(telemetry.sourceTsMs) &&
      nowMs - telemetry.sourceTsMs <=
        OPERATOR_HARDWARE_IK_COMMAND.maxFollowerTelemetryAgeMs
    );
  });
};

const getOpenArmCalibrationTestJointNames = (
  controlledJointNames: readonly string[],
): string[] =>
  controlledJointNames.filter(
    (jointName) =>
      !jointName.includes(OPERATOR_HELPER_OPENARM_FINGER_JOINT_NAME_TOKEN),
  );

const waitOpenArmCalibrationTestPause = (): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, OPERATOR_OPENARM_CALIBRATION_JOG.testPauseMs);
  });

const formatTwist = (twist: OperatorTwistCommand): string =>
  `x ${twist.x.toFixed(2)} y ${twist.y.toFixed(2)} yaw ${twist.omega.toFixed(2)}`;

const getOperatorErrorMessage = (
  error: unknown,
  fallbackMessage: string,
): string => (error instanceof Error ? error.message : fallbackMessage);

const clampLiveCameraColorChannel = (value: number): number =>
  Math.max(
    0,
    Math.min(OPERATOR_LIVE_CAMERA_COLOR_MAX, Math.round(value * OPERATOR_LIVE_CAMERA_COLOR_MAX)),
  );

const readLiveCameraColorChannel = (
  frame: OperatorPointCloudFrame,
  pixelIndex: number,
  channelOffset: number,
): number => {
  const flatColors = frame.colorsRgbFlat;
  if (flatColors) {
    const flatOffset = pixelIndex * OPERATOR_LIVE_CAMERA_RGB_COMPONENTS + channelOffset;
    return flatColors[flatOffset] ?? 0;
  }
  return frame.colorsRgb[pixelIndex]?.[channelOffset] ?? 0;
};

const drawPointCloudColorFrameToCanvas = (
  frame: OperatorPointCloudFrame,
  canvas: HTMLCanvasElement,
): boolean => {
  const width = Math.round(frame.intrinsics.width);
  const height = Math.round(frame.intrinsics.height);
  if (width <= 0 || height <= 0) return false;

  const pixelCount = width * height;
  const framePointCount =
    typeof frame.pointCount === "number"
      ? frame.pointCount
      : frame.colorsRgbFlat
        ? Math.floor(frame.colorsRgbFlat.length / OPERATOR_LIVE_CAMERA_RGB_COMPONENTS)
        : frame.colorsRgb.length;
  const colorCount = Math.min(pixelCount, framePointCount);
  if (colorCount <= 0) return false;

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return false;
  if (typeof ImageData === "undefined") return false;

  const pixels = new Uint8ClampedArray(
    pixelCount * OPERATOR_LIVE_CAMERA_RGBA_COMPONENTS,
  );
  for (let pixelIndex = 0; pixelIndex < colorCount; pixelIndex += 1) {
    const rgbaOffset = pixelIndex * OPERATOR_LIVE_CAMERA_RGBA_COMPONENTS;
    pixels[rgbaOffset + OPERATOR_LIVE_CAMERA_RED_CHANNEL_OFFSET] =
      clampLiveCameraColorChannel(
        readLiveCameraColorChannel(
          frame,
          pixelIndex,
          OPERATOR_LIVE_CAMERA_RED_CHANNEL_OFFSET,
        ),
      );
    pixels[rgbaOffset + OPERATOR_LIVE_CAMERA_GREEN_CHANNEL_OFFSET] =
      clampLiveCameraColorChannel(
        readLiveCameraColorChannel(
          frame,
          pixelIndex,
          OPERATOR_LIVE_CAMERA_GREEN_CHANNEL_OFFSET,
        ),
      );
    pixels[rgbaOffset + OPERATOR_LIVE_CAMERA_BLUE_CHANNEL_OFFSET] =
      clampLiveCameraColorChannel(
        readLiveCameraColorChannel(
          frame,
          pixelIndex,
          OPERATOR_LIVE_CAMERA_BLUE_CHANNEL_OFFSET,
        ),
      );
    pixels[rgbaOffset + OPERATOR_LIVE_CAMERA_ALPHA_CHANNEL_OFFSET] =
      OPERATOR_LIVE_CAMERA_ALPHA_CHANNEL_VALUE;
  }
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
  return true;
};

const trimOpenArmHfLivePath = (path: string | null | undefined): string =>
  path?.trim().replace(/^\/+|\/+$/g, "") ?? "";

const openArmHfLiveTrackNamesAreDefault = (
  videoTrackName: string,
  depthTrackName: string,
  metadataTrackName: string,
): boolean =>
  videoTrackName === OPENARM_HF_LIVE_VIDEO_TRACK_NAME &&
  depthTrackName === OPENARM_HF_LIVE_DEPTH_TRACK_NAME &&
  metadataTrackName === OPENARM_HF_LIVE_METADATA_TRACK_NAME;

const stripOpenArmHfLiveTrackSuffix = (
  trackName: string,
  suffix: string,
): string | null => {
  const normalizedTrackName = trimOpenArmHfLivePath(trackName);
  const normalizedSuffix = `${OPENARM_HF_LIVE_PATH_SEPARATOR}${suffix}`;
  return normalizedTrackName.endsWith(normalizedSuffix)
    ? normalizedTrackName.slice(0, -normalizedSuffix.length)
    : null;
};

const resolveOpenArmHfLiveRealSenseSourceTransport = (
  cameraSource: OperatorCameraLiveStreamSource,
  namespace: string,
): Pick<
  NonNullable<OpenArmHfLiveObserveOptions["realSenseSources"]>[number],
  "namespace" | "path" | "trackNames"
> | null => {
  const videoTrackName = trimOpenArmHfLivePath(
    cameraSource.videoTrack?.trackName,
  );
  const depthTrackName = trimOpenArmHfLivePath(
    cameraSource.depthTrack?.trackName,
  );
  const metadataTrackName = trimOpenArmHfLivePath(
    cameraSource.metadataTrack?.trackName,
  );
  if (!videoTrackName || !depthTrackName || !metadataTrackName) return null;

  if (
    namespace &&
    openArmHfLiveTrackNamesAreDefault(
      videoTrackName,
      depthTrackName,
      metadataTrackName,
    )
  ) {
    return { path: namespace };
  }

  if (namespace) {
    return {
      path: "",
      namespace,
      trackNames: {
        video: videoTrackName,
        depth: depthTrackName,
        metadata: metadataTrackName,
      },
    };
  }

  const videoSourcePath = stripOpenArmHfLiveTrackSuffix(
    videoTrackName,
    OPENARM_HF_LIVE_VIDEO_TRACK_NAME,
  );
  const depthSourcePath = stripOpenArmHfLiveTrackSuffix(
    depthTrackName,
    OPENARM_HF_LIVE_DEPTH_TRACK_NAME,
  );
  const metadataSourcePath = stripOpenArmHfLiveTrackSuffix(
    metadataTrackName,
    OPENARM_HF_LIVE_METADATA_TRACK_NAME,
  );
  if (
    videoSourcePath &&
    videoSourcePath === depthSourcePath &&
    videoSourcePath === metadataSourcePath
  ) {
    return { path: videoSourcePath };
  }

  return null;
};

const buildOpenArmHfLiveObserveOptions = (
  manifest: OperatorProviderManifest | null,
  liveStreamRegistry: OperatorLiveStreamRegistrySnapshot,
  cameraConfigs: readonly Camera[],
): OpenArmHfLiveObserveOptions | undefined => {
  const liveTransport = manifest?.liveTransport;
  const relayUrl = liveTransport?.relayUrl.trim();
  if (!liveTransport || !relayUrl) return undefined;

  const namespace = trimOpenArmHfLivePath(liveTransport.namespace);
  const realSenseSources = liveStreamRegistry.cameras.flatMap((cameraSource) => {
    const transport = resolveOpenArmHfLiveRealSenseSourceTransport(
      cameraSource,
      namespace,
    );
    if (!transport) return [];
    return [
      {
        id: `${OPENARM_HF_LIVE_SOURCE_ID}_${cameraSource.camera.id}`,
        cameraId:
          cameraSource.camera.id ||
          `${OPENARM_HF_LIVE_CAMERA_ID_PREFIX}${cameraSource.camera.frameId}`,
        label: cameraSource.camera.label,
        pose:
          resolveOpenArmHfLiveCameraConfigPose(
            cameraConfigs,
            cameraSource.camera.id,
          ) ??
          cameraSource.camera.cameraPose ??
          OPENARM_HF_LIVE_REAL_SENSE_POSE,
        ...transport,
      },
    ];
  });

  return realSenseSources.length > 0
    ? {
        relayUrl,
        realSenseSources,
      }
    : undefined;
};

const buildOpenArmHfLiveObserveOptionsKey = (
  options: OpenArmHfLiveObserveOptions | undefined,
): string => JSON.stringify(options ?? null);

export const OperatorTeleopPanel = ({
  panelView = "hardware",
  studioRobotName,
  collaborationSessionId = null,
  teleopCapabilityToken = null,
  collaborationOwnerToken = null,
}: OperatorTeleopPanelProps) => {
  const showCameraTools = panelView === "camera" || panelView === "hardware";
  const showCameraLiveTools = panelView === "camera";
  const showStudioTeleopTools = panelView === "studio";
  const showFollowerHardwareTools = panelView === "hardware";
  const showTeleopConnectionTools =
    showStudioTeleopTools || showFollowerHardwareTools;
  const initialPanelState = useMemo(() => readOperatorTeleopPanelState(), []);
  const initialProviderManifest =
    initialPanelState.providerManifestBaseUrl === initialPanelState.baseUrl
      ? initialPanelState.providerManifest
      : null;
  const [baseUrl, setBaseUrl] = useState(initialPanelState.baseUrl);
  const [providerManifest, setProviderManifest] =
    useState<OperatorProviderManifest | null>(initialProviderManifest);
  const [providerManifestResolved, setProviderManifestResolved] =
    useState(false);
  const [openArmLeaderDetection, setOpenArmLeaderDetection] =
    useState<OperatorLeaderDetection | null>(null);
  const [openArmLeaderDetectionResolved, setOpenArmLeaderDetectionResolved] =
    useState(false);
  const [openArmLeaderDetectionError, setOpenArmLeaderDetectionError] =
    useState<string | null>(null);
  const [openArmLeaderDetectionRequested, setOpenArmLeaderDetectionRequested] =
    useState(false);
  const [openArmLeaderStateError, setOpenArmLeaderStateError] =
    useState<string | null>(null);
  const openArmLeaderStateErrorVisibilityRef = useRef({
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
  });
  const [openArmLeaderLiveJointCount, setOpenArmLeaderLiveJointCount] =
    useState(0);
  const [operatorLeaderAssignments, setOperatorLeaderAssignments] =
    useState<OperatorLeaderAssignments>({});
  const [pendingOperatorLeaderSelection, setPendingOperatorLeaderSelection] =
    useState<PendingOperatorLeaderSelection | null>(null);
  const [
    pendingOperatorLeaderControlPartIds,
    setPendingOperatorLeaderControlPartIds,
  ] = useState<Record<string, string>>({});
  const [
    pendingOperatorLeaderCalibrationSetups,
    setPendingOperatorLeaderCalibrationSetups,
  ] = useState<Record<string, PendingOperatorLeaderCalibrationSetup>>({});
  const [operatorDeviceRoleAssignments, setOperatorDeviceRoleAssignments] =
    useState(readInitialOperatorDeviceRoleAssignments);
  const [selectedProfileId, setSelectedProfileId] =
    useState<OperatorTeleopProfileId | null>(
      initialPanelState.selectedProfileId,
    );
  const [selectedFollowerProfileId, setSelectedFollowerProfileId] =
    useState<OperatorTeleopProfileId | null>(
      initialPanelState.selectedFollowerProfileId,
    );
  const [
    connectedFollowerHardwareDeviceKey,
    setConnectedFollowerHardwareDeviceKey,
  ] = useState<string | null>(null);
  const [session, setSession] = useState<OperatorSessionSnapshot | null>(null);
  const [stats, setStats] = useState<OperatorStatsSnapshot | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    "Checking status endpoint.",
  );
  const setPanelStatusMessage = useCallback((message: string) => {
    if (isMountedRef.current) {
      setStatusMessage(message);
    }
  }, []);
  const [operatorId, setOperatorId] = useState(initialPanelState.operatorId);
  const [requestedTeleoperationMode, setRequestedTeleoperationMode] =
    useState<OperatorTeleoperationMode>(
      initialPanelState.requestedTeleoperationMode,
    );
  const [followerHardwareConnectionSelected, setFollowerHardwareConnectionSelected] =
    useState(false);
  const [followerHardwareMotionSafety, setFollowerHardwareMotionSafety] =
    useState<OperatorHardwareMotionSafetyStatus | null>(null);
  const [followerEnvConfigPath, setFollowerEnvConfigPath] =
    useState<string | null>(null);
  const [followerEnvConfigOpening, setFollowerEnvConfigOpening] =
    useState(false);
  const [followerEnvConfigError, setFollowerEnvConfigError] =
    useState<string | null>(null);
  const [followerDetectedSetupApplying, setFollowerDetectedSetupApplying] =
    useState(false);
  const [lerobotCalibrationCatalog, setLerobotCalibrationCatalog] =
    useState<OperatorLeRobotCalibrationCatalog>({
      activeSource: null,
      entries: [],
    });
  const [lerobotCalibrationCatalogError, setLerobotCalibrationCatalogError] =
    useState<string | null>(null);
  const [
    followerCalibrationShowAllSources,
    setFollowerCalibrationShowAllSources,
  ] = useState(false);
  const [
    selectedFollowerCalibrationSourceId,
    setSelectedFollowerCalibrationSourceId,
  ] = useState<string | null>(null);
  const [calibrationUi, setCalibrationUi] = useState(
    createOperatorCalibrationUiState,
  );
  const followerAuthoritativeFeedbackReadyAtMsRef = useRef(0);
  const [leaseBusy, setLeaseBusy] = useState(false);
  const [lastPreviewTwist, setLastPreviewTwist] =
    useState<OperatorTwistCommand>(OPERATOR_HELPER_STOP_TWIST);
  const [linearSpeedMps, setLinearSpeedMps] = useState(
    initialPanelState.linearSpeedMps,
  );
  const [yawSpeedRps, setYawSpeedRps] = useState(
    initialPanelState.yawSpeedRps,
  );
  const [selectedJointJogName, setSelectedJointJogName] = useState(
    initialPanelState.selectedJointJogName,
  );
  const [selectedCameraStreamId, setSelectedCameraStreamId] = useState(
    initialPanelState.selectedCameraStreamId,
  );
  const [jointJogStepRad, setJointJogStepRad] = useState(
    initialPanelState.jointJogStepRad,
  );
  const [jointJogBusy, setJointJogBusy] = useState(false);
  const [
    openArmDemoLiveObserveManuallyDisconnected,
    setOpenArmDemoLiveObserveManuallyDisconnected,
  ] = useState(false);
  const [
    calibrationFileEditLeaderTelemetryRequested,
    setCalibrationFileEditLeaderTelemetryRequested,
  ] = useState(false);
  const heldControlsRef = useRef(new Set<TeleopHoldControl>());
  const controlIntervalRef = useRef<number | null>(null);
  const commandTransportRef = useRef<OperatorControlCommandTransport | null>(
    null,
  );
  const gatewayCameraCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gatewayCameraVideoStreamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef(true);
  const followerHardwareTargetDispatchInFlightRef = useRef(false);
  const followerHardwareQueuedTargetsRef = useRef<Record<string, number> | null>(
    null,
  );
  const sendFollowerHardwareJointTargetsRef = useRef<
    ((jointTargets: Record<string, number>) => Promise<void>) | null
  >(null);
  const followerHardwareCommandTickMsRef = useRef<number | null>(null);
  const lastLeaderJointTargetsRef = useRef<Record<string, number> | null>(null);
  const leaderTelemetryZeroOffsetsRef =
    useRef<OperatorLeaderTelemetryZeroOffsets>({});
  const staleStoredLeaderRoleCleanupDoneRef = useRef(false);
  const leaderHardwareAssignedRef = useRef(false);
  const baseUrlRef = useRef(baseUrl);
  const operatorIdRef = useRef(operatorId);
  const selectedProfileIdRef = useRef<OperatorTeleopProfileId | null>(null);
  const followerHardwareConnectedRef = useRef(false);
  const leaseHeldByThisOperatorRef = useRef(false);
  const collaborationTeleopAuthorizationRef =
    useRef<OperatorCollaborationAuthorization | null>(null);
  const collaborationTeleopAuthorization =
    useMemo<OperatorCollaborationAuthorization | null>(() => {
      if (
        !collaborationSessionId ||
        (!teleopCapabilityToken && !collaborationOwnerToken)
      ) {
        return null;
      }
      return {
        sessionId: collaborationSessionId,
        teleopCapabilityToken,
        ownerToken: collaborationOwnerToken,
      };
    }, [collaborationOwnerToken, collaborationSessionId, teleopCapabilityToken]);
  const collaborationTeleopRequired = Boolean(collaborationSessionId);
  const collaborationTeleopPermitted =
    !collaborationTeleopRequired || Boolean(collaborationTeleopAuthorization);
  const collaborationTeleopPermitLabel = collaborationTeleopRequired
    ? collaborationTeleopAuthorization
      ? "Granted"
      : "Required"
    : "Not in collaboration";
  const setActivePointCloudFrame = useOperatorPerceptionStore(
    (state) => state.setActivePointCloudFrame,
  );
  const setLeaderTeleopStatus = useOperatorLeaderTeleopStore(
    (state) => state.setLeaderTeleopStatus,
  );
  const setStudioIkAffectsFollowerHardware = useOperatorLeaderTeleopStore(
    (state) => state.setStudioIkAffectsFollowerHardware,
  );
  const requestLeaderTeleopViewerMode = useOperatorLeaderTeleopStore(
    (state) => state.requestLeaderTeleopViewerMode,
  );
  const requestExitLeaderTeleopViewerMode = useOperatorLeaderTeleopStore(
    (state) => state.requestExitLeaderTeleopViewerMode,
  );
  const setLocalLeaderAssigned = useOperatorLeaderTeleopStore(
    (state) => state.setLocalLeaderAssigned,
  );
  const setFollowerHardwareConnected = useOperatorLeaderTeleopStore(
    (state) => state.setFollowerHardwareConnected,
  );
  const leaderTeleopViewerModeActive = useOperatorLeaderTeleopStore(
    (state) => state.viewerModeActive,
  );
  const openArmHfLiveObserveRequested = useOperatorPerceptionStore(
    (state) => state.openArmHfLiveObserveRequested,
  );
  const openArmHfLiveObserveStatus = useOperatorPerceptionStore(
    (state) => state.openArmHfLiveObserveStatus,
  );
  const activePointCloudFrameCount = useOperatorPerceptionStore(
    (state) => state.activePointCloudFrames.length,
  );
  const pointCloudAutocalibrationRequest = useOperatorPerceptionStore(
    (state) => state.pointCloudAutocalibrationRequest,
  );
  const pointCloudAutocalibrationReview = useOperatorPerceptionStore(
    (state) => state.pointCloudAutocalibrationReview,
  );
  const pointCloudSceneMeshRequest = useOperatorPerceptionStore(
    (state) => state.pointCloudSceneMeshRequest,
  );
  const pointCloudSceneMeshStatus = useOperatorPerceptionStore(
    (state) => state.pointCloudSceneMeshStatus,
  );
  const requestPointCloudAutocalibration = useOperatorPerceptionStore(
    (state) => state.requestPointCloudAutocalibration,
  );
  const requestPointCloudSceneMeshes = useOperatorPerceptionStore(
    (state) => state.requestPointCloudSceneMeshes,
  );
  const acceptPointCloudAutocalibration = useOperatorPerceptionStore(
    (state) => state.acceptPointCloudAutocalibration,
  );
  const discardPointCloudAutocalibration = useOperatorPerceptionStore(
    (state) => state.discardPointCloudAutocalibration,
  );
  const openArmLiveJointTelemetryByName = useOperatorPerceptionStore(
    (state) => state.activeFollowerJointTelemetryByName,
  );
  const openArmLeaderLiveJointTelemetryByName = useOperatorPerceptionStore(
    (state) => state.activeLeaderJointTelemetryByName,
  );
  const openArmLiveJointTelemetryRows = useMemo(
    () =>
      Object.entries(openArmLiveJointTelemetryByName).sort(
        ([leftName], [rightName]) => leftName.localeCompare(rightName),
      ),
    [openArmLiveJointTelemetryByName],
  );
  const availableStudioJointNames = useJointStore((state) => state.availableJoints);
  const studioJointTopologyByName = useJointStore(
    (state) => state.jointTopologyByName,
  );
  const studioTeleopControlGroups = useMemo(
    () =>
      buildOperatorTeleopControlGroups({
        jointNames: availableStudioJointNames,
        jointTopologyByName: studioJointTopologyByName,
      }),
    [availableStudioJointNames, studioJointTopologyByName],
  );
  const commandQueue = useMemo(
    () =>
      createOperatorCommandQueue({
        send: (twist, metadata) => {
          const transport = commandTransportRef.current;
          if (!transport) {
            throw new Error("Operator command transport is not ready.");
          }
          return metadata.command_kind === "stop"
            ? transport.sendStop(metadata)
            : transport.sendTwist(twist, metadata);
        },
      }),
    [],
  );
  const stopControlTimer = useCallback(() => {
    if (controlIntervalRef.current === null) return;
    window.clearInterval(controlIntervalRef.current);
    controlIntervalRef.current = null;
  }, []);
  const clearActiveControls = useCallback(() => {
    heldControlsRef.current.clear();
    stopControlTimer();
  }, [stopControlTimer]);
  const active =
    session?.state === "active" && Boolean(session.current_session_id);
  const gatewayCompatibleModelRobotIds = useMemo(
    () =>
      [
        session?.model_robot_id ?? session?.robot_id ?? null,
        ...(session?.model_robot_aliases ?? []),
      ].filter((value): value is string => Boolean(value?.trim())),
    [session?.model_robot_aliases, session?.model_robot_id, session?.robot_id],
  );
  const gatewayRobotModelKnown = Boolean(
    studioRobotName && gatewayCompatibleModelRobotIds.length,
  );
  const robotModelMismatch =
    gatewayRobotModelKnown &&
    !operatorRobotModelIdsMatch(studioRobotName, gatewayCompatibleModelRobotIds);
  const providerProfiles = useMemo(
    () => providerManifest?.profiles ?? [],
    [providerManifest?.profiles],
  );
  const followerConnectionConfigRef =
    providerManifest?.connectionModes.find((mode) => mode.configRef)?.configRef ??
    null;
  const loadedRobotIsOpenArmDemo = isOpenArmDemoRobot(studioRobotName);
  const openArmLiveObserveAvailable =
    loadedRobotIsOpenArmDemo && !robotModelMismatch;
  const openArmLeaderAutodetectActive =
    (showStudioTeleopTools || showFollowerHardwareTools) &&
    openArmLeaderDetectionRequested;
  const openArmCameraObserveEligible =
    showCameraLiveTools && openArmLiveObserveAvailable;
  const openArmGatewayObserveActive =
    openArmCameraObserveEligible &&
    !openArmDemoLiveObserveManuallyDisconnected;
  const openArmCameraObserveEligibleRef = useRef(
    openArmCameraObserveEligible,
  );
  const openArmHfLiveObserveStartedRef = useRef(false);
  const openArmHfLiveObserveOptionsKeyRef = useRef<string | null>(null);
  const providerCameraStreams = useMemo(
    () => providerManifest?.cameraStreams ?? [],
    [providerManifest?.cameraStreams],
  );
  const liveStreamRegistry = useMemo(
    () => buildOperatorLiveStreamRegistrySnapshot(providerManifest),
    [providerManifest],
  );
  const cameraConfigs = useCameraStore((state) => state.cameras);
  const openArmHfLiveObserveOptions = useMemo(
    () =>
      buildOpenArmHfLiveObserveOptions(
        providerManifest,
        liveStreamRegistry,
        cameraConfigs,
      ),
    [cameraConfigs, liveStreamRegistry, providerManifest],
  );
  const openArmHfLiveObserveOptionsKey = useMemo(
    () => buildOpenArmHfLiveObserveOptionsKey(openArmHfLiveObserveOptions),
    [openArmHfLiveObserveOptions],
  );
  const selectedProfile = useMemo(
    () => getOperatorTeleopProfile(providerProfiles, selectedProfileId),
    [providerProfiles, selectedProfileId],
  );
  followerHardwareCommandTickMsRef.current =
    selectedProfile?.limits.commandTickMs ?? null;
  const availableControlInputs = useMemo(() => {
    const inputs = new Map<string, OperatorTeleopControlInput>();
    const sourceProfiles = selectedProfile ? [selectedProfile] : providerProfiles;
    sourceProfiles.forEach((profile) => {
      profile.controlInputs.forEach((input) => {
        inputs.set(`${input.kind}:${input.id || input.label}`, input);
      });
    });
    return Array.from(inputs.values());
  }, [providerProfiles, selectedProfile]);
  const advertisedLeaderArmInputs = useMemo(
    () => availableControlInputs.filter((input) => input.kind === "leader_arm"),
    [availableControlInputs],
  );
  const availableLeaderDevices = useMemo(
    () => openArmLeaderDetection?.leaders.filter((leader) => leader.available) ?? [],
    [openArmLeaderDetection?.leaders],
  );
  const baseLeaderStatePollTargets = useMemo<
    OperatorLeaderTelemetryTarget[]
  >(
    () =>
      resolveOperatorLeaderTelemetryTargets({
        leaders: availableLeaderDevices,
        assignments: operatorLeaderAssignments,
        availableJointNames: availableStudioJointNames,
        resolveFallbackTargetJointNames: (assignment) => {
          const assignedGroup = studioTeleopControlGroups.find(
            (group) => group.id === assignment.targetGroupId,
          );
          return assignedGroup
            ? resolveTeleopTargetActuatorJointNames(assignedGroup)
            : [];
        },
      }),
    [
      availableLeaderDevices,
      availableStudioJointNames,
      operatorLeaderAssignments,
      studioTeleopControlGroups,
    ],
  );
  const selectedLocalLeaderAssigned = availableLeaderDevices.some((leader) =>
    Boolean(operatorLeaderAssignments[leader.identityKey]?.side),
  );
  const followerHardwareProfile = useMemo(
    () => {
      const manuallySelectedProfile = providerProfiles.find(
        (profile) =>
          profile.id === selectedFollowerProfileId &&
          profile.teleoperationMode === OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE &&
          isFollowerArmPartProfile(profile),
      );
      if (manuallySelectedProfile) return manuallySelectedProfile;
      return (
        resolveAssignedFollowerHardwareProfile({
          profiles: providerProfiles,
          providerId: providerManifest?.providerId,
          assignments: operatorDeviceRoleAssignments,
        }) ?? resolveFollowerHardwareProfile(providerProfiles)
      );
    },
    [
      operatorDeviceRoleAssignments,
      providerManifest?.providerId,
      providerProfiles,
      selectedFollowerProfileId,
    ],
  );
  const lerobotFollowerHardwareSelected =
    followerHardwareProfile?.adapterId === OPERATOR_TELEOP_ADAPTER_IDS.lerobot;
  const selectedFollowerHardwareDeviceKey = useMemo(
    () =>
      followerHardwareProfile
        ? buildOperatorProfileDeviceKey({
            providerId: providerManifest?.providerId,
            profile: followerHardwareProfile,
          })
        : null,
    [providerManifest?.providerId, followerHardwareProfile],
  );
  const selectedFollowerHardwareDeviceKeys = useMemo(
    () =>
      followerHardwareProfile
        ? buildOperatorProfileDeviceKeys({
            providerId: providerManifest?.providerId,
            profile: followerHardwareProfile,
          })
        : [],
    [providerManifest?.providerId, followerHardwareProfile],
  );
  const followerHardwareRoleConflict = lerobotFollowerHardwareSelected
    ? null
    : resolveOperatorHardwareRoleConflict({
        assignments: operatorDeviceRoleAssignments,
        deviceKey: selectedFollowerHardwareDeviceKeys,
        requestedRole: "follower",
      });
  const connectedTeleoperationMode = useMemo(
    () =>
      selectedProfile?.teleoperationMode ??
      resolveOperatorTeleoperationMode(
        session?.teleoperation_mode,
        session?.adapter_id,
      ),
    [
      selectedProfile?.teleoperationMode,
      session?.adapter_id,
      session?.teleoperation_mode,
    ],
  );
  const requestedTeleoperationModeLabel = getOperatorTeleoperationModeLabel(
    requestedTeleoperationMode,
  );
  const connectedTeleoperationModeLabel = getOperatorTeleoperationModeLabel(
    connectedTeleoperationMode,
  );
  const selectedCameraStream = useMemo(
    () =>
      providerCameraStreams.find(
        (stream) => stream.id === selectedCameraStreamId,
      ) ??
      providerCameraStreams[0] ??
      null,
    [providerCameraStreams, selectedCameraStreamId],
  );
  const selectedCameraLiveSource = useMemo(
    () =>
      selectedCameraStream
        ? (liveStreamRegistry.cameras.find(
            (source) => source.camera.id === selectedCameraStream.id,
          ) ?? null)
        : null,
    [liveStreamRegistry.cameras, selectedCameraStream],
  );
  const selectedCameraLiveTracks = selectedCameraLiveSource?.tracks ?? [];
  const selectedCameraPointCloudTrack =
    selectedCameraLiveSource?.pointCloudTrack ?? null;
  const selectedCameraVideoTrack = selectedCameraLiveSource?.videoTrack ?? null;
  const gatewayTelemetryTrackCount = liveStreamRegistry.telemetryTrackCount;
  const cameraLiveStatusMessage = useMemo(() => {
    if (openArmGatewayObserveActive || openArmHfLiveObserveRequested) {
      return openArmHfLiveObserveStatus;
    }
    if (!providerManifest?.liveTransport)
      return "No MoQ live transport advertised.";
    if (!selectedCameraStream) return "No camera stream selected.";
    if (!selectedCameraPointCloudTrack)
      return "No MoQ point-cloud track for this camera.";
    return "MoQ point-cloud track ready.";
  }, [
    openArmGatewayObserveActive,
    openArmHfLiveObserveRequested,
    openArmHfLiveObserveStatus,
    providerManifest?.liveTransport,
    selectedCameraPointCloudTrack,
    selectedCameraStream,
  ]);
  const pointCloudAutocalibrationAvailable = activePointCloudFrameCount > 0;
  const pointCloudAutocalibrationActive = Boolean(
    pointCloudAutocalibrationRequest,
  );
  const pointCloudAutocalibrationReviewReady = Boolean(
    pointCloudAutocalibrationReview,
  );
  const pointCloudSceneMeshActive = Boolean(pointCloudSceneMeshRequest);
  const providerControlAvailable = Boolean(
    providerManifest?.capabilities.control && selectedProfile,
  );
  const estopAvailable = Boolean(
    session && providerManifest?.capabilities.estop && selectedProfile,
  );
  const selectedConcreteFollowerHardwareTarget = Boolean(
    showFollowerHardwareTools &&
      followerHardwareProfile &&
      isFollowerArmPartProfile(followerHardwareProfile),
  );
  const showGatewayLiveCameraTools = showCameraLiveTools && !robotModelMismatch;
  const showFollowerHardwareCameraSummary =
    showFollowerHardwareTools && !robotModelMismatch;
  const robotModelMismatchBlocksControl =
    active && robotModelMismatch && !selectedConcreteFollowerHardwareTarget;
  const robotModelMismatchMessage =
    studioRobotName && gatewayCompatibleModelRobotIds.length
      ? `Model mismatch. Loaded ${studioRobotName}; gateway expects ${gatewayCompatibleModelRobotIds.join(" or ")}. Load the matching robot before moving.`
      : "Model mismatch. Load the matching robot before moving.";
  const selectedProfileRequiresLease = Boolean(
    selectedProfile?.capabilities.jointJog,
  );
  const leaseHeldByThisOperator = Boolean(
    selectedProfileRequiresLease &&
    session?.control_lease_owner &&
    session.control_lease_owner === operatorId.trim(),
  );
  const leaseHeldByOtherOperator = Boolean(
    selectedProfileRequiresLease &&
    session?.control_lease_owner &&
    session.control_lease_owner !== operatorId.trim(),
  );
  const gatewayControlActive =
    providerControlAvailable &&
    active &&
    !robotModelMismatchBlocksControl &&
    requestedTeleoperationMode === connectedTeleoperationMode &&
    collaborationTeleopPermitted &&
    (!selectedProfileRequiresLease || leaseHeldByThisOperator);
  const controlEnabled = gatewayControlActive;
  const followerHardwareConnected = controlEnabled;
  const followerHardwareConnectionActive =
    followerHardwareConnected ||
    leaseHeldByThisOperator ||
    (followerHardwareConnectionSelected && !selectedProfileRequiresLease);
  const followerHardwareDisconnectAvailable = followerHardwareConnectionActive;
  const followerHardwareCommandReady = followerHardwareConnected;
  const providerFollowerHardwareTargetOptions = useMemo(
    () =>
      buildFollowerHardwareTargetOptions({
        profiles: providerProfiles,
        providerId: providerManifest?.providerId,
        assignments: lerobotFollowerHardwareSelected
          ? {}
          : operatorDeviceRoleAssignments,
        selectedProfileId: followerHardwareProfile?.id ?? null,
        connectedDeviceKey: followerHardwareConnected
          ? (connectedFollowerHardwareDeviceKey ??
            selectedFollowerHardwareDeviceKey)
          : null,
      }),
    [
      connectedFollowerHardwareDeviceKey,
      followerHardwareConnected,
      followerHardwareProfile?.id,
      lerobotFollowerHardwareSelected,
      operatorDeviceRoleAssignments,
      providerManifest?.providerId,
      providerProfiles,
      selectedFollowerHardwareDeviceKey,
    ],
  );
  const followerDetectedSetupTargets = useMemo(
    () => buildFollowerDetectedSetupTargets(openArmLeaderDetection),
    [openArmLeaderDetection],
  );
  const followerDetectedSetupTargetOptions = useMemo<OperatorFollowerTargetOption[]>(
    () =>
      followerDetectedSetupTargets.map((target) => ({
        profileId: target.id,
        deviceKey: target.deviceKey,
        label: target.label,
        optionLabel: target.optionLabel,
        detailLines: target.detailLines,
        assignedRole: null,
        status: "available",
        statusLabel: "setup",
        setupOnly: true,
        robotType: target.robotType,
      })),
    [followerDetectedSetupTargets],
  );
  const followerHardwareTargetOptions = useMemo(
    () =>
      providerFollowerHardwareTargetOptions.length > 0
        ? providerFollowerHardwareTargetOptions
        : followerDetectedSetupTargetOptions,
    [followerDetectedSetupTargetOptions, providerFollowerHardwareTargetOptions],
  );
  const selectedFollowerDetectedSetupTarget = useMemo(
    () =>
      followerHardwareProfile
        ? null
        : followerDetectedSetupTargets.find(
            (target) => target.id === selectedFollowerProfileId,
          ) ??
          followerDetectedSetupTargets[0] ??
          null,
    [
      followerDetectedSetupTargets,
      followerHardwareProfile,
      selectedFollowerProfileId,
    ],
  );
  const followerHardwareDetectedTargets = useMemo(
    () =>
      followerDetectedSetupTargets.length > 0
        ? followerDetectedSetupTargets.map((target) => ({
            id: target.id,
            label: target.label,
            detailLines: target.detailLines,
          }))
        : buildFollowerHardwareDetectedTargets(openArmLeaderDetection),
    [followerDetectedSetupTargets, openArmLeaderDetection],
  );
  const followerCalibrationAvailable =
    followerHardwareProfile?.adapterId === OPERATOR_TELEOP_ADAPTER_IDS.lerobot;
  const followerCalibrationSourceOptions = useMemo(
    () =>
      buildOperatorLeRobotCalibrationOptions({
        entries: lerobotCalibrationCatalog.entries,
        expectedActuatorCount:
          followerHardwareProfile?.controlledJointNames.length ?? 0,
        expectedModelIds: gatewayCompatibleModelRobotIds,
        expectedRobotIds: [
          session?.robot_id ?? "",
          followerHardwareProfile?.robotId ?? "",
        ],
        showAll: followerCalibrationShowAllSources,
      }),
    [
      followerCalibrationShowAllSources,
      followerHardwareProfile?.controlledJointNames.length,
      followerHardwareProfile?.robotId,
      gatewayCompatibleModelRobotIds,
      lerobotCalibrationCatalog.entries,
      session?.robot_id,
    ],
  );
  const selectedFollowerCalibrationSourceOption = useMemo(
    () =>
      findOperatorLeRobotCalibrationOption(
        followerCalibrationSourceOptions,
        selectedFollowerCalibrationSourceId,
      ),
    [followerCalibrationSourceOptions, selectedFollowerCalibrationSourceId],
  );
  const selectedFollowerCalibrationSource =
    selectedFollowerCalibrationSourceOption?.source ?? null;
  const selectedFollowerCalibrationCatalogEntry = useMemo(
    () =>
      findCalibrationCatalogEntryBySource(
        lerobotCalibrationCatalog.entries,
        selectedFollowerCalibrationSource,
    ),
    [lerobotCalibrationCatalog.entries, selectedFollowerCalibrationSource],
  );
  const {
    session: calibrationFileEditSession,
    startLeaderFileEdit: handleStartLeaderCalibrationFileEdit,
    startFollowerFileEdit: handleStartFollowerCalibrationFileEdit,
    openCalibrationFile: handleOpenCalibrationFileEditFile,
    closeCalibrationFileEdit: handleCancelCalibrationFileEdit,
  } = useOperatorCalibrationFileEdit({
    lerobotCalibrationCatalog,
    followerHardwareProfile,
    selectedFollowerHardwareDeviceKey,
    selectedFollowerCalibrationCatalogEntry,
    onStatusMessage: setPanelStatusMessage,
  });
  const handleCloseCalibrationFileEdit = useCallback(() => {
    setCalibrationFileEditLeaderTelemetryRequested(false);
    handleCancelCalibrationFileEdit();
  }, [handleCancelCalibrationFileEdit]);
  const followerCalibrationFileEditOpen =
    calibrationFileEditSession?.role === "follower";
  const calibrationFileEditTelemetryByName =
    calibrationFileEditSession?.role === "leader"
      ? openArmLeaderLiveJointTelemetryByName
      : openArmLiveJointTelemetryByName;
  const calibrationFileEditMotionRows = useMemo(
    () =>
      calibrationFileEditSession
        ? buildOperatorCalibrationFileEditMotionRows({
            motorRows: calibrationFileEditSession.motorRows,
            telemetryByName: calibrationFileEditTelemetryByName,
          })
        : [],
    [
      calibrationFileEditSession,
      calibrationFileEditTelemetryByName,
    ],
  );
  const leaderStatePollTargets = useMemo(
    () =>
      applyCalibrationFileEditLeaderTelemetryOverride({
        targets: baseLeaderStatePollTargets,
        session: calibrationFileEditSession,
      }),
    [baseLeaderStatePollTargets, calibrationFileEditSession],
  );
  const lerobotDirectTeleopAvailable = lerobotFollowerHardwareSelected;
  const resetLeRobotDirectTeleopBrowserMotion = useCallback(() => {
    clearActiveControls();
    commandQueue.clearQueued();
    setLastPreviewTwist(OPERATOR_HELPER_STOP_TWIST);
  }, [clearActiveControls, commandQueue]);
  const lerobotDirectTeleop = useOperatorLeRobotDirectTeleop({
    available: lerobotDirectTeleopAvailable,
    followerConnected: followerHardwareConnectionActive,
    teleoperatorTargets: baseLeaderStatePollTargets,
    baseUrl,
    authorization: collaborationTeleopAuthorization,
    operatorId,
    onBeforeStart: resetLeRobotDirectTeleopBrowserMotion,
    onStatusMessage: setPanelStatusMessage,
  });
  const lerobotDirectTeleopRunning = lerobotDirectTeleop.running;
  const leaderInputTelemetryActive =
    openArmLeaderAutodetectActive &&
    !lerobotDirectTeleopRunning &&
    (leaderTeleopViewerModeActive || calibrationFileEditLeaderTelemetryRequested) &&
    leaderStatePollTargets.length > 0;
  const selectedTeleopInputConfigured =
    selectedLocalLeaderAssigned ||
    leaderStatePollTargets.length > 0 ||
    advertisedLeaderArmInputs.length > 0;
  const followerJointJogCommandReady =
    followerHardwareCommandReady && Boolean(selectedProfile?.capabilities.jointJog);
  const leaderTeleopAvailable = selectedTeleopInputConfigured;
  baseUrlRef.current = baseUrl;
  leaderHardwareAssignedRef.current = Object.keys(operatorLeaderAssignments).length > 0;
  operatorIdRef.current = operatorId;
  selectedProfileIdRef.current = selectedProfile?.id ?? selectedProfileId;
  followerHardwareConnectedRef.current = followerHardwareConnected;
  leaseHeldByThisOperatorRef.current = leaseHeldByThisOperator;
  collaborationTeleopAuthorizationRef.current = collaborationTeleopAuthorization;

  useEffect(() => {
    writeOperatorTeleopPanelState({
      baseUrl,
      operatorId,
      requestedTeleoperationMode,
      selectedProfileId,
      selectedFollowerProfileId,
      selectedCameraStreamId,
      selectedJointJogName,
      linearSpeedMps,
      yawSpeedRps,
      jointJogStepRad,
    });
  }, [
    baseUrl,
    jointJogStepRad,
    linearSpeedMps,
    operatorId,
    requestedTeleoperationMode,
    selectedCameraStreamId,
    selectedFollowerProfileId,
    selectedJointJogName,
    selectedProfileId,
    yawSpeedRps,
  ]);

  useEffect(() => {
    if (!followerCalibrationAvailable && !showStudioTeleopTools) {
      setLerobotCalibrationCatalog({ activeSource: null, entries: [] });
      setLerobotCalibrationCatalogError(null);
      setSelectedFollowerCalibrationSourceId(null);
      return;
    }
    let cancelled = false;
    fetchOperatorLeRobotCalibrationCatalog(OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL)
      .then((catalog) => {
        if (cancelled) return;
        setLerobotCalibrationCatalog(catalog);
        setLerobotCalibrationCatalogError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setLerobotCalibrationCatalog({ activeSource: null, entries: [] });
        setLerobotCalibrationCatalogError(
          error instanceof Error
            ? error.message
            : "LeRobot calibration catalog unavailable.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [followerCalibrationAvailable, showStudioTeleopTools]);

  useEffect(() => {
    if (followerCalibrationSourceOptions.length === 0) {
      if (selectedFollowerCalibrationSourceId !== null) {
        setSelectedFollowerCalibrationSourceId(null);
      }
      return;
    }
    if (
      selectedFollowerCalibrationSourceId &&
      followerCalibrationSourceOptions.some(
        (option) => option.id === selectedFollowerCalibrationSourceId,
      )
    ) {
      return;
    }
    const activeSourceOption = findOperatorLeRobotCalibrationOptionBySource(
      followerCalibrationSourceOptions,
      lerobotCalibrationCatalog.activeSource,
    );
    setSelectedFollowerCalibrationSourceId(
      activeSourceOption?.id ?? followerCalibrationSourceOptions[0]?.id ?? null,
    );
  }, [
    followerCalibrationSourceOptions,
    lerobotCalibrationCatalog.activeSource,
    selectedFollowerCalibrationSourceId,
  ]);

  const followerArmPartSelected = isFollowerArmPartProfile(selectedProfile);
  const baseTwistSupported = Boolean(
    selectedProfile?.capabilities.baseTwist && !followerArmPartSelected,
  );
  const baseTwistAvailable = gatewayControlActive && baseTwistSupported;
  const controlledJointNames = useMemo(
    () => selectedProfile?.controlledJointNames ?? [],
    [selectedProfile?.controlledJointNames],
  );
  const followerTelemetryFreshForMotion = hasFreshFollowerTelemetryForMotion(
    openArmLiveJointTelemetryByName,
    controlledJointNames,
    Date.now(),
  );
  const followerAuthoritativeFeedbackRecentlyReady =
    Date.now() - followerAuthoritativeFeedbackReadyAtMsRef.current <=
    OPERATOR_HARDWARE_IK_COMMAND.maxFollowerTelemetryAgeMs;
  const followerHardwareMotionReady =
    followerJointJogCommandReady &&
    followerTelemetryFreshForMotion &&
    followerHardwareMotionSafety?.motionReady === true;
  const browserLeaderHardwareRelayEnabled =
    followerHardwareMotionReady &&
    !lerobotDirectTeleopAvailable &&
    !lerobotDirectTeleopRunning;
  const jointJogAvailable = Boolean(
    gatewayControlActive &&
    selectedProfile?.capabilities.jointJog &&
    controlledJointNames.length > 0 &&
    followerHardwareMotionReady,
  );
  const openArmCalibrationProfileSelected = Boolean(
    selectedProfile &&
      selectedProfile.adapterId === OPERATOR_TELEOP_ADAPTER_IDS.openArmNative &&
      [
        selectedProfile.robotId,
        selectedProfile.label,
        selectedProfile.controlTargetLabel,
      ].some((value) => isOpenArmDemoRobot(value || null)),
  );
  const openArmCalibrationJogAvailable = Boolean(
    openArmCalibrationProfileSelected &&
    followerJointJogCommandReady &&
    controlledJointNames.length > 0 &&
    followerAuthoritativeFeedbackRecentlyReady,
  );
  const jointSelectorAvailable = jointJogAvailable || openArmCalibrationJogAvailable;
  const linearSpeedMaxMps = Math.min(
    OPERATOR_HELPER_LINEAR_SPEED_MAX_MPS,
    selectedProfile?.limits.maxLinearSpeedMps ??
      OPERATOR_HELPER_LINEAR_SPEED_MAX_MPS,
  );
  const yawSpeedMaxRps = Math.min(
    OPERATOR_HELPER_YAW_SPEED_MAX_RPS,
    selectedProfile?.limits.maxYawSpeedRps ?? OPERATOR_HELPER_YAW_SPEED_MAX_RPS,
  );
  const jointJogStepMaxRad = Math.min(
    OPERATOR_HELPER_JOINT_JOG_STEP_MAX_RAD,
    selectedProfile?.limits.maxJointJogDeltaRad ??
      OPERATOR_HELPER_JOINT_JOG_STEP_MAX_RAD,
  );
  const commandTransport = useMemo(
    () =>
      createOperatorControlCommandTransport({
        controlTransport: providerManifest?.controlTransport ?? null,
        sessionId: session?.current_session_id ?? null,
        peerId: operatorId.trim() || OPERATOR_HELPER_DEFAULT_OPERATOR_ID,
        authorization: collaborationTeleopAuthorization,
        restControlAvailable: gatewayControlActive,
        baseUrl,
        browserToken: "",
      }),
    [
      baseUrl,
      collaborationTeleopAuthorization,
      gatewayControlActive,
      operatorId,
      providerManifest?.controlTransport,
      session?.current_session_id,
    ],
  );

  const handleOpenFollowerEnvConfig = useCallback(async () => {
    setFollowerEnvConfigOpening(true);
    setFollowerEnvConfigError(null);
    try {
      const result = await openOperatorGatewayEnvConfigFile(
        OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
      );
      if (!isMountedRef.current) return;
      setFollowerEnvConfigPath(result.path);
      if (result.opened) {
        setPanelStatusMessage("Opened robot gateway config file.");
      } else {
        const message =
          result.message || `Open ${result.path} on the robot gateway machine.`;
        setFollowerEnvConfigError(message);
        setPanelStatusMessage(message);
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      setFollowerEnvConfigError(
        error instanceof Error
          ? error.message
          : "Could not open robot gateway config file.",
      );
    } finally {
      if (isMountedRef.current) {
        setFollowerEnvConfigOpening(false);
      }
    }
  }, [setPanelStatusMessage]);

  const startCalibration = useCallback(async (
    key: string,
    copy: OperatorCalibrationUiCopy,
    run: () => Promise<OperatorLeRobotCalibrationStartResult>,
    afterStart?: () => void,
  ) => {
    setCalibrationUi((current) =>
      beginOperatorCalibrationUi(current, key, copy),
    );
    try {
      const result = await run();
      if (!isMountedRef.current) return;
      const message = resolveOperatorCalibrationResultMessage(result, copy);
      setCalibrationUi((current) =>
        finishOperatorCalibrationUi(current, key, result, copy),
      );
      afterStart?.();
      setPanelStatusMessage(message);
    } catch (error) {
      if (!isMountedRef.current) return;
      const message = resolveOperatorCalibrationErrorMessage(error, copy);
      setCalibrationUi((current) =>
        failOperatorCalibrationUi(current, key, error, copy),
      );
      setPanelStatusMessage(message);
    }
  }, [setPanelStatusMessage]);

  const handleStartFollowerCalibration = useCallback(async () => {
    if (
      shouldConfirmOperatorLeRobotCalibrationSource(
        selectedFollowerCalibrationSourceOption,
      ) &&
      !window.confirm(
        OPERATOR_LEROBOT_CALIBRATION_MESSAGES.advancedReuseConfirmation,
      )
    ) {
      return;
    }
    await startCalibration(
      OPERATOR_CALIBRATION_UI_KEYS.follower,
      OPERATOR_CALIBRATION_UI_COPY.follower,
      () =>
        startOperatorFollowerCalibration(
          OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
          selectedFollowerCalibrationSource,
        ),
      () => {
        setFollowerHardwareConnectionSelected(false);
        setConnectedFollowerHardwareDeviceKey(null);
        setOperatorDeviceRoleAssignments(releaseStoredOperatorFollowerRoles());
      },
    );
  }, [
    selectedFollowerCalibrationSource,
    selectedFollowerCalibrationSourceOption,
    startCalibration,
  ]);

  const handleStartLeaderCalibration = useCallback(
    async (leader: OperatorLeaderDevice, request: OperatorLeaderReleaseRequest) => {
      await startCalibration(
        leader.identityKey,
        OPERATOR_CALIBRATION_UI_COPY.leader,
        () =>
          startOperatorLeaderCalibration(
            request,
            OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
        ),
      );
    },
    [startCalibration],
  );

  const sendFollowerHardwareJointTargets = useCallback(
    async (jointTargets: Record<string, number>) => {
      if (
        !followerJointJogCommandReady ||
        !followerHardwareMotionReady ||
        !selectedProfile?.capabilities.jointJog
      ) {
        followerHardwareQueuedTargetsRef.current = null;
        setPanelStatusMessage(
          "Follower hardware motion safety is not ready; holding hardware commands.",
        );
        return;
      }
      const telemetryByName =
        useOperatorPerceptionStore.getState().activeFollowerJointTelemetryByName;
      const resolution = resolveFollowerHardwareJointJogCommands({
        jointTargets,
        telemetryByName,
        controlledJointNames,
        maxDeltaRad: selectedProfile.limits.maxJointJogDeltaRad,
        maxVelocityRadPerSec: selectedProfile.limits.maxJointVelocityRadPerSec,
        commandTickMs: selectedProfile.limits.commandTickMs,
        minDeltaRad: OPERATOR_HARDWARE_IK_COMMAND.minDeltaRad,
        maxTelemetryAgeMs: OPERATOR_HARDWARE_IK_COMMAND.maxFollowerTelemetryAgeMs,
        nowMs: Date.now(),
      });
      if (resolution.staleTelemetryCount > 0) {
        setPanelStatusMessage(
          "Follower telemetry is stale; holding hardware commands until fresh state arrives.",
        );
      }
      if (resolution.commands.length === 0) return;

      for (const command of resolution.commands) {
        try {
          const metadata = commandQueue.reserveMetadata("joint_jog");
          await commandTransport.sendJointJog(command, metadata);
        } catch (error) {
          const errorMessage = getOperatorErrorMessage(
            error,
            "Failed to send target to follower hardware.",
          );
          setPanelStatusMessage(errorMessage);
          return;
        }
      }
    },
    [
      commandQueue,
      commandTransport,
      controlledJointNames,
      followerJointJogCommandReady,
      followerHardwareMotionReady,
      selectedProfile,
      setPanelStatusMessage,
    ],
  );
  sendFollowerHardwareJointTargetsRef.current = sendFollowerHardwareJointTargets;

  const dispatchFollowerHardwareJointTargets = useCallback(
    async (jointTargets: Record<string, number>) => {
      if (followerHardwareTargetDispatchInFlightRef.current) {
        followerHardwareQueuedTargetsRef.current = {
          ...(followerHardwareQueuedTargetsRef.current ?? {}),
          ...jointTargets,
        };
        return;
      }

      followerHardwareTargetDispatchInFlightRef.current = true;
      try {
        let nextTargets: Record<string, number> | null = jointTargets;
        while (nextTargets !== null) {
          followerHardwareQueuedTargetsRef.current = null;
          await (
            sendFollowerHardwareJointTargetsRef.current ??
            sendFollowerHardwareJointTargets
          )(nextTargets);
          const queuedTargets = followerHardwareQueuedTargetsRef.current;
          const followerCommandTickMs = followerHardwareCommandTickMsRef.current;
          if (queuedTargets !== null && followerCommandTickMs !== null) {
            await waitFollowerHardwareCommandTick(followerCommandTickMs);
          }
          nextTargets = followerHardwareQueuedTargetsRef.current;
        }
      } finally {
        followerHardwareTargetDispatchInFlightRef.current = false;
      }
    },
    [sendFollowerHardwareJointTargets],
  );

  const getBlockedControlMessage = useCallback(() => resolveBlockedOperatorControlMessage({
    providerManifestAvailable: Boolean(providerManifest),
    selectedProfileAvailable: Boolean(selectedProfile),
    providerControlCapable: providerManifest?.capabilities.control === true,
    collaborationTeleopPermitted,
    requestedTeleoperationModeLabel,
    connectedTeleoperationModeLabel,
    teleoperationModeMatched:
      requestedTeleoperationMode === connectedTeleoperationMode,
    selectedProfileRequiresLease,
    leaseHeldByOtherOperator,
    leaseHeldByThisOperator,
    selectedProfileSupportsJointJog:
      selectedProfile?.capabilities.jointJog === true,
    followerHardwareConnected,
    followerTelemetryFreshForMotion,
    followerHardwareMotionSafety,
    targetMismatch: robotModelMismatchBlocksControl,
  }), [
    collaborationTeleopPermitted,
    connectedTeleoperationMode,
    connectedTeleoperationModeLabel,
    followerHardwareConnected,
    followerHardwareMotionSafety,
    followerTelemetryFreshForMotion,
    leaseHeldByOtherOperator,
    leaseHeldByThisOperator,
    providerManifest,
    requestedTeleoperationMode,
    requestedTeleoperationModeLabel,
    robotModelMismatchBlocksControl,
    selectedProfile,
    selectedProfileRequiresLease,
  ]);

  const releaseBrowserHardwareResourcesKeepalive = useCallback(() => {
    if (leaderHardwareAssignedRef.current) {
      releaseOperatorLeaderHardwareKeepalive(
        {},
        OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
      );
      writeOperatorLeaderAssignments({});
      releaseStoredOperatorLeaderRoles();
      requestExitLeaderTeleopViewerMode();
    }

    if (
      followerHardwareConnectedRef.current ||
      leaseHeldByThisOperatorRef.current
    ) {
      releaseOperatorFollowerHardwareKeepalive(
        baseUrlRef.current,
        "",
        collaborationTeleopAuthorizationRef.current,
      );
      sendOperatorStopCommandKeepalive(
        commandQueue.reserveMetadata("stop"),
        baseUrlRef.current,
        "",
        collaborationTeleopAuthorizationRef.current,
      );
      releaseStoredOperatorFollowerRoles();
    }

    const normalizedOperatorId = operatorIdRef.current.trim();
    const profileId = selectedProfileIdRef.current;
    if (normalizedOperatorId && profileId && leaseHeldByThisOperatorRef.current) {
      releaseOperatorControlLeaseKeepalive(
        normalizedOperatorId,
        profileId,
        baseUrlRef.current,
        "",
        collaborationTeleopAuthorizationRef.current,
      );
    }
  }, [commandQueue, requestExitLeaderTeleopViewerMode]);

  useEffect(() => {
    if (
      !showTeleopConnectionTools ||
      staleStoredLeaderRoleCleanupDoneRef.current
    ) {
      return;
    }
    staleStoredLeaderRoleCleanupDoneRef.current = true;
    setOperatorDeviceRoleAssignments(releaseStoredOperatorLeaderRoles());
  }, [showTeleopConnectionTools]);

  useEffect(() => {
    return () => {
      releaseBrowserHardwareResourcesKeepalive();
      isMountedRef.current = false;
      setLeaderTeleopStatus(OPERATOR_LEADER_TELEOP_UNAVAILABLE_STATUS);
      setLocalLeaderAssigned(false);
      setFollowerHardwareConnected(false);
      setStudioIkAffectsFollowerHardware(false);
    };
  }, [
    releaseBrowserHardwareResourcesKeepalive,
    setFollowerHardwareConnected,
    setLeaderTeleopStatus,
    setLocalLeaderAssigned,
    setStudioIkAffectsFollowerHardware,
  ]);

  useEffect(() => {
    const handlePageExit = () => {
      releaseBrowserHardwareResourcesKeepalive();
    };
    window.addEventListener("pagehide", handlePageExit);
    window.addEventListener("beforeunload", handlePageExit);
    return () => {
      window.removeEventListener("pagehide", handlePageExit);
      window.removeEventListener("beforeunload", handlePageExit);
    };
  }, [releaseBrowserHardwareResourcesKeepalive]);

  useEffect(() => {
    setStudioIkAffectsFollowerHardware(followerHardwareMotionReady);
    return () => setStudioIkAffectsFollowerHardware(false);
  }, [followerHardwareMotionReady, setStudioIkAffectsFollowerHardware]);

  useEffect(() => {
    setFollowerHardwareConnected(followerHardwareConnectionActive);
    return () => setFollowerHardwareConnected(false);
  }, [followerHardwareConnectionActive, setFollowerHardwareConnected]);

  useEffect(() => {
    setLocalLeaderAssigned(selectedLocalLeaderAssigned);
  }, [selectedLocalLeaderAssigned, setLocalLeaderAssigned]);

  useEffect(() => {
    if (!showStudioTeleopTools && !selectedTeleopInputConfigured) {
      setLeaderTeleopStatus(OPERATOR_LEADER_TELEOP_UNAVAILABLE_STATUS);
      return;
    }
    setLeaderTeleopStatus({
      available: leaderTeleopAvailable,
      connected: selectedTeleopInputConfigured,
      label:
        selectedProfile?.label ??
        followerHardwareProfile?.label ??
        providerManifest?.providerDisplayName ??
        session?.robot_id ??
        null,
      reason: !selectedTeleopInputConfigured
        ? "Configure leader input before using Leader Teleop."
        : followerHardwareMotionReady
        ? "Input connected. Follower hardware will move with Studio."
        : "Input connected. Robot motion is off until follower hardware is ready.",
    });
  }, [
    followerHardwareMotionReady,
    leaderTeleopAvailable,
    providerManifest?.providerDisplayName,
    showStudioTeleopTools,
    followerHardwareProfile?.label,
    selectedTeleopInputConfigured,
    selectedProfile?.label,
    session?.robot_id,
    setLeaderTeleopStatus,
  ]);

  useEffect(() => {
    setProviderManifestResolved(false);
  }, [baseUrl]);

  const refreshOpenArmLeaderDetection = useCallback(async () => {
    setOpenArmLeaderDetectionResolved(false);
    setOpenArmLeaderDetectionError(null);
    try {
      const detection = await fetchOperatorLeaderDetection(
        OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
      );
      if (!isMountedRef.current) return;
      setOpenArmLeaderDetection(detection);
    } catch (error) {
      if (!isMountedRef.current) return;
      setOpenArmLeaderDetection(null);
      setOpenArmLeaderDetectionError(
        error instanceof Error
          ? error.message
          : "Leader autodetect is unavailable.",
      );
    } finally {
      if (isMountedRef.current) {
        setOpenArmLeaderDetectionResolved(true);
      }
    }
  }, []);

  const handleOpenArmLeaderScan = useCallback(() => {
    if (!openArmLeaderDetectionRequested) {
      setOpenArmLeaderDetectionRequested(true);
      return;
    }
    void refreshOpenArmLeaderDetection();
  }, [openArmLeaderDetectionRequested, refreshOpenArmLeaderDetection]);

  useEffect(() => {
    if (!showFollowerHardwareTools || openArmLeaderDetectionRequested) return;
    setOpenArmLeaderDetectionRequested(true);
  }, [openArmLeaderDetectionRequested, showFollowerHardwareTools]);

  useEffect(() => {
    if (!openArmLeaderAutodetectActive) {
      setOpenArmLeaderDetectionError(null);
      setPendingOperatorLeaderSelection(null);
      setPendingOperatorLeaderControlPartIds({});
      setPendingOperatorLeaderCalibrationSetups({});
      return;
    }

    void refreshOpenArmLeaderDetection();
  }, [
    openArmLeaderAutodetectActive,
    refreshOpenArmLeaderDetection,
  ]);

  useEffect(() => {
    if (!leaderInputTelemetryActive) {
      setOpenArmLeaderStateError(null);
      openArmLeaderStateErrorVisibilityRef.current = {
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
      };
      setOpenArmLeaderLiveJointCount(0);
      lastLeaderJointTargetsRef.current = null;
      leaderTelemetryZeroOffsetsRef.current = {};
      useOperatorPerceptionStore.getState().clearActiveLeaderJointTelemetry();
      return;
    }

    setOpenArmLeaderStateError(null);
    openArmLeaderStateErrorVisibilityRef.current = {
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    };
    let cancelled = false;
    let pollInFlight = false;
    const pollLeaderState = async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const telemetryByName: Record<string, OperatorLiveJointTelemetry> = {};
        const readErrors: string[] = [];
        const activeZeroOffsetKeys = new Set<string>();
        await Promise.all(
          leaderStatePollTargets.map(async (target) => {
            try {
              const state = await fetchOperatorLeaderState(
                target.path,
                target.side,
                OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
                {
                  motorIds: target.motorIds,
                  motorModel: target.motorModel,
                  calibrationCategory: target.calibrationCategory,
                  calibrationProfile: target.calibrationProfile,
                  calibrationId: target.calibrationId,
                  calibrationGroup: target.calibrationGroup,
                },
              );
              if (!state.connected || state.error) {
                readErrors.push(
                  state.error ||
                    `Leader target ${target.label} is detected but not streaming.`,
                );
                return;
              }
              const mappedTelemetry = buildMappedOperatorLeaderTelemetry({
                state,
                sourceId: buildOperatorLeaderTelemetrySourceId(
                  target.identityKey,
                ),
                sourceLabel: target.label,
                sourceJointNames: target.sourceJointNames,
                sourceMotorIds: target.motorIds,
                targetJointNames: target.targetJointNames,
                targetJointDirections: target.targetJointDirections,
                fallbackToSourceJointNames: true,
              });
              const zeroOffsetKey =
                buildOperatorLeaderTelemetryZeroOffsetKey(target);
              activeZeroOffsetKeys.add(zeroOffsetKey);
              const perceptionStore = useOperatorPerceptionStore.getState();
              const followerReferencePositions = Object.fromEntries(
                Object.entries(
                  perceptionStore.activeFollowerJointTelemetryByName,
                ).map(([jointName, telemetry]) => [
                  jointName,
                  telemetry.positionRad,
                ]),
              );
              Object.assign(
                telemetryByName,
                applyOperatorLeaderTelemetryPoseReferences({
                  telemetryByName: mappedTelemetry,
                  zeroOffsetKey,
                  sourceNeutralPositionsByTargetJointName:
                    target.sourceNeutralPositionsByTargetJointName,
                  targetZeroPositionsByJointName: resolveJointDataZeroReference({
                    dataZeroJointValues:
                      useJointStore.getState().dataZeroJointValues,
                    fallbackJointValues:
                      useJointStore.getState().initialJointValues,
                  }),
                  fallbackReferencePositionsByJointName: {
                    ...useJointStore.getState().jointValues,
                    ...followerReferencePositions,
                  },
                  zeroOffsetsByKey: leaderTelemetryZeroOffsetsRef.current,
                }),
              );
            } catch (error) {
              readErrors.push(
                error instanceof Error
                  ? error.message
                  : `Leader target ${target.label} read failed.`,
              );
            }
          }),
        );
        if (cancelled) return;
        pruneOperatorLeaderTelemetryZeroOffsets(
          leaderTelemetryZeroOffsetsRef.current,
          activeZeroOffsetKeys,
        );
        const liveJointCount = Object.keys(telemetryByName).length;
        setOpenArmLeaderLiveJointCount(liveJointCount);
        const nextLeaderStateError = readErrors[0] ?? null;
        const visibility = openArmLeaderStateErrorVisibilityRef.current;
        if (nextLeaderStateError) {
          visibility.consecutiveFailures += 1;
          visibility.consecutiveSuccesses = 0;
          if (
            visibility.consecutiveFailures >=
            OPERATOR_LEADER_STATE_ERROR_VISIBILITY.consecutiveFailuresToShow
          ) {
            setOpenArmLeaderStateError(nextLeaderStateError);
          }
        } else {
          visibility.consecutiveFailures = 0;
          visibility.consecutiveSuccesses += 1;
          if (
            visibility.consecutiveSuccesses >=
            OPERATOR_LEADER_STATE_ERROR_VISIBILITY.consecutiveSuccessesToClear
          ) {
            setOpenArmLeaderStateError(null);
          }
        }
        if (liveJointCount === 0) {
          useOperatorPerceptionStore.getState().clearActiveLeaderJointTelemetry();
          return;
        }
        const perceptionStore = useOperatorPerceptionStore.getState();
        perceptionStore.upsertActiveLeaderJointTelemetry(telemetryByName);
        perceptionStore.upsertActiveJointTelemetry(telemetryByName);
        const jointTargets = Object.fromEntries(
          Object.entries(telemetryByName).map(([jointName, telemetry]) => [
            jointName,
            telemetry.positionRad,
          ]),
        );
        const { changedJointTargets, nextJointTargetReference } =
          resolveFollowerHardwareLeaderTargetChanges({
            jointTargets,
            previousJointTargets: lastLeaderJointTargetsRef.current,
            minTargetDeltaRad:
              OPERATOR_HARDWARE_IK_COMMAND.leaderTargetDeadbandRad,
          });
        lastLeaderJointTargetsRef.current = nextJointTargetReference;
        if (!browserLeaderHardwareRelayEnabled) return;

        if (Object.keys(changedJointTargets).length > 0) {
          await dispatchFollowerHardwareJointTargets(changedJointTargets);
        }
      } finally {
        pollInFlight = false;
      }
    };

    void pollLeaderState();
    const stopPolling = startVisiblePageInterval(() => {
      void pollLeaderState();
    }, OPERATOR_LEADER_STATE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stopPolling();
      leaderStatePollTargets.forEach((target) => {
        releaseOperatorLeaderHardwareKeepalive(
          buildOperatorLeaderTelemetryTargetReleaseRequest(target),
          OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
        );
      });
      leaderTelemetryZeroOffsetsRef.current = {};
      useOperatorPerceptionStore.getState().clearActiveLeaderJointTelemetry();
    };
  }, [
    dispatchFollowerHardwareJointTargets,
    browserLeaderHardwareRelayEnabled,
    leaderInputTelemetryActive,
    leaderStatePollTargets,
  ]);

  commandTransportRef.current = commandTransport;

  const stopGatewayCameraVideo = useCallback((sourceId: string) => {
    gatewayCameraVideoStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    gatewayCameraVideoStreamRef.current = null;
    useOperatorPerceptionStore
      .getState()
      .removeActiveCameraVideoFrame(sourceId);
  }, []);

  const publishGatewayCameraVideoFrame = useCallback(
    (frame: OperatorPointCloudFrame, label: string) => {
      const canvas =
        gatewayCameraCanvasRef.current ?? document.createElement("canvas");
      gatewayCameraCanvasRef.current = canvas;
      if (!drawPointCloudColorFrameToCanvas(frame, canvas)) return;

      if (gatewayCameraVideoStreamRef.current) return;
      const stream = (canvas as CapturableCanvasElement).captureStream?.(
        OPERATOR_LIVE_CAMERA_CANVAS_STREAM_FPS,
      );
      if (!stream || stream.getVideoTracks().length === 0) return;

      gatewayCameraVideoStreamRef.current = stream;
      useOperatorPerceptionStore.getState().upsertActiveCameraVideoFrame({
        sourceId: frame.cameraId,
        label,
        stream,
        mode: "live",
      });
    },
    [],
  );

  useEffect(() => {
    commandQueue.clearQueued();
    return () => {
      commandTransport.close();
    };
  }, [commandQueue, commandTransport]);

  useEffect(() => {
    const wasOpenArmCameraObserveEligible =
      openArmCameraObserveEligibleRef.current;
    openArmCameraObserveEligibleRef.current = openArmCameraObserveEligible;
    if (openArmGatewayObserveActive) {
      if (!providerManifestResolved) return;
      if (
        openArmHfLiveObserveStartedRef.current &&
        openArmHfLiveObserveOptionsKeyRef.current === openArmHfLiveObserveOptionsKey
      ) {
        return;
      }
      if (openArmHfLiveObserveStartedRef.current) {
        stopOpenArmHfLiveObserve();
      }
      openArmHfLiveObserveStartedRef.current = true;
      openArmHfLiveObserveOptionsKeyRef.current = openArmHfLiveObserveOptionsKey;
      useOperatorPerceptionStore.getState().requestOpenArmHfLiveObserve();
      startOpenArmHfLiveObserve(openArmHfLiveObserveOptions);
      return;
    }
    if (
      !openArmCameraObserveEligible &&
      wasOpenArmCameraObserveEligible
    ) {
      openArmHfLiveObserveStartedRef.current = false;
      openArmHfLiveObserveOptionsKeyRef.current = null;
      stopOpenArmHfLiveObserve();
      setOpenArmDemoLiveObserveManuallyDisconnected(false);
    }
  }, [
    openArmCameraObserveEligible,
    openArmGatewayObserveActive,
    openArmHfLiveObserveOptions,
    openArmHfLiveObserveOptionsKey,
    providerManifestResolved,
  ]);

  useEffect(() => {
    setLinearSpeedMps((current) =>
      clampOperatorProfileSpeed(current, linearSpeedMaxMps),
    );
    setYawSpeedRps((current) =>
      clampOperatorProfileSpeed(current, yawSpeedMaxRps),
    );
  }, [linearSpeedMaxMps, yawSpeedMaxRps]);

  useEffect(() => {
    setJointJogStepRad((current) =>
      clampOperatorProfileSpeed(current, jointJogStepMaxRad),
    );
  }, [jointJogStepMaxRad]);

  useEffect(() => {
    setSelectedJointJogName((current) => {
      if (current && controlledJointNames.includes(current)) return current;
      return controlledJointNames[0] ?? "";
    });
  }, [controlledJointNames]);

  useEffect(() => {
    setSelectedCameraStreamId((current) => {
      if (
        current &&
        providerCameraStreams.some((stream) => stream.id === current)
      )
        return current;
      return providerCameraStreams[0]?.id ?? "";
    });
  }, [providerCameraStreams]);

  useEffect(() => {
    if (controlEnabled) return;
    followerHardwareQueuedTargetsRef.current = null;
    followerAuthoritativeFeedbackReadyAtMsRef.current = 0;
    setFollowerHardwareMotionSafety(null);
    clearActiveControls();
    commandQueue.clearQueued();
  }, [
    clearActiveControls,
    commandQueue,
    controlEnabled,
  ]);

  useEffect(() => {
    if (!followerHardwareConnectionSelected || session === null) return;
    const normalizedOperatorId = operatorId.trim();
    if (session.control_lease_owner === normalizedOperatorId) return;

    followerHardwareQueuedTargetsRef.current = null;
    commandQueue.clearQueued();
    setFollowerHardwareConnectionSelected(false);
    setConnectedFollowerHardwareDeviceKey(null);
  }, [
    commandQueue,
    followerHardwareConnectionSelected,
    operatorId,
    session,
  ]);

  const refreshOperatorState = useCallback(async (
    options: {
      selectedProfileId?: OperatorTeleopProfileId | null;
      requestedTeleoperationMode?: OperatorTeleoperationMode;
    } = {},
  ) => {
    const effectiveSelectedProfileId =
      options.selectedProfileId ?? selectedProfileId;
    const effectiveRequestedTeleoperationMode =
      options.requestedTeleoperationMode ?? requestedTeleoperationMode;
    let nextManifest: OperatorProviderManifest | null = null;
    let providerMessage = "";
    let profileStillSelected = false;
    try {
      nextManifest = await fetchOperatorProviderManifest(
        baseUrl,
        collaborationTeleopAuthorization,
      );
      writeOperatorTeleopPanelState({
        providerManifest: nextManifest,
        providerManifestBaseUrl: baseUrl,
      });
      profileStillSelected = nextManifest.profiles.some(
        (profile) => profile.id === effectiveSelectedProfileId,
      );
      setProviderManifest(nextManifest);
      setSelectedProfileId(
        profileStillSelected ? effectiveSelectedProfileId : null,
      );
    } catch (error) {
      const cachedPanelState = readOperatorTeleopPanelState();
      if (
        cachedPanelState.providerManifest &&
        cachedPanelState.providerManifestBaseUrl === baseUrl
      ) {
        nextManifest = cachedPanelState.providerManifest;
        profileStillSelected = nextManifest.profiles.some(
          (profile) => profile.id === effectiveSelectedProfileId,
        );
        setProviderManifest(nextManifest);
      } else {
        setProviderManifest(null);
      }
      providerMessage =
        error instanceof Error
          ? error.message
          : "Teleop provider manifest is unavailable.";
      if (nextManifest) {
        providerMessage = `${providerMessage} Showing saved provider details.`;
      }
    }
    setProviderManifestResolved(true);

    try {
      const [nextSession, nextStats] = await Promise.all([
        fetchOperatorSession(baseUrl),
        fetchOperatorStats(baseUrl),
      ]);
      setSession(nextSession);
      setStats(nextStats);
      if (!collaborationTeleopPermitted) {
        setPanelStatusMessage(
          "This collaboration link does not include teleop permission.",
        );
        return;
      }
      if (!nextManifest) {
        setPanelStatusMessage(
          providerMessage ||
            "No teleop provider manifest. Connect a robot provider.",
        );
        return;
      }
      if (
        nextManifest.profiles.length === 0 ||
        !nextManifest.capabilities.control
      ) {
        setPanelStatusMessage(
          nextSession.runtime_mode === "observe"
            ? "Gateway is connected in observe mode. Start it in control mode before teleop."
            : "Teleop provider is connected but did not advertise teleop control.",
        );
        return;
      }
      if (!profileStillSelected) {
        setPanelStatusMessage(
          "Select a provider teleop profile before control.",
        );
        return;
      }
      const nextSelectedProfile = getOperatorTeleopProfile(
        nextManifest.profiles,
        effectiveSelectedProfileId,
      );
      const nextTeleoperationMode =
        nextSelectedProfile?.teleoperationMode ??
        resolveOperatorTeleoperationMode(
          nextSession.teleoperation_mode,
          nextSession.adapter_id,
        );
      if (nextTeleoperationMode !== effectiveRequestedTeleoperationMode) {
        setPanelStatusMessage(
          `Teleoperation mode mismatch. Selected ${getOperatorTeleoperationModeLabel(
            effectiveRequestedTeleoperationMode,
          )}; gateway is ${getOperatorTeleoperationModeLabel(nextTeleoperationMode)}.`,
        );
        return;
      }
      if (
        nextSession.control_lease_owner &&
        nextSession.control_lease_owner !== operatorId.trim()
      ) {
        setPanelStatusMessage(
          "Control lease is already held by another operator.",
        );
        return;
      }
      if (!nextSession.control_lease_owner) {
        setPanelStatusMessage(
          "Gateway connected. Request a control lease before teleop.",
        );
        return;
      }
      setPanelStatusMessage(getOperatorStatusMessage(nextSession));
    } catch (error) {
      setSession(null);
      setStats(null);
      setPanelStatusMessage(
        error instanceof Error
          ? error.message
          : "robot gateway is unreachable.",
      );
    }
  }, [
    baseUrl,
    collaborationTeleopAuthorization,
    collaborationTeleopPermitted,
    operatorId,
    requestedTeleoperationMode,
    selectedProfileId,
    setPanelStatusMessage,
  ]);

  useEffect(() => {
    return startVisiblePageInterval(() => {
      void refreshOperatorState();
    }, OPERATOR_HELPER_POLL_INTERVAL_MS);
  }, [refreshOperatorState]);

  useEffect(() => {
    if (!followerHardwareConnected || providerManifest?.capabilities.telemetry !== true) {
      followerAuthoritativeFeedbackReadyAtMsRef.current = 0;
      setFollowerHardwareMotionSafety(null);
      const perceptionStore = useOperatorPerceptionStore.getState();
      perceptionStore.clearActiveFollowerJointTelemetry();
      if (!leaderInputTelemetryActive) {
        perceptionStore.clearActiveJointTelemetry();
      }
      return;
    }

    let cancelled = false;
    const sourceId =
      providerManifest?.providerId ?? session?.robot_id ?? "operator-gateway";
    const sourceLabel =
      selectedProfile?.label ??
      providerManifest?.providerDisplayName ??
      session?.robot_id ??
      "Robot gateway";

    const fetchGatewayJointTelemetry = async () => {
      try {
        const state = await fetchOperatorState(baseUrl);
        if (cancelled) return;
        setFollowerHardwareMotionSafety(state.hardwareMotionSafety);
        const perceptionStore = useOperatorPerceptionStore.getState();
        if (
          !state.heartbeatOk ||
          !state.hardwareMotionSafety.authoritativeJointFeedbackReady
        ) {
          followerAuthoritativeFeedbackReadyAtMsRef.current = 0;
          perceptionStore.clearActiveFollowerJointTelemetry();
          return;
        }

        followerAuthoritativeFeedbackReadyAtMsRef.current = Date.now();
        const rawTelemetryByName = buildOperatorGatewayJointTelemetry({
          state,
          sourceId,
          sourceLabel,
        });
        const zeroOffsetPositions = applyJointDataZeroOffset({
          jointValues: Object.fromEntries(
            Object.entries(rawTelemetryByName).map(([jointName, telemetry]) => [
              jointName,
              telemetry.positionRad,
            ]),
          ),
          dataZeroJointValues: useJointStore.getState().dataZeroJointValues,
        });
        const telemetryByName = Object.fromEntries(
          Object.entries(rawTelemetryByName).map(([jointName, telemetry]) => [
            jointName,
            {
              ...telemetry,
              positionRad: zeroOffsetPositions[jointName] ?? telemetry.positionRad,
            },
          ]),
        );
        if (Object.keys(telemetryByName).length === 0) {
          perceptionStore.clearActiveFollowerJointTelemetry();
          return;
        }
        perceptionStore.upsertActiveFollowerJointTelemetry(telemetryByName);
        if (!leaderInputTelemetryActive) {
          perceptionStore.upsertActiveJointTelemetry(telemetryByName);
        }
      } catch {
        if (!cancelled) {
          setFollowerHardwareMotionSafety(null);
          followerAuthoritativeFeedbackReadyAtMsRef.current = 0;
          useOperatorPerceptionStore
            .getState()
            .clearActiveFollowerJointTelemetry();
        }
        // The session/status poll owns user-visible gateway errors.
      }
    };

    void fetchGatewayJointTelemetry();
    const stopPolling = startVisiblePageInterval(() => {
      void fetchGatewayJointTelemetry();
    }, OPERATOR_HELPER_TELEMETRY_POLLING.intervalMs);

    return () => {
      cancelled = true;
      stopPolling();
      const perceptionStore = useOperatorPerceptionStore.getState();
      perceptionStore.clearActiveFollowerJointTelemetry();
      if (!leaderInputTelemetryActive) {
        perceptionStore.clearActiveJointTelemetry();
      }
    };
  }, [
    baseUrl,
    followerHardwareConnected,
    leaderInputTelemetryActive,
    providerManifest?.capabilities.telemetry,
    providerManifest?.providerDisplayName,
    providerManifest?.providerId,
    selectedProfile?.label,
    session?.robot_id,
  ]);

  useEffect(() => {
    return () => {
      if (
        !useOperatorPerceptionStore.getState().openArmHfLiveObserveRequested
      ) {
        setActivePointCloudFrame(null);
      }
    };
  }, [setActivePointCloudFrame]);

  useEffect(() => {
    if (
      !openArmGatewayObserveActive ||
      !selectedCameraStream?.capabilities.pointCloud
    ) {
      return;
    }

    let cancelled = false;
    const cameraId = selectedCameraStream.id;
    const cameraLabel = selectedCameraStream.label;
    const pointCloudPath = selectedCameraStream.pointCloudPath;

    const fetchGatewayPointCloud = async () => {
      try {
        const frame = await fetchOperatorPointCloud(
          cameraId,
          pointCloudPath,
          baseUrl,
        );
        if (cancelled) return;
        const store = useOperatorPerceptionStore.getState();
        store.upsertActivePointCloudFrame(frame);
        publishGatewayCameraVideoFrame(frame, cameraLabel);
        store.setOpenArmHfLiveObserveStatus(
          "OpenArm gateway point cloud connected.",
        );
      } catch (error) {
        if (cancelled) return;
        useOperatorPerceptionStore
          .getState()
          .setOpenArmHfLiveObserveStatus(
            error instanceof Error
              ? `OpenArm gateway point cloud: ${error.message}`
              : "OpenArm gateway point cloud is unavailable.",
          );
      }
    };

    void fetchGatewayPointCloud();
    const stopPolling = startVisiblePageInterval(() => {
      void fetchGatewayPointCloud();
    }, OPERATOR_HELPER_POINT_CLOUD_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stopPolling();
      useOperatorPerceptionStore
        .getState()
        .removeActivePointCloudFrame(cameraId);
      stopGatewayCameraVideo(cameraId);
    };
  }, [
    baseUrl,
    openArmGatewayObserveActive,
    publishGatewayCameraVideoFrame,
    selectedCameraStream?.capabilities.pointCloud,
    selectedCameraStream?.id,
    selectedCameraStream?.label,
    selectedCameraStream?.pointCloudPath,
    stopGatewayCameraVideo,
  ]);

  const queueStop = useCallback(() => {
    setLastPreviewTwist(OPERATOR_HELPER_STOP_TWIST);
    if (!baseTwistAvailable) {
      setPanelStatusMessage(getBlockedControlMessage());
      return;
    }
    commandQueue.enqueue({
      kind: "stop",
      twist: OPERATOR_HELPER_STOP_TWIST,
      onAccepted: () => {
        setPanelStatusMessage("Stop command sent.");
      },
      onError: (error) => {
        setPanelStatusMessage(
          error instanceof Error ? error.message : "Failed to stop motion.",
        );
      },
    });
  }, [
    baseTwistAvailable,
    commandQueue,
    getBlockedControlMessage,
    setPanelStatusMessage,
  ]);

  useEffect(() => {
    const stopIfHidden = () => {
      if (isPageVisible()) return;
      const hadHeldControls = heldControlsRef.current.size > 0;
      const hadControlLoop = controlIntervalRef.current !== null;
      clearActiveControls();
      if (!hadHeldControls && !hadControlLoop) return;
      queueStop();
    };

    const removeVisibilityListener = addPageVisibilityListener(stopIfHidden);
    stopIfHidden();
    return removeVisibilityListener;
  }, [clearActiveControls, queueStop]);

  const tickMotion = useCallback(() => {
    if (!baseTwistAvailable || !selectedProfile) return;
    const twist = applyProfileCapabilities(
      buildTwist(heldControlsRef.current, linearSpeedMps, yawSpeedRps),
      selectedProfile,
    );
    if (!hasMotion(twist)) return;
    setLastPreviewTwist(twist);
    commandQueue.enqueue({
      kind: "twist",
      twist,
      onAccepted: () => {
        setPanelStatusMessage(`Twist ${formatTwist(twist)}`);
      },
      onError: (error) => {
        setPanelStatusMessage(
          error instanceof Error ? error.message : "Failed to send twist.",
        );
      },
    });
  }, [
    baseTwistAvailable,
    commandQueue,
    linearSpeedMps,
    selectedProfile,
    setPanelStatusMessage,
    yawSpeedRps,
  ]);

  const stopControlLoopIfIdle = useCallback(() => {
    if (heldControlsRef.current.size > 0) return;
    stopControlTimer();
    queueStop();
  }, [queueStop, stopControlTimer]);

  const setHeldControl = useCallback(
    (control: TeleopHoldControl, pressed: boolean) => {
      if (!baseTwistAvailable) {
        clearActiveControls();
        setPanelStatusMessage(
          baseTwistSupported
            ? getBlockedControlMessage()
            : "Selected teleop profile does not support base drive controls.",
        );
        return;
      }
      if (!selectedProfile) {
        setPanelStatusMessage(getBlockedControlMessage());
        return;
      }
      if (
        pressed &&
        (control === "strafe-left" || control === "strafe-right") &&
        !selectedProfile.capabilities.lateralStrafe
      ) {
        setPanelStatusMessage(
          "Selected teleop profile does not support strafe.",
        );
        return;
      }
      if (pressed) {
        heldControlsRef.current.add(control);
        if (controlIntervalRef.current === null) {
          controlIntervalRef.current = window.setInterval(() => {
            void tickMotion();
          }, selectedProfile.limits.commandTickMs);
        }
        void tickMotion();
        return;
      }
      heldControlsRef.current.delete(control);
      stopControlLoopIfIdle();
    },
    [
      baseTwistAvailable,
      baseTwistSupported,
      clearActiveControls,
      getBlockedControlMessage,
      selectedProfile,
      setPanelStatusMessage,
      stopControlLoopIfIdle,
      tickMotion,
    ],
  );

  const clearMotion = useCallback(() => {
    heldControlsRef.current.clear();
    stopControlLoopIfIdle();
  }, [stopControlLoopIfIdle]);

  const handleJointJog = useCallback(
    async (direction: number) => {
      if (!jointJogAvailable || !selectedJointJogName || !selectedProfile) {
        setPanelStatusMessage(getBlockedControlMessage());
        return;
      }
      setJointJogBusy(true);
      try {
        const signedDeltaRad = jointJogStepRad * direction;
        const telemetryByName =
          useOperatorPerceptionStore.getState().activeFollowerJointTelemetryByName;
        const selectedTelemetry = telemetryByName[selectedJointJogName];
        const jointJogResolution = resolveFollowerHardwareJointJogCommands({
          jointTargets: {
            [selectedJointJogName]:
              (selectedTelemetry?.positionRad ?? Number.NaN) + signedDeltaRad,
          },
          telemetryByName,
          controlledJointNames,
          maxDeltaRad: selectedProfile.limits.maxJointJogDeltaRad,
          maxVelocityRadPerSec: selectedProfile.limits.maxJointVelocityRadPerSec,
          commandTickMs: selectedProfile.limits.commandTickMs,
          minDeltaRad: OPERATOR_HARDWARE_IK_COMMAND.minDeltaRad,
          maxTelemetryAgeMs: OPERATOR_HARDWARE_IK_COMMAND.maxFollowerTelemetryAgeMs,
          nowMs: Date.now(),
        });
        if (jointJogResolution.staleTelemetryCount > 0) {
          setPanelStatusMessage(
            "Follower telemetry is stale; holding joint jog until fresh state arrives.",
          );
          return;
        }
        const jointJogCommand = jointJogResolution.commands[0];
        if (!jointJogCommand) return;
        const metadata = commandQueue.reserveMetadata("joint_jog");
        await commandTransport.sendJointJog(jointJogCommand, metadata);
        setPanelStatusMessage(
          `Joint jog ${selectedJointJogName} ${jointJogCommand.delta_rad.toFixed(3)} rad`,
        );
      } catch (error) {
        setPanelStatusMessage(
          error instanceof Error ? error.message : "Failed to send joint jog.",
        );
      } finally {
        if (isMountedRef.current) {
          setJointJogBusy(false);
        }
      }
    },
    [
      commandTransport,
      commandQueue,
      controlledJointNames,
      getBlockedControlMessage,
      jointJogAvailable,
      jointJogStepRad,
      selectedJointJogName,
      selectedProfile,
      setPanelStatusMessage,
    ],
  );

  const sendOpenArmCalibrationJog = useCallback(
    async (jointName: string, deltaRad: number) => {
      const metadata = commandQueue.reserveMetadata("openarm_calibration_jog");
      const ack = await sendOperatorOpenArmCalibrationJogCommand(
        {
          joint_name: jointName,
          delta_rad: deltaRad,
        },
        metadata,
        baseUrl,
        "",
        collaborationTeleopAuthorization,
        operatorId,
      );
      if (!ack.accepted) {
        throw new Error(ack.reason || "Calibration jog was rejected.");
      }
      return ack;
    },
    [
      baseUrl,
      collaborationTeleopAuthorization,
      commandQueue,
      operatorId,
    ],
  );

  const previewOpenArmCalibrationJogInStudio = useCallback(
    (jointName: string, rawDeltaRad: number) => {
      if (!Number.isFinite(rawDeltaRad) || rawDeltaRad === OPERATOR_HELPER_TWIST_ZERO) {
        return;
      }
      const jointStore = useJointStore.getState();
      const fallbackTelemetry =
        useOperatorPerceptionStore.getState().activeFollowerJointTelemetryByName[
          jointName
        ];
      const currentPositionRad =
        jointStore.jointValues[jointName] ?? fallbackTelemetry?.positionRad;
      if (!Number.isFinite(currentPositionRad)) return;
      jointStore.setJointValue(
        jointName,
        (currentPositionRad as number) + rawDeltaRad,
        { enforceVelocity: false },
      );
    },
    [],
  );

  const handleOpenArmCalibrationJog = useCallback(
    async (direction: number) => {
      if (!openArmCalibrationJogAvailable || !selectedJointJogName) {
        setPanelStatusMessage(
          "Calibration jog requires follower connection and fresh raw follower feedback.",
        );
        return;
      }
      setJointJogBusy(true);
      try {
        const deltaRad = OPERATOR_OPENARM_CALIBRATION_JOG.stepRad * direction;
        const ack = await sendOpenArmCalibrationJog(selectedJointJogName, deltaRad);
        previewOpenArmCalibrationJogInStudio(
          selectedJointJogName,
          ack.applied_delta_rad ?? deltaRad,
        );
        setPanelStatusMessage(
          `Calibration jog ${selectedJointJogName} ${deltaRad.toFixed(3)} rad; Studio preview updated.`,
        );
      } catch (error) {
        setPanelStatusMessage(
          error instanceof Error
            ? error.message
            : "Failed to send calibration jog.",
        );
      } finally {
        if (isMountedRef.current) {
          setJointJogBusy(false);
        }
      }
    },
    [
      openArmCalibrationJogAvailable,
      previewOpenArmCalibrationJogInStudio,
      selectedJointJogName,
      sendOpenArmCalibrationJog,
      setPanelStatusMessage,
    ],
  );

  const handleOpenArmCalibrationTestAll = useCallback(async () => {
    if (!openArmCalibrationJogAvailable) {
      setPanelStatusMessage(
        "Calibration test requires follower connection and fresh raw follower feedback.",
      );
      return;
    }
    const jointNames = getOpenArmCalibrationTestJointNames(controlledJointNames);
    if (jointNames.length === 0) {
      setPanelStatusMessage("No arm joints are available for calibration test.");
      return;
    }
    setJointJogBusy(true);
    try {
      const deltaRad = OPERATOR_OPENARM_CALIBRATION_JOG.stepRad;
      for (const [index, jointName] of jointNames.entries()) {
        setSelectedJointJogName(jointName);
        setPanelStatusMessage(
          `Testing calibration motion ${index + 1}/${jointNames.length}: ${jointName}`,
        );
        const forwardAck = await sendOpenArmCalibrationJog(jointName, deltaRad);
        previewOpenArmCalibrationJogInStudio(
          jointName,
          forwardAck.applied_delta_rad ?? deltaRad,
        );
        await waitOpenArmCalibrationTestPause();
        const returnAck = await sendOpenArmCalibrationJog(jointName, -deltaRad);
        previewOpenArmCalibrationJogInStudio(
          jointName,
          returnAck.applied_delta_rad ?? -deltaRad,
        );
        await waitOpenArmCalibrationTestPause();
      }
      setPanelStatusMessage(
        `Calibration motion test passed for ${jointNames.length} arm joints.`,
      );
    } catch (error) {
      setPanelStatusMessage(
        error instanceof Error
          ? error.message
          : "Calibration motion test failed.",
      );
    } finally {
      if (isMountedRef.current) {
        setJointJogBusy(false);
      }
    }
  }, [
    controlledJointNames,
    openArmCalibrationJogAvailable,
    previewOpenArmCalibrationJogInStudio,
    sendOpenArmCalibrationJog,
    setPanelStatusMessage,
  ]);

  useEffect(() => {
    const handleIkHardwareCommand = (event: Event) => {
      const customEvent = event as CustomEvent<StudioKinematicTeleopSampleDetail>;
      if (!isStudioKinematicTeleopSampleDetail(customEvent.detail)) return;
      void dispatchFollowerHardwareJointTargets(customEvent.detail.jointTargets);
    };
    window.addEventListener(
      STUDIO_KINEMATIC_TELEOP_SAMPLE_EVENT,
      handleIkHardwareCommand,
    );
    return () => {
      window.removeEventListener(
        STUDIO_KINEMATIC_TELEOP_SAMPLE_EVENT,
        handleIkHardwareCommand,
      );
    };
  }, [dispatchFollowerHardwareJointTargets]);

  const requestControlLeaseForProfile = useCallback(async (
    profile: OperatorTeleopProfile,
  ): Promise<boolean> => {
    const normalizedOperatorId = operatorId.trim();
    if (!normalizedOperatorId) {
      setPanelStatusMessage("Set an operator ID before requesting control.");
      return false;
    }
    setLeaseBusy(true);
    try {
      const lease = await requestOperatorControlLease(
        normalizedOperatorId,
        profile.id,
        baseUrl,
        "",
        collaborationTeleopAuthorization,
      );
      setPanelStatusMessage(lease.reason || "Control lease granted.");
      await refreshOperatorState({
        selectedProfileId: profile.id,
        requestedTeleoperationMode: profile.teleoperationMode,
      });
      return lease.accepted;
    } catch (error) {
      setPanelStatusMessage(
        error instanceof Error
          ? error.message
          : "Failed to request control lease.",
      );
      return false;
    } finally {
      if (isMountedRef.current) {
        setLeaseBusy(false);
      }
    }
  }, [
    baseUrl,
    collaborationTeleopAuthorization,
    operatorId,
    refreshOperatorState,
    setPanelStatusMessage,
  ]);

  const handleReleaseLease = useCallback(async () => {
    const normalizedOperatorId = operatorId.trim();
    if (!selectedProfile || !normalizedOperatorId) return;
    setLeaseBusy(true);
    try {
      const lease = await releaseOperatorControlLease(
        normalizedOperatorId,
        selectedProfile.id,
        baseUrl,
        "",
        collaborationTeleopAuthorization,
      );
      setPanelStatusMessage(lease.reason || "Control lease released.");
      await refreshOperatorState();
    } catch (error) {
      setPanelStatusMessage(
        error instanceof Error
          ? error.message
          : "Failed to release control lease.",
      );
    } finally {
      if (isMountedRef.current) {
        setLeaseBusy(false);
      }
    }
  }, [
    baseUrl,
    collaborationTeleopAuthorization,
    operatorId,
    refreshOperatorState,
    selectedProfile,
    setPanelStatusMessage,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isOperatorTeleopEditableKeyboardTarget(event.target))
        return;
      if (event.code === "Space" && baseTwistSupported) {
        event.preventDefault();
        clearMotion();
        return;
      }
      const control = KEY_BINDINGS.get(event.code);
      if (!control || !baseTwistSupported) return;
      event.preventDefault();
      setHeldControl(control, true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (isOperatorTeleopEditableKeyboardTarget(event.target)) return;
      const control = KEY_BINDINGS.get(event.code);
      if (!control || !baseTwistSupported) return;
      event.preventDefault();
      setHeldControl(control, false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      clearActiveControls();
      if (
        active &&
        selectedProfile?.transport === "robot_gateway" &&
        baseTwistSupported
      ) {
        commandQueue.enqueue({
          kind: "stop",
          twist: OPERATOR_HELPER_STOP_TWIST,
        });
      }
    };
  }, [
    active,
    baseTwistSupported,
    clearActiveControls,
    clearMotion,
    commandQueue,
    selectedProfile?.transport,
    setHeldControl,
  ]);

  const handleEstop = async () => {
    clearActiveControls();
    setLastPreviewTwist(OPERATOR_HELPER_STOP_TWIST);
    try {
      const metadata = commandQueue.reserveMetadata("estop");
      await commandTransport.sendEstop(metadata);
      setPanelStatusMessage("E-stop command sent.");
    } catch (error) {
      setPanelStatusMessage(
        error instanceof Error ? error.message : "Failed to send e-stop.",
      );
    }
  };

  const renderHoldButton = (
    control: TeleopHoldControl,
    label: string,
    options?: { requiresStrafe?: boolean },
  ) => {
    const disabled =
      !baseTwistAvailable ||
      Boolean(
        options?.requiresStrafe && !selectedProfile?.capabilities.lateralStrafe,
      );
    return (
      <button
        type="button"
        className={controlButtonClass}
        disabled={disabled}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setHeldControl(control, true);
        }}
        onPointerUp={() => setHeldControl(control, false)}
        onPointerCancel={() => setHeldControl(control, false)}
        onPointerLeave={() => setHeldControl(control, false)}
      >
        {label}
      </button>
    );
  };

  const handleSelectOperatorLeaderTarget = useCallback(
    (
      identityKey: string,
      side: OperatorLeaderAssignmentSide,
      group: OperatorTeleopControlGroup,
    ) => {
      const leader = openArmLeaderDetection?.leaders.find(
        (candidate) => candidate.identityKey === identityKey,
      );
      if (!leader) {
        setPanelStatusMessage("Device is no longer detected.");
        return;
      }
      const compatibility = resolveLeaderTargetCompatibility(group, leader);
      if (!leader.available) {
        setPanelStatusMessage("Device is currently blocked.");
        return;
      }
      if (!compatibility.compatible) {
        setPanelStatusMessage(compatibility.reason);
        return;
      }
      const roleConflict = lerobotFollowerHardwareSelected
        ? null
        : resolveOperatorHardwareRoleConflict({
            assignments: operatorDeviceRoleAssignments,
            deviceKey: buildLeaderDeviceRoleKeys(leader),
            requestedRole: "leader",
          });
      if (roleConflict) {
        setPanelStatusMessage(roleConflict);
        return;
      }
      setPendingOperatorLeaderSelection((current) =>
        current?.identityKey === identityKey &&
        current.targetGroupId === group.id
          ? null
          : {
              identityKey,
              targetGroupId: group.id,
              side,
            },
      );
      setPanelStatusMessage(`Target selected: ${group.label}.`);
    },
    [
      openArmLeaderDetection?.leaders,
      lerobotFollowerHardwareSelected,
      operatorDeviceRoleAssignments,
      setPanelStatusMessage,
    ],
  );

  const handleConnectOperatorLeader = useCallback(
    async (
      identityKey: string,
      side: OperatorLeaderAssignmentSide,
      group: OperatorTeleopControlGroup,
      controlPartId: string | null = null,
    ) => {
      const leader = openArmLeaderDetection?.leaders.find(
        (candidate) => candidate.identityKey === identityKey,
      );
      if (!leader) {
        setPanelStatusMessage("Device is no longer detected.");
        return false;
      }
      const compatibility = resolveLeaderTargetCompatibility(group, leader);
      if (!compatibility.compatible) {
        setPanelStatusMessage(compatibility.reason);
        return false;
      }
      const requestedControlPart = controlPartId
        ? leader.controlParts.find((part) => part.id === controlPartId) ?? null
        : null;
      const controlPart =
        requestedControlPart ?? findCompatibleLeaderControlPart(group, leader);
      if (!controlPart) {
        setPanelStatusMessage("No compatible arm found.");
        return false;
      }
      const controlPartCompatibility = resolveLeaderControlPartTargetCompatibility(
        group,
        leader,
        controlPart,
      );
      if (!controlPartCompatibility.compatible) {
        setPanelStatusMessage(controlPartCompatibility.reason);
        return false;
      }
      const leaderDeviceRoleKeys = buildLeaderDeviceRoleKeys(leader);
      const roleAssignment = lerobotFollowerHardwareSelected
        ? {
            accepted: true as const,
            assignments: releaseOperatorDeviceRoleForKeys(
              operatorDeviceRoleAssignments,
              leaderDeviceRoleKeys,
            ),
            conflict: null,
          }
        : assignOperatorDeviceRoleForKeys(
            operatorDeviceRoleAssignments,
            leaderDeviceRoleKeys,
            "leader",
          );
      if (!roleAssignment.accepted) {
        setPanelStatusMessage(roleAssignment.conflict);
        return false;
      }
      try {
        await releaseOperatorLeaderHardware(
          buildOperatorLeaderHardwareReleaseRequest(leader, controlPart),
          OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
        );
      } catch {
        // Assignment can continue; the next read will drop stale readers on error.
      }

      const nextAssignments = assignOperatorLeaderSide(
        operatorLeaderAssignments,
        identityKey,
        side,
        {
          targetGroupId: group.id,
          targetJointNames: resolveLeaderMappedTargetJointNames(
            group,
            controlPart,
          ),
          targetEndEffectorJointNames: group.endEffectorJointNames,
          controlPartId: controlPart.id,
          sourceMotorIds: controlPart.motorIds,
          sourceMotorModel: controlPart.motorModel,
          sourceActuatorCount: controlPart.actuatorCount,
          sourceCalibrationCategory: controlPart.calibrationCategory,
          sourceCalibrationProfile: controlPart.calibrationProfile,
          sourceCalibrationId: controlPart.calibrationId,
          sourceCalibrationGroup: controlPart.calibrationGroup,
        },
      );
      setOperatorDeviceRoleAssignments(roleAssignment.assignments);
      writeOperatorDeviceRoleAssignments(roleAssignment.assignments);
      setOperatorLeaderAssignments(nextAssignments);
      writeOperatorLeaderAssignments(nextAssignments);
      setLocalLeaderAssigned(true);
      requestLeaderTeleopViewerMode();
      setPanelStatusMessage(`Target connected: ${group.label}.`);
      return true;
    },
    [
      openArmLeaderDetection?.leaders,
      lerobotFollowerHardwareSelected,
      operatorLeaderAssignments,
      operatorDeviceRoleAssignments,
      requestLeaderTeleopViewerMode,
      setLocalLeaderAssigned,
      setPanelStatusMessage,
    ],
  );

  const handleReleaseOperatorLeader = useCallback(
    async (identityKey: string) => {
      const leader = openArmLeaderDetection?.leaders.find(
        (candidate) => candidate.identityKey === identityKey,
      );
      const assignment = operatorLeaderAssignments[identityKey] ?? null;
      const controlPart =
        leader?.controlParts.find((part) => part.id === assignment?.controlPartId) ??
        null;
      const nextAssignments = releaseOperatorLeaderAssignment(
        operatorLeaderAssignments,
        identityKey,
      );
      const nextRoleAssignments = releaseOperatorDeviceRoleForKeys(
        operatorDeviceRoleAssignments,
        leader ? buildLeaderDeviceRoleKeys(leader) : [identityKey],
        "leader",
      );
      const leaderInputStillAssigned = Object.keys(nextAssignments).length > 0;
      setOperatorLeaderAssignments(nextAssignments);
      writeOperatorLeaderAssignments(nextAssignments);
      setLocalLeaderAssigned(leaderInputStillAssigned);
      if (!leaderInputStillAssigned) {
        setLeaderTeleopStatus(OPERATOR_LEADER_TELEOP_UNAVAILABLE_STATUS);
        requestExitLeaderTeleopViewerMode();
      }
      setOperatorDeviceRoleAssignments(nextRoleAssignments);
      writeOperatorDeviceRoleAssignments(nextRoleAssignments);
      setPendingOperatorLeaderSelection((current) =>
        current?.identityKey === identityKey ? null : current,
      );
      setPendingOperatorLeaderControlPartIds((current) => {
        if (!(identityKey in current)) return current;
        const next = { ...current };
        delete next[identityKey];
        return next;
      });
      setPendingOperatorLeaderCalibrationSetups((current) => {
        if (!(identityKey in current)) return current;
        const next = { ...current };
        delete next[identityKey];
        return next;
      });
      setPanelStatusMessage("Target disconnected.");
      if (!leader) return;
      try {
        await releaseOperatorLeaderHardware(
          buildOperatorLeaderHardwareReleaseRequest(leader, controlPart),
          OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
        );
      } catch (error) {
        setPanelStatusMessage(
          error instanceof Error
            ? error.message
            : "Target was unassigned, but serial release failed.",
        );
      }
    },
    [
      openArmLeaderDetection?.leaders,
      operatorLeaderAssignments,
      operatorDeviceRoleAssignments,
      requestExitLeaderTeleopViewerMode,
      setLeaderTeleopStatus,
      setLocalLeaderAssigned,
      setPanelStatusMessage,
    ],
  );

  const renderOpenArmLeaderCandidate = (
    leader: OperatorLeaderDevice,
    leaderIndex: number,
  ) => {
    const assignment = operatorLeaderAssignments[leader.identityKey] ?? null;
    const targetGroups = studioTeleopControlGroups.filter(
      (group) => group.kind === "arm" && group.teleopEnabled,
    );
    const detectedArmLeaderCount =
      openArmLeaderDetection?.leaders.filter((candidate) =>
        candidate.controlParts.some((part) => part.kind === "arm"),
      ).length ?? 0;
    const preferredTargetGroupId =
      assignment === null && detectedArmLeaderCount > 1
        ? targetGroups.find(
            (group) =>
              resolveLeaderSideForControlGroup(group) ===
              (leaderIndex === 0 ? "left" : leaderIndex === 1 ? "right" : "both"),
          )?.id ?? null
        : null;
    const {
      targetOptions,
      selectableTargetOptions,
      connectedTargetOption,
      selectedTargetOption,
      selectedCompatibility,
    } = resolveLeaderTargetSelection({
      targetGroups,
      leader,
      assignment,
      pendingTargetGroupId:
        pendingOperatorLeaderSelection?.identityKey === leader.identityKey
          ? pendingOperatorLeaderSelection.targetGroupId
          : null,
      preferredTargetGroupId,
    });
    const leaderRoleConflict = lerobotFollowerHardwareSelected
      ? null
      : resolveOperatorHardwareRoleConflict({
          assignments: operatorDeviceRoleAssignments,
          deviceKey: buildLeaderDeviceRoleKeys(leader),
          requestedRole: "leader",
        });
    const leaderConnectionState = resolveOperatorHardwareConnectionState({
      deviceAvailable: leader.available,
      operationBusy: false,
      alreadyConnected: assignment !== null,
      connectionPrerequisitesReady: true,
      roleConflict: leaderRoleConflict,
    });
    const connectedControlPart =
      assignment !== null
        ? leader.controlParts.find((part) => part.id === assignment.controlPartId) ??
          null
        : null;
    const controlPartOptions = selectedTargetOption
      ? listCompatibleLeaderControlParts(selectedTargetOption.group, leader)
      : [];
    const pendingControlPartId =
      pendingOperatorLeaderControlPartIds[leader.identityKey] ?? null;
    const pendingControlPart =
      pendingControlPartId !== null
        ? controlPartOptions.find((part) => part.id === pendingControlPartId) ??
          null
        : null;
    const selectedControlPart =
      connectedControlPart ?? pendingControlPart ?? controlPartOptions[0] ?? null;
    const selectedControlPartCompatibility =
      selectedTargetOption && selectedControlPart
        ? resolveLeaderControlPartTargetCompatibility(
            selectedTargetOption.group,
            leader,
            selectedControlPart,
          )
        : selectedCompatibility;
    const connectDisabled =
      selectedTargetOption === null ||
      selectedControlPartCompatibility?.compatible !== true ||
      leaderConnectionState.connectDisabled;
    const pairedLeaderCalibrationRequest = selectedTargetOption
      ? buildOperatorLeaderCalibrationRequest({
          leader,
          controlPart: selectedControlPart,
          selectedSide: selectedTargetOption.side,
          leaders: openArmLeaderDetection?.leaders ?? [],
          pairOpenArmMini: true,
        })
      : null;
    const canPairOpenArmMiniCalibration = Boolean(
      pairedLeaderCalibrationRequest?.portLeft &&
        pairedLeaderCalibrationRequest.portRight,
    );
    const pendingCalibrationSetup =
      pendingOperatorLeaderCalibrationSetups[leader.identityKey] ?? "pair";
    const selectedCalibrationSetup: PendingOperatorLeaderCalibrationSetup =
      canPairOpenArmMiniCalibration ? pendingCalibrationSetup : "single";
    const leaderCalibrationRequest = selectedTargetOption
      ? buildOperatorLeaderCalibrationRequest({
          leader,
          controlPart: selectedControlPart,
          selectedSide: selectedTargetOption.side,
          leaders: openArmLeaderDetection?.leaders ?? [],
          pairOpenArmMini: selectedCalibrationSetup === "pair",
        })
      : null;
    const canChooseOpenArmMiniCalibrationSetup =
      leaderCalibrationRequest?.calibrationProfile ===
      OPERATOR_OPENARM_MINI_TELEOPERATOR_TYPE;
    const hardwareDetailLines = buildLeaderHardwareDetailLines(
      leader,
      selectedControlPart,
    );
    const leaderDetailLines = [
      ...hardwareDetailLines,
      ...buildLeaderCalibrationSetupLines(leaderCalibrationRequest),
    ];
    const targetSelectDisabled =
      leaderConnectionState.targetSelectionBlocked ||
      selectableTargetOptions.length === 0;
    const selectedControlPartId = selectedControlPart?.id ?? null;
    const leaderCalibrationBusy =
      isOperatorCalibrationUiActive(calibrationUi, leader.identityKey);
    const leaderCalibrationDisabled =
      selectedControlPart === null ||
      leaderCalibrationRequest === null ||
      leaderCalibrationBusy ||
      assignment !== null ||
      leaderConnectionState.status === "blocked" ||
      Boolean(leaderRoleConflict);
    const leaderCalibrationDisableReason =
      assignment !== null
        ? "Disconnect before calibration."
        : leaderRoleConflict ?? undefined;
    const leaderCalibrationEntry = readOperatorCalibrationUiEntry(
      calibrationUi,
      leader.identityKey,
    );
    const leaderCalibrationFileEditActive =
      calibrationFileEditSession?.role === "leader" &&
      calibrationFileEditSession.targetKey === leader.identityKey;
    const activeCalibrationFileEditSession = leaderCalibrationFileEditActive
      ? calibrationFileEditSession
      : null;
    const leaderCalibrationFileEditEntry =
      findCalibrationCatalogEntryForLeaderControlPart(
        lerobotCalibrationCatalog.entries,
        selectedControlPart,
      );
    const leaderCalibrationFileEditDisabled =
      selectedControlPart === null ||
      leaderCalibrationFileEditEntry === null ||
      (calibrationFileEditSession !== null && !leaderCalibrationFileEditActive) ||
      Boolean(leaderRoleConflict);
    const leaderCalibrationFileEditMotionRows =
      activeCalibrationFileEditSession && selectedControlPart && selectedTargetOption
        ? assignOperatorCalibrationFileEditTargetJointNames({
            motionRows: calibrationFileEditMotionRows,
            sourceJointNames: selectedControlPart.jointNames.slice(
              0,
              selectedControlPart.actuatorCount,
            ),
            targetJointNames: resolveLeaderMappedTargetJointNames(
              selectedTargetOption.group,
              selectedControlPart,
            ),
          })
        : [];
    const handleTargetChange = (targetGroupId: string) => {
      const nextTargetOption = targetOptions.find(
        (option) => option.group.id === targetGroupId,
      );
      if (!nextTargetOption) return;
      if (!nextTargetOption.compatibility.compatible) {
        if (nextTargetOption.compatibility.reason) {
          setPanelStatusMessage(nextTargetOption.compatibility.reason);
        }
        return;
      }
      handleSelectOperatorLeaderTarget(
        leader.identityKey,
        nextTargetOption.side,
        nextTargetOption.group,
      );
    };
    const handleControlPartChange = (controlPartId: string) => {
      setPendingOperatorLeaderControlPartIds((current) => {
        if (controlPartId === "") {
          if (!(leader.identityKey in current)) return current;
          const next = { ...current };
          delete next[leader.identityKey];
          return next;
        }
        if (current[leader.identityKey] === controlPartId) return current;
        return {
          ...current,
          [leader.identityKey]: controlPartId,
        };
      });
    };
    const handleCalibrationSetupChange = (
      setup: PendingOperatorLeaderCalibrationSetup,
    ) => {
      setPendingOperatorLeaderCalibrationSetups((current) => {
        if (current[leader.identityKey] === setup) return current;
        return {
          ...current,
          [leader.identityKey]: setup,
        };
      });
    };
    const controlPartSelectDisabled =
      assignment !== null ||
      selectedTargetOption === null ||
      controlPartOptions.length <= 1 ||
      leaderConnectionState.targetSelectionBlocked;
    const calibrationSetupSelectDisabled =
      assignment !== null || !canPairOpenArmMiniCalibration;
    const selectionGridClassName = canChooseOpenArmMiniCalibrationSetup
      ? "grid-cols-[minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,0.9fr)]"
      : "grid-cols-2";
    const leaderInUse = connectedTargetOption !== null;
    return (
      <div
        key={leader.id}
        className={cn(
          "rounded border p-1",
          leaderInUse
            ? "border-emerald-500/55 bg-emerald-500/10"
            : "border-border/30",
        )}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <span className="truncate font-mono text-foreground">
            {leader.path}
          </span>
          {leaderInUse ? (
            <span className="text-emerald-200">using</span>
          ) : leaderConnectionState.status === "blocked" ? (
            <span className="text-amber-200">blocked</span>
          ) : null}
        </div>
        <div className="mt-0.5 space-y-0.5 font-mono">
          {leaderDetailLines.map((line) => (
            <div
              key={line}
              className={
                selectedControlPartCompatibility?.compatible === false
                  ? "text-amber-200"
                  : "text-muted-foreground"
              }
            >
              {line}
            </div>
          ))}
        </div>
        {selectedControlPartCompatibility?.reason ? (
          <div
            className={cn(
              "mt-0.5",
              selectedControlPartCompatibility.compatible
                ? "text-muted-foreground"
                : "text-amber-200",
            )}
          >
            {selectedControlPartCompatibility.reason}
          </div>
        ) : null}
        {leaderRoleConflict ? (
          <div className="mt-0.5 text-amber-200">{leaderRoleConflict}</div>
        ) : null}
        <div className="mt-1 grid gap-1">
          <div className={cn("grid gap-1", selectionGridClassName)}>
            <select
              aria-label="Target"
              className="h-7 min-w-0 rounded border border-border/60 bg-background px-2 text-[10px] text-foreground"
              disabled={targetSelectDisabled}
              value={selectedTargetOption?.group.id ?? ""}
              onChange={(event) => handleTargetChange(event.currentTarget.value)}
            >
              {selectedTargetOption ? null : <option value="">No target</option>}
              {targetOptions.map((option) => (
                <option
                  key={option.group.id}
                  value={option.group.id}
                  disabled={!option.compatibility.compatible}
                >
                  {option.group.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Calibration"
              className="h-7 min-w-0 rounded border border-border/60 bg-background px-2 text-[10px] text-foreground"
              disabled={controlPartSelectDisabled}
              value={selectedControlPart?.id ?? ""}
              onChange={(event) =>
                handleControlPartChange(event.currentTarget.value)
              }
            >
              {selectedControlPart ? null : <option value="">No calibration</option>}
              {controlPartOptions.map((part) => (
                <option key={part.id} value={part.id}>
                  {formatLeaderControlPartChoiceLabel(part)}
                </option>
              ))}
            </select>
            {canChooseOpenArmMiniCalibrationSetup ? (
              <select
                aria-label="Setup"
                className="h-7 min-w-0 rounded border border-border/60 bg-background px-2 text-[10px] text-foreground"
                disabled={calibrationSetupSelectDisabled}
                value={selectedCalibrationSetup}
                onChange={(event) =>
                  handleCalibrationSetupChange(
                    event.currentTarget
                      .value as PendingOperatorLeaderCalibrationSetup,
                  )
                }
              >
                {canPairOpenArmMiniCalibration ? (
                  <option value="pair">bi_openarm_mini (pair)</option>
                ) : null}
                <option value="single">openarm_mini (this arm)</option>
              </select>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              className={cn(controlButtonClass, "h-7 px-2")}
              disabled={leaderCalibrationDisabled}
              title={leaderCalibrationDisableReason}
              onClick={() =>
                leaderCalibrationRequest
                  ? void handleStartLeaderCalibration(
                      leader,
                      leaderCalibrationRequest,
                    )
                  : undefined
              }
            >
              {leaderCalibrationBusy ? "Opening" : "Calibrate"}
            </button>
            <button
              type="button"
              className={cn(controlButtonClass, "h-7 px-2")}
              disabled={leaderCalibrationFileEditDisabled}
              title={
                leaderCalibrationFileEditEntry
                  ? "Open the calibration file and edit the motor order."
                  : "No calibration file found for this target."
              }
              onClick={() => {
                if (!selectedTargetOption) {
                  return;
                }
                void (async () => {
                  setCalibrationFileEditLeaderTelemetryRequested(true);
                  const connected =
                    connectedTargetOption !== null ||
                    (await handleConnectOperatorLeader(
                      leader.identityKey,
                      selectedTargetOption.side,
                      selectedTargetOption.group,
                      selectedControlPartId,
                    ));
                  if (!connected) {
                    setCalibrationFileEditLeaderTelemetryRequested(false);
                    return;
                  }
                  await handleStartLeaderCalibrationFileEdit(
                    leader,
                    selectedControlPartId,
                  );
                })();
              }}
            >
              Fix order
            </button>
            {connectedTargetOption ? (
              <button
                type="button"
                className={cn(
                  controlButtonClass,
                  "h-7 border-emerald-500/45 bg-emerald-500/15 px-2 text-emerald-100",
                )}
                onClick={() => void handleReleaseOperatorLeader(leader.identityKey)}
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                className={cn(controlButtonClass, "h-7 px-2")}
                disabled={connectDisabled}
                title={connectDisabled ? (leaderRoleConflict ?? undefined) : undefined}
                onClick={() =>
                  selectedTargetOption
                    ? void handleConnectOperatorLeader(
                        leader.identityKey,
                        selectedTargetOption.side,
                        selectedTargetOption.group,
                        selectedControlPartId,
                      )
                    : undefined
                }
              >
                Connect
              </button>
            )}
          </div>
        </div>
        {activeCalibrationFileEditSession ? (
          <div className="mt-1">
            <OperatorCalibrationFileEditControls
              buttonClassName={controlButtonClass}
              message={activeCalibrationFileEditSession.message}
              jointCount={activeCalibrationFileEditSession.jointNames.length}
              motionRows={leaderCalibrationFileEditMotionRows}
              busy={activeCalibrationFileEditSession.busy}
              onOpenFile={() => void handleOpenCalibrationFileEditFile()}
              onCancel={handleCloseCalibrationFileEdit}
            />
          </div>
        ) : null}
        {leaderCalibrationEntry.message ? (
          <div className="mt-1 text-muted-foreground">
            {leaderCalibrationEntry.message}
          </div>
        ) : null}
        {leaderCalibrationEntry.command ? (
          <div className="mt-0.5 truncate font-mono text-muted-foreground">
            {leaderCalibrationEntry.command}
          </div>
        ) : null}
      </div>
    );
  };

  const renderLeaderCandidates = () => (
    <div
      className={cn(
        "mt-2 rounded border p-1.5",
        selectedLocalLeaderAssigned
          ? "border-emerald-500/45 bg-emerald-500/10"
          : "border-border/30 bg-background/30",
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">Detected targets</span>
        <div className="flex items-center gap-1">
          {!openArmLeaderDetectionResolved || openArmLeaderDetectionError ? (
            <span className="font-mono text-foreground">
              {!openArmLeaderDetectionRequested
                ? "Idle"
                : !openArmLeaderDetectionResolved
                  ? "Scanning"
                  : "Error"}
            </span>
          ) : null}
          <button
            type="button"
            className={cn(controlButtonClass, "h-6 px-1.5")}
            onClick={handleOpenArmLeaderScan}
          >
            {openArmLeaderDetectionRequested ? "Rescan" : "Scan"}
          </button>
        </div>
      </div>
      {!openArmLeaderDetectionRequested ? (
        <div>Click Scan to detect leader targets.</div>
      ) : !openArmLeaderDetectionResolved ? (
        <div>Scanning serial devices.</div>
      ) : openArmLeaderDetectionError ? (
        <div className="text-amber-200">{openArmLeaderDetectionError}</div>
      ) : openArmLeaderDetection?.leaders.length ? (
        <div className="space-y-1">
          {openArmLeaderStateError ? (
            <div className="rounded border border-amber-500/35 bg-amber-500/10 p-1.5 text-amber-200">
              {openArmLeaderStateError}
            </div>
          ) : openArmLeaderLiveJointCount > 0 ? (
            <div className="font-mono text-muted-foreground">
              Streaming {openArmLeaderLiveJointCount} joint values.
            </div>
          ) : leaderStatePollTargets.length > 0 &&
            !leaderTeleopViewerModeActive ? (
            <div className="font-mono text-muted-foreground">
              Assigned. Opening teleop view.
            </div>
          ) : null}
          {openArmLeaderDetection.leaders.map((leader, leaderIndex) =>
            renderOpenArmLeaderCandidate(leader, leaderIndex),
          )}
        </div>
      ) : (
        <div>No targets detected.</div>
      )}
    </div>
  );

  const handleConnectOpenArmLiveObserve = useCallback(() => {
    if (!openArmCameraObserveEligible) return;
    if (openArmDemoLiveObserveManuallyDisconnected) {
      setOpenArmDemoLiveObserveManuallyDisconnected(false);
      return;
    }
    setOpenArmDemoLiveObserveManuallyDisconnected(false);
    openArmHfLiveObserveStartedRef.current = true;
    openArmHfLiveObserveOptionsKeyRef.current = openArmHfLiveObserveOptionsKey;
    useOperatorPerceptionStore.getState().requestOpenArmHfLiveObserve();
    startOpenArmHfLiveObserve(openArmHfLiveObserveOptions);
  }, [
    openArmCameraObserveEligible,
    openArmDemoLiveObserveManuallyDisconnected,
    openArmHfLiveObserveOptions,
    openArmHfLiveObserveOptionsKey,
  ]);

  const handleDisconnectOpenArmLiveObserve = useCallback(() => {
    if (!openArmCameraObserveEligible) return;
    openArmHfLiveObserveStartedRef.current = false;
    openArmHfLiveObserveOptionsKeyRef.current = null;
    setOpenArmDemoLiveObserveManuallyDisconnected(true);
    stopOpenArmHfLiveObserve();
  }, [openArmCameraObserveEligible]);

  const followerHardwareMotionSafetyLabel =
    resolveFollowerHardwareMotionSafetyLabel({
      followerHardwareMotionReady,
      followerHardwareMotionSafety,
      followerTelemetryFreshForMotion,
      followerHardwareConnected,
    });
  const followerCalibrationRequired =
    followerHardwareConnectionActive &&
    followerHardwareMotionSafety?.jointRotationCalibrationRequired === true;
  const followerCalibrationEntry = readOperatorCalibrationUiEntry(
    calibrationUi,
    OPERATOR_CALIBRATION_UI_KEYS.follower,
  );
  const followerHardwareConnectDisabled = selectedFollowerDetectedSetupTarget
    ? followerDetectedSetupApplying
    : resolveFollowerHardwareConnectDisabled({
        leaseBusy,
        followerHardwareConnected,
        followerHardwareDisconnectAvailable,
        followerHardwareRoleConflict,
        followerHardwareProfileAvailable: followerHardwareProfile !== null,
        gatewayControlCapable: providerManifest?.capabilities.control === true,
        collaborationTeleopPermitted,
      });
  const followerConnectionIssue =
    followerHardwareRoleConflict ??
    (selectedFollowerDetectedSetupTarget
      ? null
      : !followerHardwareProfile
      ? "No LeRobot robot target from gateway."
      : providerManifest?.capabilities.control !== true
        ? "Robot unavailable."
        : !collaborationTeleopPermitted
          ? "Teleop permission required."
          : null);
  const activeFollowerCalibrationFileEditSession = followerCalibrationFileEditOpen
    ? calibrationFileEditSession
    : null;
  const followerCalibrationFileEditAvailable = Boolean(
    followerCalibrationAvailable &&
      followerHardwareProfile &&
      selectedFollowerCalibrationCatalogEntry,
  );
  const followerCalibrationFileEditDisabled =
    !followerCalibrationFileEditAvailable ||
    (calibrationFileEditSession !== null && !followerCalibrationFileEditOpen) ||
    Boolean(followerHardwareRoleConflict);
  const handleApplyDetectedFollowerSetup = useCallback(
    async (setup: OperatorFollowerDetectedSetupTarget) => {
      setFollowerDetectedSetupApplying(true);
      setFollowerEnvConfigError(null);
      try {
        const currentConfig = await fetchOperatorGatewayEnvConfig(
          OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
        );
        const savedConfig = await saveOperatorGatewayEnvConfig(
          buildOperatorFollowerSetupEnvContent(currentConfig.content, setup),
          OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
        );
        if (!isMountedRef.current) return false;
        setFollowerEnvConfigPath(savedConfig.path);
        setSelectedFollowerProfileId(null);
        setSelectedProfileId(null);
        await refreshOperatorState({
          selectedProfileId: null,
          requestedTeleoperationMode: OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
        });
        if (!isMountedRef.current) return false;
        setPanelStatusMessage(`Using detected robot target: ${setup.label}.`);
        return true;
      } catch (error) {
        if (!isMountedRef.current) return false;
        const message =
          error instanceof Error
            ? error.message
            : "Could not use detected robot target.";
        setFollowerEnvConfigError(message);
        setPanelStatusMessage(message);
        return false;
      } finally {
        if (isMountedRef.current) {
          setFollowerDetectedSetupApplying(false);
        }
      }
    },
    [refreshOperatorState, setPanelStatusMessage],
  );
  const handleToggleFollowerHardwareConnection = useCallback(async () => {
    if (followerHardwareDisconnectAvailable) {
      clearActiveControls();
      commandQueue.clearQueued();
      setLastPreviewTwist(OPERATOR_HELPER_STOP_TWIST);
      if (followerHardwareConnectionActive || leaseHeldByThisOperator) {
        try {
          await sendOperatorStopCommand(
            commandQueue.reserveMetadata("stop"),
            baseUrl,
            "",
            collaborationTeleopAuthorization,
          );
        } catch {
          // Lease release below is the important hardware-liberation path.
        }
      }
      if (leaseHeldByThisOperator) {
        await handleReleaseLease();
      }
      if (followerHardwareConnectionActive || leaseHeldByThisOperator) {
        try {
          await releaseOperatorFollowerHardware(
            baseUrl,
            "",
            collaborationTeleopAuthorization,
          );
        } catch {
          // Role release below keeps the UI switchable even if the gateway was already down.
        }
      }
      const followerDeviceKeyToRelease =
        connectedFollowerHardwareDeviceKey ?? selectedFollowerHardwareDeviceKey;
      if (followerDeviceKeyToRelease) {
        const nextRoleAssignments = releaseOperatorDeviceRoleForKeys(
          operatorDeviceRoleAssignments,
          selectedFollowerHardwareDeviceKeys.length > 0
            ? selectedFollowerHardwareDeviceKeys
            : [followerDeviceKeyToRelease],
          "follower",
        );
        setOperatorDeviceRoleAssignments(nextRoleAssignments);
        writeOperatorDeviceRoleAssignments(nextRoleAssignments);
      }
      setFollowerHardwareConnectionSelected(false);
      setConnectedFollowerHardwareDeviceKey(null);
      setPanelStatusMessage("Robot hardware disconnected.");
      return true;
    }

    if (!followerHardwareProfile && selectedFollowerDetectedSetupTarget) {
      return handleApplyDetectedFollowerSetup(selectedFollowerDetectedSetupTarget);
    }

    if (!followerHardwareProfile) {
      setPanelStatusMessage("No LeRobot robot target is available.");
      return false;
    }
    if (!providerManifest?.capabilities.control) {
      setPanelStatusMessage("Follower control is not available.");
      return false;
    }
    if (!collaborationTeleopPermitted) {
      setPanelStatusMessage("Teleop capability is required before connecting follower hardware.");
      return false;
    }
    if (!selectedFollowerHardwareDeviceKey) {
      setPanelStatusMessage("No concrete follower hardware device is selected.");
      return false;
    }
    const activeRoleAssignments =
      Object.keys(operatorLeaderAssignments).length === 0
        ? releaseStoredOperatorLeaderRoles()
        : operatorDeviceRoleAssignments;
    const roleAssignment = lerobotFollowerHardwareSelected
      ? {
          accepted: true as const,
          assignments: releaseOperatorDeviceRoleForKeys(
            activeRoleAssignments,
            selectedFollowerHardwareDeviceKeys,
          ),
          conflict: null,
        }
      : assignOperatorDeviceRoleForKeys(
          activeRoleAssignments,
          selectedFollowerHardwareDeviceKeys,
          "follower",
        );
    if (!roleAssignment.accepted) {
      if (activeRoleAssignments !== operatorDeviceRoleAssignments) {
        setOperatorDeviceRoleAssignments(activeRoleAssignments);
      }
      setPanelStatusMessage(roleAssignment.conflict);
      return false;
    }

    setRequestedTeleoperationMode(OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE);
    if (selectedProfileId !== followerHardwareProfile.id) {
      clearActiveControls();
      commandQueue.clearQueued();
      setLastPreviewTwist(OPERATOR_HELPER_STOP_TWIST);
      setSelectedProfileId(followerHardwareProfile.id);
    }
    const leaseAccepted = followerHardwareProfile.capabilities.jointJog
      ? await requestControlLeaseForProfile(followerHardwareProfile)
      : true;
    if (leaseAccepted) {
      setOperatorDeviceRoleAssignments(roleAssignment.assignments);
      writeOperatorDeviceRoleAssignments(roleAssignment.assignments);
      setConnectedFollowerHardwareDeviceKey(selectedFollowerHardwareDeviceKey);
      setFollowerHardwareConnectionSelected(true);
      setPanelStatusMessage("Robot hardware connected.");
      return true;
    }
    return false;
  }, [
    baseUrl,
    clearActiveControls,
    collaborationTeleopPermitted,
    collaborationTeleopAuthorization,
    commandQueue,
    followerHardwareConnectionActive,
    followerHardwareDisconnectAvailable,
    connectedFollowerHardwareDeviceKey,
    handleApplyDetectedFollowerSetup,
    handleReleaseLease,
    leaseHeldByThisOperator,
    lerobotFollowerHardwareSelected,
    operatorDeviceRoleAssignments,
    operatorLeaderAssignments,
    providerManifest?.capabilities.control,
    followerHardwareProfile,
    requestControlLeaseForProfile,
    selectedFollowerDetectedSetupTarget,
    selectedProfileId,
    selectedFollowerHardwareDeviceKey,
    selectedFollowerHardwareDeviceKeys,
    setPanelStatusMessage,
  ]);

  return (
    <div className="space-y-2 text-[11px]">
      {openArmCameraObserveEligible ? (
        <div className="rounded-md border border-border/40 bg-background/40 p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-foreground">
                OpenArm live
              </div>
              <div className="truncate text-[9px] text-muted-foreground">
                {openArmHfLiveObserveStatus}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              className={controlButtonClass}
              disabled={
                openArmHfLiveObserveRequested &&
                !openArmDemoLiveObserveManuallyDisconnected
              }
              onClick={handleConnectOpenArmLiveObserve}
            >
              Connect live
            </button>
            <button
              type="button"
              className={controlButtonClass}
              disabled={!openArmHfLiveObserveRequested}
              onClick={handleDisconnectOpenArmLiveObserve}
            >
              Disconnect live
            </button>
          </div>
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-medium text-foreground">
                CAN telemetry
              </div>
              <div className="font-mono text-[9px] text-muted-foreground">
                {openArmLiveJointTelemetryRows.length} joints
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_46px_46px_46px] gap-x-1.5 text-[9px] text-muted-foreground">
              <div>joint</div>
              <div className="text-right">pos</div>
              <div className="text-right">vel</div>
              <div className="text-right">tau</div>
            </div>
            <div className="max-h-36 space-y-0.5 overflow-y-auto pr-1">
              {openArmLiveJointTelemetryRows.length > 0 ? (
                openArmLiveJointTelemetryRows.map(
                  ([jointName, telemetry]) => (
                    <div
                      key={jointName}
                      className="grid grid-cols-[minmax(0,1fr)_46px_46px_46px] gap-x-1.5 font-mono text-[9px] text-foreground"
                    >
                      <div
                        className="truncate"
                        title={`${jointName} from ${telemetry.sourceLabel}`}
                      >
                        {jointName}
                      </div>
                      <div className="text-right">
                        {formatOpenArmLiveJointTelemetryValue(
                          telemetry.positionRad,
                        )}
                      </div>
                      <div className="text-right">
                        {formatOpenArmLiveJointTelemetryValue(
                          telemetry.velocityRadPerSec,
                        )}
                      </div>
                      <div className="text-right">
                        {formatOpenArmLiveJointTelemetryValue(
                          telemetry.torqueNm,
                        )}
                      </div>
                    </div>
                  ),
                )
              ) : (
                <div className="text-[9px] text-muted-foreground">
                  Waiting for live CAN frames.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {showStudioTeleopTools ? (
        <>
          {studioTeleopControlGroups.length > 0 ? (
            renderLeaderCandidates()
          ) : (
            <div className="rounded-md border border-border/40 bg-background/40 p-2 text-[10px] text-amber-200">
              No controllable arm targets found.
            </div>
          )}

          {advertisedLeaderArmInputs.length > 0 ? (
            <div className="rounded-md border border-border/40 bg-background/40 p-2 text-[10px] text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">
                Provider leader inputs
              </div>
              <div className="space-y-1">
                {advertisedLeaderArmInputs.map((input) => (
                  <div
                    key={`${input.kind}:${input.id}`}
                    className="rounded border border-border/30 bg-black/10 p-1.5"
                  >
                    <div className="truncate font-medium text-foreground">
                      {input.label || input.kind}
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {input.summary || "Ready when the provider is connected."}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {showFollowerHardwareTools ? (
        <OperatorFollowerConnectionCard
          buttonClassName={controlButtonClass}
          calibration={{
            available: followerCalibrationAvailable,
            command: followerCalibrationEntry.command,
            isStarting: isOperatorCalibrationUiActive(
              calibrationUi,
              OPERATOR_CALIBRATION_UI_KEYS.follower,
            ),
            message: followerCalibrationEntry.message,
            required: followerCalibrationRequired,
            onStart: () => {
              void handleStartFollowerCalibration();
            },
          }}
          calibrationFileEdit={{
            available: followerCalibrationFileEditAvailable,
            disabled: followerCalibrationFileEditDisabled,
            active: activeFollowerCalibrationFileEditSession !== null,
            busy: activeFollowerCalibrationFileEditSession?.busy === true,
            message: activeFollowerCalibrationFileEditSession?.message ?? null,
            jointCount:
              activeFollowerCalibrationFileEditSession?.jointNames.length ?? 0,
            motionRows: activeFollowerCalibrationFileEditSession
              ? assignOperatorCalibrationFileEditTargetJointNames({
                  motionRows: calibrationFileEditMotionRows,
                  sourceJointNames: activeFollowerCalibrationFileEditSession.jointNames,
                  targetJointNames: activeFollowerCalibrationFileEditSession.jointNames,
                })
              : [],
            onStart: () => {
              void (async () => {
                const connected =
                  followerHardwareConnectionActive ||
                  (await handleToggleFollowerHardwareConnection());
                if (!connected) {
                  return;
                }
                await handleStartFollowerCalibrationFileEdit();
              })();
            },
            onOpenFile: () => {
              void handleOpenCalibrationFileEditFile();
            },
            onCancel: handleCloseCalibrationFileEdit,
          }}
          calibrationSourceSelection={{
            error: lerobotCalibrationCatalogError,
            options: followerCalibrationSourceOptions,
            selectedSourceId: selectedFollowerCalibrationSourceId,
            showAll: followerCalibrationShowAllSources,
            onSelectSource: setSelectedFollowerCalibrationSourceId,
            onToggleShowAll: () =>
              setFollowerCalibrationShowAllSources((current) => !current),
          }}
          camera={
            showFollowerHardwareCameraSummary
              ? {
                  count: providerCameraStreams.length,
                  selectedLabel: selectedCameraStream?.label ?? null,
                  statusLabel: selectedCameraStream
                    ? "Camera detected."
                    : "No camera stream.",
                  detailLines: [
                    providerCameraStreams.length > 0
                      ? `${providerCameraStreams.length} camera${providerCameraStreams.length === 1 ? "" : "s"} advertised by gateway.`
                      : "No camera stream.",
                    selectedCameraStream
                      ? `${selectedCameraStream.coordinateFrame}, ${selectedCameraStream.intrinsics.width}x${selectedCameraStream.intrinsics.height}`
                      : "",
                  ].filter(Boolean),
                }
              : undefined
          }
          connection={{
            connectDisabled: followerHardwareConnectDisabled,
            issue: followerConnectionIssue,
            isBusy: leaseBusy || followerDetectedSetupApplying,
            isConnected: followerHardwareConnectionActive,
            isDisconnectAvailable: followerHardwareDisconnectAvailable,
            motionReady: followerHardwareMotionReady,
            motionSafetyLabel: followerHardwareMotionSafetyLabel,
            onToggleConnection: () => {
              void handleToggleFollowerHardwareConnection();
            },
          }}
          directTeleop={lerobotDirectTeleop.card}
          hardwareDetection={{
            requested: openArmLeaderDetectionRequested,
            resolved: openArmLeaderDetectionResolved,
            error: openArmLeaderDetectionError,
            targets: followerHardwareDetectedTargets,
            onScan: handleOpenArmLeaderScan,
          }}
          targetSelection={{
            disabled:
              leaseBusy ||
              followerDetectedSetupApplying ||
              followerHardwareConnectionActive,
            options: followerHardwareTargetOptions,
            selectedProfileId:
              followerHardwareProfile?.id ??
              selectedFollowerDetectedSetupTarget?.id ??
              "",
            onSelectProfile: (profileId) => {
              setSelectedFollowerProfileId(profileId || null);
            },
          }}
          envConfig={{
            configRef: followerEnvConfigPath ?? followerConnectionConfigRef,
            error: followerEnvConfigError,
            isOpening: followerEnvConfigOpening,
            onOpen: () => void handleOpenFollowerEnvConfig(),
          }}
        />
      ) : null}

      {showGatewayLiveCameraTools ? (
        <div className="rounded-md border border-border/40 bg-background/40 p-2 text-[10px] text-muted-foreground">
          <div className="mb-2 font-medium text-foreground">
            Camera MoQ live tracks
          </div>
          {providerCameraStreams.length > 0 ? (
            <>
              <label className="block">
                camera
                <select
                  className="mt-1 h-7 w-full rounded-md border border-border/60 bg-background px-2 font-mono text-[10px] text-foreground"
                  value={selectedCameraStreamId}
                  onChange={(event) =>
                    setSelectedCameraStreamId(event.target.value)
                  }
                >
                  {providerCameraStreams.map((stream) => (
                    <option key={stream.id} value={stream.id}>
                      {stream.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-1 truncate font-mono text-foreground">
                {cameraLiveStatusMessage}
              </div>
              <div className="mt-0.5 truncate font-mono">
                {providerManifest?.liveTransport
                  ? `${selectedCameraLiveTracks.length} camera tracks, ${gatewayTelemetryTrackCount} telemetry tracks`
                  : "Live camera/depth/cloud streams require a MoQ transport descriptor."}
              </div>
              <div className="mt-0.5 truncate font-mono">
                {selectedCameraVideoTrack
                  ? "Video track ready."
                  : "No MoQ video track for this camera."}
              </div>
              <div className="mt-0.5 truncate font-mono">
                {providerManifest?.controlTransport
                  ? "Control datagram transport ready."
                  : "Control datagrams require a teleop sidecar descriptor."}
              </div>
              <div className="mt-0.5">
                {selectedCameraStream
                  ? `${selectedCameraStream.coordinateFrame}, ${selectedCameraStream.intrinsics.width}x${selectedCameraStream.intrinsics.height}`
                  : "No camera stream."}
              </div>
            </>
          ) : (
            <div>No camera stream advertised by this gateway.</div>
          )}
          <div className="mt-2 flex flex-col gap-1">
            <button
              type="button"
              className={controlButtonClass}
              disabled={
                !pointCloudAutocalibrationAvailable ||
                pointCloudAutocalibrationActive ||
                pointCloudAutocalibrationReviewReady
              }
              onClick={requestPointCloudAutocalibration}
            >
              {pointCloudAutocalibrationActive
                ? "Autocalibrating camera(s)"
                : "Autocalibrate camera(s)"}
            </button>
            {pointCloudAutocalibrationReview ? (
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  className={controlButtonClass}
                  onClick={acceptPointCloudAutocalibration}
                >
                  Accept calibration
                </button>
                <button
                  type="button"
                  className={controlButtonClass}
                  onClick={discardPointCloudAutocalibration}
                >
                  Discard
                </button>
              </div>
            ) : null}
            <div className="truncate font-mono">
              {pointCloudAutocalibrationReview
                ? `${pointCloudAutocalibrationReview.cameraCount} camera preview ready.`
                : pointCloudAutocalibrationAvailable
                  ? `${activePointCloudFrameCount} point-cloud source${activePointCloudFrameCount === 1 ? "" : "s"} ready.`
                  : "Autocalibration waits for live point cloud."}
            </div>
            <button
              type="button"
              className={controlButtonClass}
              disabled={
                !pointCloudAutocalibrationAvailable || pointCloudSceneMeshActive
              }
              onClick={requestPointCloudSceneMeshes}
            >
              {pointCloudSceneMeshActive
                ? "Creating scene meshes"
                : "Auto-create scene meshes from cloud"}
            </button>
            <div className="truncate font-mono">
              {pointCloudSceneMeshStatus ||
                "Scene meshes use the current point-cloud surfaces."}
            </div>
          </div>
        </div>
      ) : null}

      {showFollowerHardwareTools && robotModelMismatchBlocksControl && !followerHardwareRoleConflict ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
          {robotModelMismatchMessage}
        </div>
      ) : null}

      {showFollowerHardwareTools && !collaborationTeleopPermitted ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
          This collaboration link can view the room but cannot teleoperate. Ask
          the owner for a teleop invite.
        </div>
      ) : null}

      {showFollowerHardwareTools && followerHardwareConnected && baseTwistSupported ? (
        <div className="rounded-md border border-border/40 bg-background/40 p-2">
          <div className="mb-2 text-[10px] text-muted-foreground">
            Base drive
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div />
            {renderHoldButton("forward", "Forward")}
            <div />
            {renderHoldButton("rotate-left", "Yaw left")}
            <button
              type="button"
              className={controlButtonClass}
              disabled={!baseTwistAvailable}
              onClick={clearMotion}
            >
              Stop
            </button>
            {renderHoldButton("rotate-right", "Yaw right")}
            {renderHoldButton("strafe-left", "Left", { requiresStrafe: true })}
            {renderHoldButton("backward", "Back")}
            {renderHoldButton("strafe-right", "Right", { requiresStrafe: true })}
          </div>
        </div>
      ) : null}

      {showFollowerHardwareTools &&
      followerHardwareConnected &&
      selectedProfile?.capabilities.jointJog ? (
        <div className="rounded-md border border-border/40 bg-background/40 p-2">
          <div className="mb-2 text-[10px] text-muted-foreground">
            Joint jog
          </div>
          <label className="block text-[10px] text-muted-foreground">
            joint
            <select
              className="mt-1 h-7 w-full rounded-md border border-border/60 bg-background px-2 font-mono text-[10px] text-foreground"
              value={selectedJointJogName}
              disabled={!jointSelectorAvailable || jointJogBusy}
              onChange={(event) => setSelectedJointJogName(event.target.value)}
            >
              {controlledJointNames.length === 0 ? (
                <option value="">No controlled joints</option>
              ) : (
                controlledJointNames.map((jointName) => (
                  <option key={jointName} value={jointName}>
                    {jointName}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="mt-2 block text-[10px] text-muted-foreground">
            Step {jointJogStepRad.toFixed(3)} rad
            <input
              className="mt-1 w-full"
              type="range"
              min={OPERATOR_HELPER_JOINT_JOG_STEP_MIN_RAD}
              max={jointJogStepMaxRad}
              step={OPERATOR_HELPER_JOINT_JOG_STEP_RAD}
              value={jointJogStepRad}
              disabled={!jointJogAvailable || jointJogBusy}
              onChange={(event) =>
                setJointJogStepRad(Number(event.target.value))
              }
            />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              className={controlButtonClass}
              disabled={!jointJogAvailable || jointJogBusy}
              onClick={() => {
                void handleJointJog(OPERATOR_HELPER_DIRECTION_NEGATIVE);
              }}
            >
              Jog -
            </button>
            <button
              type="button"
              className={controlButtonClass}
              disabled={!jointJogAvailable || jointJogBusy}
              onClick={() => {
                void handleJointJog(OPERATOR_HELPER_DIRECTION_POSITIVE);
              }}
            >
              Jog +
            </button>
          </div>
          <div className="mt-2 rounded border border-amber-500/35 bg-amber-500/10 p-1.5 text-[10px] text-amber-200">
            Manual calibration only.
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              className={controlButtonClass}
              disabled={!openArmCalibrationJogAvailable || jointJogBusy}
              onClick={() => {
                void handleOpenArmCalibrationJog(
                  OPERATOR_HELPER_DIRECTION_NEGATIVE,
                );
              }}
            >
              Calibrate jog -
            </button>
            <button
              type="button"
              className={controlButtonClass}
              disabled={!openArmCalibrationJogAvailable || jointJogBusy}
              onClick={() => {
                void handleOpenArmCalibrationJog(
                  OPERATOR_HELPER_DIRECTION_POSITIVE,
                );
              }}
            >
              Calibrate jog +
            </button>
          </div>
          <button
            type="button"
            className={`${controlButtonClass} mt-2 w-full`}
            disabled={!openArmCalibrationJogAvailable || jointJogBusy}
            onClick={() => {
              void handleOpenArmCalibrationTestAll();
            }}
          >
            Test all arm joints
          </button>
        </div>
      ) : null}

      {showFollowerHardwareTools && followerHardwareConnected && baseTwistSupported ? (
        <>
          <label className="block text-[10px] text-muted-foreground">
            Linear speed {linearSpeedMps.toFixed(2)} m/s
            <input
              className="mt-1 w-full"
              type="range"
              min={OPERATOR_HELPER_LINEAR_SPEED_MIN_MPS}
              max={linearSpeedMaxMps}
              step={OPERATOR_HELPER_LINEAR_SPEED_STEP_MPS}
              value={linearSpeedMps}
              onChange={(event) => setLinearSpeedMps(Number(event.target.value))}
            />
          </label>
          <label className="block text-[10px] text-muted-foreground">
            Yaw speed {yawSpeedRps.toFixed(2)} rad/s
            <input
              className="mt-1 w-full"
              type="range"
              min={OPERATOR_HELPER_YAW_SPEED_MIN_RPS}
              max={yawSpeedMaxRps}
              step={OPERATOR_HELPER_YAW_SPEED_STEP_RPS}
              value={yawSpeedRps}
              onChange={(event) => setYawSpeedRps(Number(event.target.value))}
            />
          </label>

          <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[10px]">
            <div className="text-muted-foreground">Last drive command</div>
            <div className="truncate font-mono text-foreground">
              {formatTwist(lastPreviewTwist)}
            </div>
          </div>
        </>
      ) : null}

      {showFollowerHardwareTools && followerHardwareConnected ? (
      <div className="flex gap-2">
        <button
          type="button"
          className="h-8 flex-1 rounded-md border border-red-500/50 bg-red-500/15 px-2 text-[11px] font-semibold text-red-200 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!estopAvailable}
          onClick={() => {
            void handleEstop();
          }}
        >
          E-stop
        </button>
        <button
          type="button"
          className="h-8 rounded-md border border-border/60 bg-background/60 px-2 text-[11px] text-foreground hover:bg-muted/45"
          onClick={() => {
            void refreshOperatorState();
          }}
        >
          Refresh
        </button>
      </div>
      ) : null}

      {showCameraLiveTools ? (
      <label className="block text-[10px] text-muted-foreground">
        status endpoint
        <input
          className="mt-1 h-7 w-full rounded-md border border-border/60 bg-background px-2 font-mono text-[10px] text-foreground"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <span className="mt-1 block text-[10px] text-muted-foreground/80">
          Relay URL for watch mode. Robot gateway URL for active teleop control.
        </span>
      </label>
      ) : null}

      {showCameraLiveTools ? (
      <div
        className={cn(
          "rounded-md border px-2 py-1 text-[10px]",
          controlEnabled
            ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
            : "border-border/50 bg-background/40 text-muted-foreground",
        )}
      >
        {statusMessage}
        {typeof stats?.operator_rtt_ms === "number"
          ? ` RTT ${stats.operator_rtt_ms.toFixed(1)} ms`
          : ""}
      </div>
      ) : null}
    </div>
  );
};

type OperatorTeleopPanelShellProps = OperatorTeleopPanelProps & {
  open?: boolean;
  onClose: () => void;
};

const getOperatorTeleopPanelTitle = (panelView: OperatorTeleopPanelView): string => {
  return (
    OPERATOR_TELEOP_PANEL_COPY[panelView]?.panelTitle ??
    OPERATOR_TELEOP_PANEL_FALLBACK_COPY.panelTitle
  );
};

const getOperatorTeleopPanelSubtitle = (panelView: OperatorTeleopPanelView): string => {
  return (
    OPERATOR_TELEOP_PANEL_COPY[panelView]?.panelSubtitle ??
    OPERATOR_TELEOP_PANEL_FALLBACK_COPY.panelSubtitle
  );
};

export const OperatorTeleopPanelShell = ({
  panelView = "hardware",
  studioRobotName,
  collaborationSessionId = null,
  teleopCapabilityToken = null,
  collaborationOwnerToken = null,
  open = true,
  onClose,
}: OperatorTeleopPanelShellProps) => (
  <div
    className={cn(
      "fixed inset-x-2 bottom-2 top-12 z-50 flex min-h-0 max-h-[calc(100dvh-3.5rem)] flex-col overflow-hidden rounded-md border border-border/40 bg-background/95 shadow-lg backdrop-blur-sm sm:bottom-4 sm:left-4 sm:right-auto sm:w-[min(calc(100vw-2rem),420px)]",
      !open && "hidden",
    )}
    aria-hidden={!open}
  >
    <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-foreground">
          {getOperatorTeleopPanelTitle(panelView)}
        </div>
        <div className="truncate text-[10px] text-muted-foreground">
          {getOperatorTeleopPanelSubtitle(panelView)}
        </div>
      </div>
      <button
        type="button"
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onClose}
        aria-label="Close teleop panel"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3 minimal-scrollbar">
      <OperatorTeleopPanel
        panelView={panelView}
        studioRobotName={studioRobotName}
        collaborationSessionId={collaborationSessionId}
        teleopCapabilityToken={teleopCapabilityToken}
        collaborationOwnerToken={collaborationOwnerToken}
      />
    </div>
  </div>
);
