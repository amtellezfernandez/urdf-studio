import { describe, expect, it } from "vitest";

import {
  OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
  OPERATOR_TELEOPERATION_MODE_SIMULATED,
  OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC,
  OPERATOR_TELEOP_PHYSICS_SOURCE_GATEWAY_PROXY,
  OPERATOR_TELEOP_PHYSICS_SOURCE_NONE,
  OPERATOR_TELEOP_PHYSICS_SOURCE_REAL_WORLD,
  OPERATOR_TELEOP_REPLAY_GUARANTEE_GATEWAY_DETERMINISTIC,
  OPERATOR_TELEOP_REPLAY_GUARANTEE_KINEMATIC,
} from "@/features/teleop/params/operatorTeleopParams";
import {
  canValidateOperatorTeleopReplay,
  classifyOperatorTeleopEpisode,
  getOperatorTeleopLeRobotExportButtonLabel,
  isOperatorTeleopStudioKinematicEpisode,
  resolveOperatorTeleopLeRobotExportMode,
  resolveOperatorTeleopRecordingProvenance,
} from "@/features/teleop/recording/operatorTeleopProvenance";

type TestSampleParams = {
  commandKind: string;
  teleoperationMode:
    | typeof OPERATOR_TELEOPERATION_MODE_SIMULATED
    | typeof OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE
    | typeof OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC;
  physicsSource:
    | typeof OPERATOR_TELEOP_PHYSICS_SOURCE_GATEWAY_PROXY
    | typeof OPERATOR_TELEOP_PHYSICS_SOURCE_REAL_WORLD
    | typeof OPERATOR_TELEOP_PHYSICS_SOURCE_NONE;
  replayGuarantee:
    | typeof OPERATOR_TELEOP_REPLAY_GUARANTEE_GATEWAY_DETERMINISTIC
    | typeof OPERATOR_TELEOP_REPLAY_GUARANTEE_KINEMATIC;
};

const buildSample = ({
  commandKind,
  teleoperationMode,
  physicsSource,
  replayGuarantee,
}: TestSampleParams) => ({
  command: {
    kind: commandKind,
  },
  context: {
    teleoperationMode,
    physicsSource,
    replayGuarantee,
  },
});

const buildEpisode = (sample: TestSampleParams) => ({
  samples: [buildSample(sample)],
});

const TEST_KINEMATIC_SAMPLE = {
  commandKind: "joint_targets",
  teleoperationMode: OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC,
  physicsSource: OPERATOR_TELEOP_PHYSICS_SOURCE_NONE,
  replayGuarantee: OPERATOR_TELEOP_REPLAY_GUARANTEE_KINEMATIC,
} as const;

const TEST_GATEWAY_SAMPLE = {
  commandKind: "joint_jog",
  teleoperationMode: OPERATOR_TELEOPERATION_MODE_SIMULATED,
  physicsSource: OPERATOR_TELEOP_PHYSICS_SOURCE_GATEWAY_PROXY,
  replayGuarantee: OPERATOR_TELEOP_REPLAY_GUARANTEE_GATEWAY_DETERMINISTIC,
} as const;

const TEST_UNSUPPORTED_GATEWAY_TWIST_SAMPLE = {
  commandKind: "twist",
  teleoperationMode: OPERATOR_TELEOPERATION_MODE_SIMULATED,
  physicsSource: OPERATOR_TELEOP_PHYSICS_SOURCE_GATEWAY_PROXY,
  replayGuarantee: OPERATOR_TELEOP_REPLAY_GUARANTEE_GATEWAY_DETERMINISTIC,
} as const;

const TEST_REAL_HARDWARE_SAMPLE = {
  commandKind: "joint_jog",
  teleoperationMode: OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
  physicsSource: OPERATOR_TELEOP_PHYSICS_SOURCE_REAL_WORLD,
  replayGuarantee: OPERATOR_TELEOP_REPLAY_GUARANTEE_GATEWAY_DETERMINISTIC,
} as const;

const TEST_INVALID_KINEMATIC_PROVENANCE_SAMPLE = {
  commandKind: "joint_targets",
  teleoperationMode: OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC,
  physicsSource: OPERATOR_TELEOP_PHYSICS_SOURCE_GATEWAY_PROXY,
  replayGuarantee: OPERATOR_TELEOP_REPLAY_GUARANTEE_KINEMATIC,
} as const;

const buildMixedEpisode = () => ({
  samples: [
    buildSample(TEST_GATEWAY_SAMPLE),
    buildSample(TEST_KINEMATIC_SAMPLE),
  ],
});

describe("operator teleop provenance", () => {
  it("resolves physical provenance from teleoperation mode", () => {
    expect(
      resolveOperatorTeleopRecordingProvenance(OPERATOR_TELEOPERATION_MODE_SIMULATED),
    ).toEqual({
      physicsSource: OPERATOR_TELEOP_PHYSICS_SOURCE_GATEWAY_PROXY,
      replayGuarantee: OPERATOR_TELEOP_REPLAY_GUARANTEE_GATEWAY_DETERMINISTIC,
    });
    expect(
      resolveOperatorTeleopRecordingProvenance(
        OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
      ),
    ).toEqual({
      physicsSource: OPERATOR_TELEOP_PHYSICS_SOURCE_REAL_WORLD,
      replayGuarantee: OPERATOR_TELEOP_REPLAY_GUARANTEE_GATEWAY_DETERMINISTIC,
    });
    expect(
      resolveOperatorTeleopRecordingProvenance(
        OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC,
      ),
    ).toEqual({
      physicsSource: OPERATOR_TELEOP_PHYSICS_SOURCE_NONE,
      replayGuarantee: OPERATOR_TELEOP_REPLAY_GUARANTEE_KINEMATIC,
    });
  });

  it("separates Studio IK export policy from gateway replay policy", () => {
    const kinematicEpisode = buildEpisode(TEST_KINEMATIC_SAMPLE);
    const gatewayEpisode = buildEpisode(TEST_GATEWAY_SAMPLE);

    expect(classifyOperatorTeleopEpisode(kinematicEpisode)).toBe("studio_kinematic");
    expect(isOperatorTeleopStudioKinematicEpisode(kinematicEpisode)).toBe(true);
    expect(canValidateOperatorTeleopReplay(kinematicEpisode)).toBe(false);
    expect(resolveOperatorTeleopLeRobotExportMode(kinematicEpisode, false)).toBe(
      "studio_kinematic",
    );
    expect(getOperatorTeleopLeRobotExportButtonLabel("studio_kinematic")).toBe(
      "Export kinematic",
    );

    expect(classifyOperatorTeleopEpisode(gatewayEpisode)).toBe("gateway_replay");
    expect(isOperatorTeleopStudioKinematicEpisode(gatewayEpisode)).toBe(false);
    expect(canValidateOperatorTeleopReplay(gatewayEpisode)).toBe(true);
    expect(resolveOperatorTeleopLeRobotExportMode(gatewayEpisode, false)).toBeNull();
    expect(resolveOperatorTeleopLeRobotExportMode(gatewayEpisode, true)).toBe(
      "gateway_replay",
    );
    expect(getOperatorTeleopLeRobotExportButtonLabel("gateway_replay")).toBe(
      "Export LeRobot",
    );
  });

  it("blocks empty, mixed, and malformed episodes from replay and export", () => {
    const emptyEpisode = { samples: [] };
    const mixedEpisode = buildMixedEpisode();
    const invalidKinematicEpisode = buildEpisode(
      TEST_INVALID_KINEMATIC_PROVENANCE_SAMPLE,
    );
    const realHardwareEpisode = buildEpisode(TEST_REAL_HARDWARE_SAMPLE);

    expect(classifyOperatorTeleopEpisode(null)).toBe("empty");
    expect(classifyOperatorTeleopEpisode(emptyEpisode)).toBe("empty");
    expect(canValidateOperatorTeleopReplay(emptyEpisode)).toBe(false);
    expect(resolveOperatorTeleopLeRobotExportMode(emptyEpisode, true)).toBeNull();

    expect(classifyOperatorTeleopEpisode(mixedEpisode)).toBe("mixed_invalid");
    expect(canValidateOperatorTeleopReplay(mixedEpisode)).toBe(false);
    expect(resolveOperatorTeleopLeRobotExportMode(mixedEpisode, true)).toBeNull();

    expect(classifyOperatorTeleopEpisode(invalidKinematicEpisode)).toBe(
      "mixed_invalid",
    );
    expect(canValidateOperatorTeleopReplay(invalidKinematicEpisode)).toBe(false);
    expect(
      resolveOperatorTeleopLeRobotExportMode(invalidKinematicEpisode, true),
    ).toBeNull();

    expect(classifyOperatorTeleopEpisode(realHardwareEpisode)).toBe("gateway_replay");
    expect(canValidateOperatorTeleopReplay(realHardwareEpisode)).toBe(true);
  });

  it("blocks gateway commands that the backend replay executor cannot reproduce", () => {
    const unsupportedGatewayEpisode = buildEpisode(
      TEST_UNSUPPORTED_GATEWAY_TWIST_SAMPLE,
    );

    expect(classifyOperatorTeleopEpisode(unsupportedGatewayEpisode)).toBe(
      "mixed_invalid",
    );
    expect(canValidateOperatorTeleopReplay(unsupportedGatewayEpisode)).toBe(false);
    expect(
      resolveOperatorTeleopLeRobotExportMode(unsupportedGatewayEpisode, true),
    ).toBeNull();
  });
});
