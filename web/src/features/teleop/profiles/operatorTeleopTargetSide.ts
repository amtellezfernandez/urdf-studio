export type OperatorTeleopControlTargetSide = "left" | "right" | "both" | "center";

export type OperatorTeleopResolvedTargetSide =
  | "left"
  | "right"
  | "center"
  | "mixed";

export type OperatorTeleopTargetSideSource = {
  controlTargetSide?: OperatorTeleopControlTargetSide | null;
  controlledJointNames: readonly string[];
};

const CAMEL_CASE_BOUNDARY_PATTERN = /([a-z0-9])([A-Z])/g;
const NON_ALNUM_PATTERN = /[^a-z0-9]+/g;
const WHITESPACE_PATTERN = /\s+/g;

export const tokenizeOperatorTeleopTargetName = (value: string): string[] =>
  value
    .trim()
    .replace(CAMEL_CASE_BOUNDARY_PATTERN, "$1 $2")
    .toLowerCase()
    .replace(NON_ALNUM_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim()
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

export const resolveOperatorTeleopSideFromTokens = (
  tokens: readonly string[],
): Exclude<OperatorTeleopResolvedTargetSide, "mixed"> => {
  if (tokens.includes("left")) return "left";
  if (tokens.includes("right")) return "right";
  return "center";
};

export const resolveOperatorTeleopProfileTargetSide = ({
  controlTargetSide,
  controlledJointNames,
}: OperatorTeleopTargetSideSource): OperatorTeleopResolvedTargetSide | null => {
  if (controlTargetSide === "left" || controlTargetSide === "right") {
    return controlTargetSide;
  }
  if (controlTargetSide === "both") return "mixed";
  if (controlTargetSide === "center") return "center";

  const jointSides = controlledJointNames
    .filter((jointName) => jointName.trim())
    .map((jointName) =>
      resolveOperatorTeleopSideFromTokens(
        tokenizeOperatorTeleopTargetName(jointName),
      ),
    );
  if (jointSides.length === 0) return null;
  const hasLeft = jointSides.includes("left");
  const hasRight = jointSides.includes("right");
  if (hasLeft && !hasRight) return "left";
  if (hasRight && !hasLeft) return "right";
  return hasLeft || hasRight ? "mixed" : "center";
};
