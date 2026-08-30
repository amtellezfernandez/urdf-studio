import { describe, expect, it } from "vitest";

import {
  OPERATOR_BI_OPENARM_MINI_TELEOPERATOR_TYPE,
  OPERATOR_LEADER_SIDES,
  OPERATOR_OPENARM_MINI_TELEOPERATOR_TYPE,
} from "@/features/teleop/params/operatorTeleopParams";
import {
  resolveLeRobotDirectTeleopLeaderRequest,
} from "@/features/teleop/panel/useOperatorLeRobotDirectTeleop";
import type { OperatorLeaderTelemetryTarget } from "@/features/teleop/transport/operatorLeaderTelemetry";

const buildTeleoperatorTarget = (
  overrides: Partial<OperatorLeaderTelemetryTarget> = {},
): OperatorLeaderTelemetryTarget => ({
  id: "leader",
  path: "/dev/serial/by-id/leader",
  identityKey: "serial:leader",
  label: "Leader arm",
  side: OPERATOR_LEADER_SIDES.both,
  motorIds: [],
  motorModel: null,
  calibrationCategory: "teleoperators",
  calibrationProfile: "so100_leader",
  calibrationId: "so100-leader",
  calibrationGroup: "all",
  calibrationRevision: 0,
  sourceJointNames: [],
  targetJointNames: [],
  targetJointDirections: [],
  sourceNeutralPositionsByTargetJointName: {},
  ...overrides,
});

describe("resolveLeRobotDirectTeleopLeaderRequest", () => {
  it("keeps single-port LeRobot teleoperators on the generic port field", () => {
    expect(
      resolveLeRobotDirectTeleopLeaderRequest([
        buildTeleoperatorTarget({
          path: "/dev/serial/by-id/so100-leader",
          calibrationProfile: "so100_leader",
          calibrationId: "shared-so100",
        }),
      ]),
    ).toEqual({
      leader: {
        port: "/dev/serial/by-id/so100-leader",
        calibrationCategory: "teleoperators",
        calibrationProfile: "so100_leader",
        calibrationId: "shared-so100",
        calibrationGroup: "all",
      },
      issue: null,
    });
  });

  it("requires both ports only for paired LeRobot teleoperators", () => {
    expect(
      resolveLeRobotDirectTeleopLeaderRequest([
        buildTeleoperatorTarget({
          path: "/dev/serial/by-id/openarm-right",
          side: OPERATOR_LEADER_SIDES.right,
          calibrationProfile: OPERATOR_OPENARM_MINI_TELEOPERATOR_TYPE,
          calibrationGroup: OPERATOR_LEADER_SIDES.right,
        }),
      ]),
    ).toEqual({
      leader: null,
      issue: "Connect left and right leaders first.",
    });
  });

  it("uses left and right ports for paired LeRobot teleoperators", () => {
    expect(
      resolveLeRobotDirectTeleopLeaderRequest([
        buildTeleoperatorTarget({
          path: "/dev/serial/by-id/openarm-right",
          side: OPERATOR_LEADER_SIDES.right,
          calibrationProfile: OPERATOR_OPENARM_MINI_TELEOPERATOR_TYPE,
          calibrationId: "openarm-pair",
          calibrationGroup: OPERATOR_LEADER_SIDES.right,
        }),
        buildTeleoperatorTarget({
          path: "/dev/serial/by-id/openarm-left",
          side: OPERATOR_LEADER_SIDES.left,
          calibrationProfile: OPERATOR_OPENARM_MINI_TELEOPERATOR_TYPE,
          calibrationId: "openarm-pair",
          calibrationGroup: OPERATOR_LEADER_SIDES.left,
        }),
      ]),
    ).toEqual({
      leader: {
        port: "/dev/serial/by-id/openarm-right",
        portLeft: "/dev/serial/by-id/openarm-left",
        portRight: "/dev/serial/by-id/openarm-right",
        calibrationCategory: "teleoperators",
        calibrationProfile: OPERATOR_OPENARM_MINI_TELEOPERATOR_TYPE,
        calibrationId: "openarm-pair",
        calibrationGroup: OPERATOR_LEADER_SIDES.right,
      },
      issue: null,
    });
  });

  it("uses left and right ports for explicit bimanual OpenArm Mini teleoperators", () => {
    expect(
      resolveLeRobotDirectTeleopLeaderRequest([
        buildTeleoperatorTarget({
          path: "/dev/serial/by-id/openarm-right",
          side: OPERATOR_LEADER_SIDES.right,
          calibrationProfile: OPERATOR_BI_OPENARM_MINI_TELEOPERATOR_TYPE,
          calibrationId: "openarm-pair",
          calibrationGroup: OPERATOR_LEADER_SIDES.right,
        }),
        buildTeleoperatorTarget({
          path: "/dev/serial/by-id/openarm-left",
          side: OPERATOR_LEADER_SIDES.left,
          calibrationProfile: OPERATOR_BI_OPENARM_MINI_TELEOPERATOR_TYPE,
          calibrationId: "openarm-pair",
          calibrationGroup: OPERATOR_LEADER_SIDES.left,
        }),
      ]),
    ).toEqual({
      leader: {
        port: "/dev/serial/by-id/openarm-right",
        portLeft: "/dev/serial/by-id/openarm-left",
        portRight: "/dev/serial/by-id/openarm-right",
        calibrationCategory: "teleoperators",
        calibrationProfile: OPERATOR_BI_OPENARM_MINI_TELEOPERATOR_TYPE,
        calibrationId: "openarm-pair",
        calibrationGroup: OPERATOR_LEADER_SIDES.right,
      },
      issue: null,
    });
  });
});
