import {
  getUrdfElementByName,
  parseUrdfDocument,
  type JointLimitInfo,
} from "@/shared/lib/urdfBrowser";
import { RAD_TO_DEG } from "@/shared/lib/angleConversions";
import { JOINT_CONTROL_PARAMS } from "@/features/layout/jointControlParams";
import {
  parseLimitAttributeDebugState,
  type LimitAttributeDebugState,
} from "@/features/layout/jointLimitDebugState";

type JointLimitMetadata = JointLimitInfo & {
  effort?: number | null;
  velocity?: number | null;
};

export type JointDynamicLimitDisplayState = {
  effortAttribute: LimitAttributeDebugState;
  effortDisplay: number | undefined;
  effortLimit: number | null;
  effortPlaceholder: string;
  effortUnit: string;
  hasEffortLimit: boolean;
  velocityAttribute: LimitAttributeDebugState;
  velocityDisplay: number | undefined;
  velocityLimit: number | null;
  velocityMin: number;
  velocityPlaceholder: string;
  velocityStep: number;
  velocityUnit: string;
};

const JOINT_LIMIT_URDF_PARSE_OPTIONS = {
  onParseError: () => {},
  onRobotMissing: () => {},
  onXacroDetected: () => {},
  onOversize: () => {},
  onDepthExceeded: () => {},
};

const roundToPrecision = (value: number, precision: number): number =>
  Math.round(value * precision) / precision;

const readJointLimitAttributesFromUrdf = ({
  jointName,
  urdfContent,
}: {
  jointName: string;
  urdfContent?: string;
}):
  | {
      effort: LimitAttributeDebugState;
      velocity: LimitAttributeDebugState;
    }
  | undefined => {
  if (!urdfContent) {
    return undefined;
  }

  const xmlDoc = parseUrdfDocument(urdfContent, JOINT_LIMIT_URDF_PARSE_OPTIONS);
  if (!xmlDoc) {
    return undefined;
  }
  const joint = getUrdfElementByName(xmlDoc, "joint", jointName, {
    label: "joint",
    onMissing: () => {},
  });
  if (!joint) {
    return undefined;
  }
  const limitElement = joint.querySelector("limit");
  return {
    velocity: parseLimitAttributeDebugState(limitElement?.getAttribute("velocity")),
    effort: parseLimitAttributeDebugState(limitElement?.getAttribute("effort")),
  };
};

export const resolveJointDynamicLimitDisplayState = ({
  angleUnit,
  jointInfo,
  jointName,
  jointType,
  urdfContent,
}: {
  angleUnit: "rad" | "deg";
  jointInfo?: JointLimitInfo;
  jointName: string;
  jointType: string;
  urdfContent?: string;
}): JointDynamicLimitDisplayState => {
  const velocityStep =
    angleUnit === "deg"
      ? JOINT_CONTROL_PARAMS.velocity.degStep
      : JOINT_CONTROL_PARAMS.velocity.radStep;
  const velocityMin =
    angleUnit === "deg"
      ? JOINT_CONTROL_PARAMS.velocity.minRadPerSec * RAD_TO_DEG
      : JOINT_CONTROL_PARAMS.velocity.minRadPerSec;
  const velocityPrecision =
    angleUnit === "deg"
      ? JOINT_CONTROL_PARAMS.velocity.degPrecision
      : JOINT_CONTROL_PARAMS.velocity.radPrecision;
  const metadata = jointInfo as JointLimitMetadata | undefined;
  const urdfAttributes = readJointLimitAttributesFromUrdf({ jointName, urdfContent });

  const velocityAttribute =
    urdfAttributes !== undefined
      ? urdfAttributes.velocity
      : parseLimitAttributeDebugState(metadata?.velocity);
  const velocityLimit = velocityAttribute.value;
  const velocityDisplay =
    velocityLimit === null
      ? undefined
      : roundToPrecision(
          angleUnit === "deg" ? velocityLimit * RAD_TO_DEG : velocityLimit,
          velocityPrecision
        );

  const effortAttribute =
    urdfAttributes !== undefined
      ? urdfAttributes.effort
      : parseLimitAttributeDebugState(metadata?.effort);
  const effortLimit = effortAttribute.value;
  const effortDisplay =
    effortLimit === null
      ? undefined
      : roundToPrecision(effortLimit, JOINT_CONTROL_PARAMS.effort.precision);

  return {
    effortAttribute,
    effortDisplay,
    effortLimit,
    effortPlaceholder: effortAttribute.status === "invalid" ? "bad" : "-",
    effortUnit: jointType === "prismatic" ? "N" : "N*m",
    hasEffortLimit: effortAttribute.status !== "missing",
    velocityAttribute,
    velocityDisplay,
    velocityLimit,
    velocityMin,
    velocityPlaceholder: velocityAttribute.status === "invalid" ? "bad" : "-",
    velocityStep,
    velocityUnit: angleUnit === "deg" ? "°/s" : "rad/s",
  };
};
