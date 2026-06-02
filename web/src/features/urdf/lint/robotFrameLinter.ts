import {
  buildRobotOrientationCard,
  parseUrdfDocument,
  type OrientationAxis,
  type RobotOrientationCard,
} from "@/shared/lib/urdfCore";
import {
  ROBOT_FRAME_LINTER_CANONICAL_COMPENSATION_RATIO_MAX,
  ROBOT_FRAME_LINTER_RPY_EPSILON_RAD,
  ROBOT_FRAME_LINTER_UNSAFE_COMPENSATION_RATIO_MIN,
  ROBOT_FRAME_LINTER_UNSAFE_JOINT_COMPENSATION_RATIO_MIN,
  ROBOT_FRAME_LINTER_WHEEL_CONFLICT_DOMINANCE_MIN,
} from "./robotFrameLinterParams";

export type RobotFrameLintVerdict =
  | "canonical"
  | "asset-native"
  | "unsafe-to-rewrite"
  | "underconstrained";

export type RobotFrameLintIssueSeverity = "info" | "warning" | "error";

export type RobotFrameLintIssueCode =
  | "orientation-underconstrained"
  | "non-canonical-basis"
  | "visual-compensation-debt"
  | "joint-compensation-debt"
  | "wheel-up-axis-conflict";

export type RobotFrameLintIssue = {
  code: RobotFrameLintIssueCode;
  severity: RobotFrameLintIssueSeverity;
  message: string;
};

export type RobotFrameTransformCompensationStats = {
  visualOrigins: number;
  visualCompensatedOrigins: number;
  collisionOrigins: number;
  collisionCompensatedOrigins: number;
  jointOrigins: number;
  jointCompensatedOrigins: number;
  geometryOrigins: number;
  geometryCompensatedOrigins: number;
  geometryCompensationRatio: number;
  jointCompensationRatio: number;
};

export type RobotFrameWheelStats = {
  wheelJointCount: number;
  dominantAxis: OrientationAxis | null;
  dominantAxisVoteShare: number;
  conflictsWithLikelyUpAxis: boolean;
};

export type RobotFrameLintResult = {
  robotName: string | null;
  verdict: RobotFrameLintVerdict;
  rewriteSafe: boolean;
  orientationCard: RobotOrientationCard | null;
  transformCompensation: RobotFrameTransformCompensationStats;
  wheelStats: RobotFrameWheelStats;
  issues: RobotFrameLintIssue[];
};

const ORIENTATION_AXES: OrientationAxis[] = ["x", "y", "z"];

const createEmptyTransformCompensationStats = (): RobotFrameTransformCompensationStats => ({
  visualOrigins: 0,
  visualCompensatedOrigins: 0,
  collisionOrigins: 0,
  collisionCompensatedOrigins: 0,
  jointOrigins: 0,
  jointCompensatedOrigins: 0,
  geometryOrigins: 0,
  geometryCompensatedOrigins: 0,
  geometryCompensationRatio: 0,
  jointCompensationRatio: 0,
});

const createEmptyWheelStats = (): RobotFrameWheelStats => ({
  wheelJointCount: 0,
  dominantAxis: null,
  dominantAxisVoteShare: 0,
  conflictsWithLikelyUpAxis: false,
});

const toRatio = (numerator: number, denominator: number): number =>
  denominator > 0 ? numerator / denominator : 0;

const parseRpyAttribute = (rpyAttribute: string | null): [number, number, number] => {
  if (!rpyAttribute) {
    return [0, 0, 0];
  }

  const values = rpyAttribute
    .trim()
    .split(/\s+/)
    .map((token) => Number.parseFloat(token));

  return [
    Number.isFinite(values[0]) ? values[0] : 0,
    Number.isFinite(values[1]) ? values[1] : 0,
    Number.isFinite(values[2]) ? values[2] : 0,
  ];
};

const hasNonTrivialRpy = (rpyAttribute: string | null): boolean =>
  parseRpyAttribute(rpyAttribute).some(
    (value) => Math.abs(value) > ROBOT_FRAME_LINTER_RPY_EPSILON_RAD
  );

const countCompensatedOrigins = (elements: Element[]): { total: number; compensated: number } => {
  let compensated = 0;
  elements.forEach((element) => {
    const origin = element.querySelector(":scope > origin");
    if (hasNonTrivialRpy(origin?.getAttribute("rpy") ?? null)) {
      compensated += 1;
    }
  });

  return {
    total: elements.length,
    compensated,
  };
};

const collectTransformCompensationStats = (
  xmlDoc: XMLDocument | null
): RobotFrameTransformCompensationStats => {
  if (!xmlDoc) {
    return createEmptyTransformCompensationStats();
  }

  const visualCounts = countCompensatedOrigins(Array.from(xmlDoc.querySelectorAll("link > visual")));
  const collisionCounts = countCompensatedOrigins(
    Array.from(xmlDoc.querySelectorAll("link > collision"))
  );
  const jointCounts = countCompensatedOrigins(Array.from(xmlDoc.querySelectorAll("joint")));

  const geometryOrigins = visualCounts.total + collisionCounts.total;
  const geometryCompensatedOrigins = visualCounts.compensated + collisionCounts.compensated;

  return {
    visualOrigins: visualCounts.total,
    visualCompensatedOrigins: visualCounts.compensated,
    collisionOrigins: collisionCounts.total,
    collisionCompensatedOrigins: collisionCounts.compensated,
    jointOrigins: jointCounts.total,
    jointCompensatedOrigins: jointCounts.compensated,
    geometryOrigins,
    geometryCompensatedOrigins,
    geometryCompensationRatio: toRatio(geometryCompensatedOrigins, geometryOrigins),
    jointCompensationRatio: toRatio(jointCounts.compensated, jointCounts.total),
  };
};

const collectWheelStats = (orientationCard: RobotOrientationCard | null): RobotFrameWheelStats => {
  if (!orientationCard?.isValid) {
    return createEmptyWheelStats();
  }

  const totalVotes = ORIENTATION_AXES.reduce(
    (sum, axis) => sum + (orientationCard.wheelAxisVotes[axis] ?? 0),
    0
  );
  const dominantAxis =
    ORIENTATION_AXES.reduce<OrientationAxis | null>((current, axis) => {
      if (!current) {
        return axis;
      }
      return (orientationCard.wheelAxisVotes[axis] ?? 0) >
        (orientationCard.wheelAxisVotes[current] ?? 0)
        ? axis
        : current;
    }, null) ?? null;
  const dominantAxisVotes = dominantAxis ? orientationCard.wheelAxisVotes[dominantAxis] ?? 0 : 0;
  const dominantAxisVoteShare = toRatio(dominantAxisVotes, totalVotes);
  const conflictsWithLikelyUpAxis = Boolean(
    dominantAxis &&
      orientationCard.summary.likelyUpAxis &&
      dominantAxis === orientationCard.summary.likelyUpAxis &&
      dominantAxisVoteShare >= ROBOT_FRAME_LINTER_WHEEL_CONFLICT_DOMINANCE_MIN
  );

  return {
    wheelJointCount: orientationCard.wheelJointNames.length,
    dominantAxis,
    dominantAxisVoteShare,
    conflictsWithLikelyUpAxis,
  };
};

const createIssue = (
  code: RobotFrameLintIssueCode,
  severity: RobotFrameLintIssueSeverity,
  message: string
): RobotFrameLintIssue => ({
  code,
  severity,
  message,
});

export const buildRobotFramePolicySummary = (
  lintResult: RobotFrameLintResult | null | undefined
): string | null => {
  switch (lintResult?.verdict) {
    case "canonical":
      return "Frame authoring looks canonical and is safe for the standard orientation rewrite.";
    case "asset-native":
      return "This robot is coherent but asset-native. Preserve the source frame and avoid destructive auto-align.";
    case "unsafe-to-rewrite":
      return "This robot relies on local transform compensation. A global orientation rewrite is unsafe.";
    case "underconstrained":
      return "Frame inference is underconstrained. Confirm the basis manually before rewriting.";
    default:
      return null;
  }
};

const buildIssues = ({
  orientationCard,
  transformCompensation,
  wheelStats,
}: {
  orientationCard: RobotOrientationCard | null;
  transformCompensation: RobotFrameTransformCompensationStats;
  wheelStats: RobotFrameWheelStats;
}): RobotFrameLintIssue[] => {
  const issues: RobotFrameLintIssue[] = [];

  if (!orientationCard?.isValid || orientationCard.summary.classification === "underconstrained") {
    issues.push(
      createIssue(
        "orientation-underconstrained",
        "warning",
        "Frame inference is underconstrained, so the robot should be treated as unsafe to rewrite until a basis is confirmed."
      )
    );
    return issues;
  }

  if (
    orientationCard.summary.likelyUpDirection !== "+z" ||
    orientationCard.summary.likelyForwardDirection !== "+x"
  ) {
    issues.push(
      createIssue(
        "non-canonical-basis",
        "warning",
        `Asset basis is inferred as ${orientationCard.summary.likelyUpDirection ?? "unknown"} up / ${orientationCard.summary.likelyForwardDirection ?? "unknown"} forward instead of +z up / +x forward.`
      )
    );
  }

  if (
    transformCompensation.geometryCompensationRatio >=
    ROBOT_FRAME_LINTER_CANONICAL_COMPENSATION_RATIO_MAX
  ) {
    issues.push(
      createIssue(
        "visual-compensation-debt",
        transformCompensation.geometryCompensationRatio >=
          ROBOT_FRAME_LINTER_UNSAFE_COMPENSATION_RATIO_MIN
          ? "error"
          : "warning",
        `Visual/collision origins rely on local RPY compensation for ${Math.round(
          transformCompensation.geometryCompensationRatio * 100
        )}% of geometry entries.`
      )
    );
  }

  if (
    transformCompensation.jointCompensationRatio >= ROBOT_FRAME_LINTER_CANONICAL_COMPENSATION_RATIO_MAX
  ) {
    issues.push(
      createIssue(
        "joint-compensation-debt",
        transformCompensation.jointCompensationRatio >=
          ROBOT_FRAME_LINTER_UNSAFE_JOINT_COMPENSATION_RATIO_MIN
          ? "error"
          : "warning",
        `Joint origins rely on local RPY compensation for ${Math.round(
          transformCompensation.jointCompensationRatio * 100
        )}% of joints.`
      )
    );
  }

  if (wheelStats.conflictsWithLikelyUpAxis && orientationCard.summary.likelyUpAxis) {
    issues.push(
      createIssue(
        "wheel-up-axis-conflict",
        "error",
        `Wheel-axis votes are dominated by ${wheelStats.dominantAxis}, which matches the inferred up axis ${orientationCard.summary.likelyUpAxis}.`
      )
    );
  }

  return issues;
};

const classifyVerdict = ({
  orientationCard,
  transformCompensation,
  wheelStats,
}: {
  orientationCard: RobotOrientationCard | null;
  transformCompensation: RobotFrameTransformCompensationStats;
  wheelStats: RobotFrameWheelStats;
}): RobotFrameLintVerdict => {
  if (!orientationCard?.isValid || orientationCard.summary.classification === "underconstrained") {
    return "underconstrained";
  }

  const isCanonicalBasis =
    orientationCard.summary.likelyUpDirection === "+z" &&
    orientationCard.summary.likelyForwardDirection === "+x";
  const hasUnsafeCompensationDebt =
    transformCompensation.geometryCompensationRatio >=
      ROBOT_FRAME_LINTER_UNSAFE_COMPENSATION_RATIO_MIN ||
    transformCompensation.jointCompensationRatio >=
      ROBOT_FRAME_LINTER_UNSAFE_JOINT_COMPENSATION_RATIO_MIN;

  if (wheelStats.conflictsWithLikelyUpAxis || hasUnsafeCompensationDebt) {
    return "unsafe-to-rewrite";
  }

  if (
    isCanonicalBasis &&
    transformCompensation.geometryCompensationRatio <
      ROBOT_FRAME_LINTER_CANONICAL_COMPENSATION_RATIO_MAX &&
    transformCompensation.jointCompensationRatio <
      ROBOT_FRAME_LINTER_CANONICAL_COMPENSATION_RATIO_MAX
  ) {
    return "canonical";
  }

  return "asset-native";
};

export const lintRobotFrame = (urdfContent: string): RobotFrameLintResult => {
  const xmlDoc = parseUrdfDocument(urdfContent);
  let orientationCard: RobotOrientationCard | null = null;

  try {
    orientationCard = buildRobotOrientationCard(urdfContent);
  } catch {
    orientationCard = null;
  }

  const transformCompensation = collectTransformCompensationStats(xmlDoc);
  const wheelStats = collectWheelStats(orientationCard);
  const verdict = classifyVerdict({
    orientationCard,
    transformCompensation,
    wheelStats,
  });

  return {
    robotName: orientationCard?.robotName ?? null,
    verdict,
    rewriteSafe: verdict === "canonical",
    orientationCard,
    transformCompensation,
    wheelStats,
    issues: buildIssues({
      orientationCard,
      transformCompensation,
      wheelStats,
    }),
  };
};
