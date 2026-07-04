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

type JointLimitAttributeDisplay = {
  display: number | undefined;
  limit: number | null;
  placeholder: string;
};

type VelocityDisplayConfig = {
  precision: number;
  step: number;
  min: number;
  unit: string;
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

export const resolveVelocityDisplayConfig = (
  angleUnit: "rad" | "deg"
): VelocityDisplayConfig => ({
  min:
    angleUnit === "deg"
      ? JOINT_CONTROL_PARAMS.velocity.minRadPerSec * RAD_TO_DEG
      : JOINT_CONTROL_PARAMS.velocity.minRadPerSec,
  precision:
    angleUnit === "deg"
      ? JOINT_CONTROL_PARAMS.velocity.degPrecision
      : JOINT_CONTROL_PARAMS.velocity.radPrecision,
  step:
    angleUnit === "deg"
      ? JOINT_CONTROL_PARAMS.velocity.degStep
      : JOINT_CONTROL_PARAMS.velocity.radStep,
  unit: angleUnit === "deg" ? "°/s" : "rad/s",
});

export const resolveLimitAttributeDisplay = ({
  attribute,
  precision,
  scale = 1,
}: {
  attribute: LimitAttributeDebugState;
  precision: number;
  scale?: number;
}): JointLimitAttributeDisplay => ({
  display:
    attribute.value === null
      ? undefined
      : roundToPrecision(attribute.value * scale, precision),
  limit: attribute.value,
  placeholder: attribute.status === "invalid" ? "bad" : "-",
});

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
  const velocityConfig = resolveVelocityDisplayConfig(angleUnit);
  const metadata = jointInfo as JointLimitMetadata | undefined;
  const urdfAttributes = readJointLimitAttributesFromUrdf({ jointName, urdfContent });

  const velocityAttribute =
    urdfAttributes !== undefined
      ? urdfAttributes.velocity
      : parseLimitAttributeDebugState(metadata?.velocity);
  const velocityDisplayState = resolveLimitAttributeDisplay({
    attribute: velocityAttribute,
    precision: velocityConfig.precision,
    scale: angleUnit === "deg" ? RAD_TO_DEG : 1,
  });

  const effortAttribute =
    urdfAttributes !== undefined
      ? urdfAttributes.effort
      : parseLimitAttributeDebugState(metadata?.effort);
  const effortDisplayState = resolveLimitAttributeDisplay({
    attribute: effortAttribute,
    precision: JOINT_CONTROL_PARAMS.effort.precision,
  });

  return {
    effortAttribute,
    effortDisplay: effortDisplayState.display,
    effortLimit: effortDisplayState.limit,
    effortPlaceholder: effortDisplayState.placeholder,
    effortUnit: jointType === "prismatic" ? "N" : "N*m",
    hasEffortLimit: effortAttribute.status !== "missing",
    velocityAttribute,
    velocityDisplay: velocityDisplayState.display,
    velocityLimit: velocityDisplayState.limit,
    velocityMin: velocityConfig.min,
    velocityPlaceholder: velocityDisplayState.placeholder,
    velocityStep: velocityConfig.step,
    velocityUnit: velocityConfig.unit,
  };
};
