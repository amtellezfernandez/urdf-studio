// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  OPERATOR_HELPER_DEFAULT_LINEAR_SPEED_MPS,
  OPERATOR_HELPER_DEFAULT_OPERATOR_ID,
  OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
  OPERATOR_TELEOP_PANEL_STATE_STORAGE,
} from "@/features/teleop/params/operatorTeleopParams";
import {
  readOperatorTeleopPanelState,
  type OperatorTeleopPanelPersistedState,
  writeOperatorTeleopPanelState,
} from "@/features/teleop/panel/operatorTeleopPanelPersistence";
import { normalizeOperatorProviderManifest } from "@/features/teleop/transport/operatorHelperApi";

afterEach(() => {
  window.localStorage.clear();
});

describe("operator teleop panel persistence", () => {
  it("persists durable panel context and the last provider manifest", () => {
    const { savedState, expectedState } =
      buildOperatorTeleopPanelPersistenceFixture();

    writeOperatorTeleopPanelState(savedState);

    expect(readOperatorTeleopPanelState()).toMatchObject(expectedState);
  });

  it("falls back to defaults for corrupt storage payloads", () => {
    window.localStorage.setItem(
      OPERATOR_TELEOP_PANEL_STATE_STORAGE.key,
      "not-json",
    );

    expect(readOperatorTeleopPanelState()).toMatchObject({
      operatorId: OPERATOR_HELPER_DEFAULT_OPERATOR_ID,
      selectedProfileId: null,
      providerManifest: null,
    });
  });
});

function buildOperatorTeleopPanelPersistenceFixture(): {
  savedState: Partial<OperatorTeleopPanelPersistedState>;
  expectedState: object;
} {
  const data = {
    baseUrl: "http://offline-gateway.local",
    operatorId: "field-operator",
    profileId: "openarm_follower_joint_jog",
    cameraStreamId: "openarm_depth_camera",
    jointName: "arm_elbow_flex",
    linearSpeedMps: 0.35,
    yawSpeedRps: 0.7,
    jointStepRad: 0.02,
    cameraWidthPx: 48,
    cameraHeightPx: 32,
    cameraFocalPx: 46,
    cameraPrincipalPointPx: 24,
    commandTickMs: 100,
    deadmanTimeoutMs: 300,
    maxJointJogDeltaRad: 0.05,
    defaultJointJogStepRad: 0.01,
    maxJointVelocityRadPerSec: 0.5,
  } as const;
  const providerManifest = normalizeOperatorProviderManifest({
    contract_version: "urdf-studio.teleop-provider.v1",
    provider_id: "test-provider",
    provider_display_name: "Test Provider",
    capabilities: {
      observe: true,
      telemetry: true,
      video: false,
      record: false,
      control: true,
      estop: true,
    },
    profiles: [
      {
        id: data.profileId,
        label: "OpenArm follower joint jog",
        summary: "Follower arm profile.",
        control_target_label: "OpenArm arm",
        transport: "robot_gateway",
        robot_family: "manipulator",
        robot_id: "openarm",
        adapter_id: "openarm_native",
        teleoperation_mode: OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
        controlled_joint_names: [data.jointName],
        capabilities: {
          base_twist: false,
          lateral_strafe: false,
          arm_joint_state: true,
          arm_joint_command: true,
          state_mirroring: true,
          joint_jog: true,
        },
        topics: {
          joint_states: ["provider:/joint_states"],
        },
        limits: {
          max_linear_speed_mps: OPERATOR_HELPER_DEFAULT_LINEAR_SPEED_MPS,
          max_yaw_speed_rps: data.yawSpeedRps,
          command_tick_ms: data.commandTickMs,
          deadman_timeout_ms: data.deadmanTimeoutMs,
          max_joint_jog_delta_rad: data.maxJointJogDeltaRad,
          default_joint_jog_step_rad: data.defaultJointJogStepRad,
          max_joint_velocity_rad_per_s: data.maxJointVelocityRadPerSec,
        },
      },
    ],
    camera_streams: [
      {
        id: data.cameraStreamId,
        label: "OpenArm depth camera",
        kind: "rgbd",
        frame_id: "openarm_depth_camera",
        coordinate_frame: "robot_world",
        intrinsics: {
          width: data.cameraWidthPx,
          height: data.cameraHeightPx,
          fx: data.cameraFocalPx,
          fy: data.cameraFocalPx,
          ppx: data.cameraPrincipalPointPx,
          ppy: data.cameraPrincipalPointPx,
        },
        capabilities: {
          color: true,
          depth: true,
          point_cloud: true,
        },
      },
    ],
  });

  return {
    savedState: {
      baseUrl: data.baseUrl,
      operatorId: data.operatorId,
      requestedTeleoperationMode: OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
      selectedProfileId: data.profileId,
      selectedFollowerProfileId: data.profileId,
      selectedCameraStreamId: data.cameraStreamId,
      selectedJointJogName: data.jointName,
      linearSpeedMps: data.linearSpeedMps,
      yawSpeedRps: data.yawSpeedRps,
      jointJogStepRad: data.jointStepRad,
      providerManifestBaseUrl: data.baseUrl,
      providerManifest,
    },
    expectedState: {
      baseUrl: data.baseUrl,
      operatorId: data.operatorId,
      requestedTeleoperationMode: OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
      selectedProfileId: data.profileId,
      selectedFollowerProfileId: data.profileId,
      selectedCameraStreamId: data.cameraStreamId,
      selectedJointJogName: data.jointName,
      linearSpeedMps: data.linearSpeedMps,
      yawSpeedRps: data.yawSpeedRps,
      jointJogStepRad: data.jointStepRad,
      providerManifestBaseUrl: data.baseUrl,
      providerManifest: {
        providerId: providerManifest.providerId,
        profiles: [{ id: data.profileId }],
        cameraStreams: [{ id: data.cameraStreamId }],
      },
    },
  };
}
