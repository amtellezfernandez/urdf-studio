import {
  OPERATOR_HELPER_OPENARM_DEMO_ROBOT_NAME_TOKEN,
  OPERATOR_HELPER_TWIST_ZERO,
} from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorTwistCommand } from "@/features/teleop/contracts/operatorControlTypes";
import type { OperatorSessionSnapshot } from "@/features/teleop/transport/operatorHelperApi";
import type { OperatorTeleopProfile } from "@/features/teleop/profiles/operatorTeleopProfiles";

export const applyProfileCapabilities = (
  twist: OperatorTwistCommand,
  profile: OperatorTeleopProfile,
): OperatorTwistCommand => ({
  ...twist,
  y: profile.capabilities.lateralStrafe ? twist.y : OPERATOR_HELPER_TWIST_ZERO,
});

export const getOperatorStatusMessage = (
  session: OperatorSessionSnapshot,
): string =>
  session.state === "active"
    ? "Operator session active."
    : "No active teleop control session yet. Connect a teleop provider before sending motion.";

export const isOpenArmDemoRobot = (robotName: string | null): boolean =>
  robotName
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .includes(OPERATOR_HELPER_OPENARM_DEMO_ROBOT_NAME_TOKEN) ?? false;
