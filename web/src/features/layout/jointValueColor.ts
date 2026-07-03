const JOINT_VALUE_COLOR_PARAMS = {
  limitCenterColor: "#bbf7d0",
  limitWarningColor: "#fef3c7",
  limitEdgeColor: "#fecaca",
} as const;

type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

const clampUnitInterval = (value: number): number => Math.min(1, Math.max(0, value));

const hexToRgbColor = (hexColor: string): RgbColor => {
  const normalizedHexColor = hexColor.replace("#", "");
  const packedRgb = parseInt(normalizedHexColor, 16);
  return {
    red: (packedRgb >> 16) & 255,
    green: (packedRgb >> 8) & 255,
    blue: packedRgb & 255,
  };
};

const rgbColorToHex = ({ red, green, blue }: RgbColor): string => {
  const componentToHex = (componentValue: number) =>
    componentValue.toString(16).padStart(2, "0");

  return `#${componentToHex(red)}${componentToHex(green)}${componentToHex(blue)}`;
};

const interpolateHexColor = (startColor: string, endColor: string, amount: number): string => {
  const startRgbColor = hexToRgbColor(startColor);
  const endRgbColor = hexToRgbColor(endColor);
  const interpolationAmount = clampUnitInterval(amount);

  return rgbColorToHex({
    red: Math.round(
      startRgbColor.red + (endRgbColor.red - startRgbColor.red) * interpolationAmount
    ),
    green: Math.round(
      startRgbColor.green + (endRgbColor.green - startRgbColor.green) * interpolationAmount
    ),
    blue: Math.round(
      startRgbColor.blue + (endRgbColor.blue - startRgbColor.blue) * interpolationAmount
    ),
  });
};

export const getJointValueColor = (
  value: number,
  min: number,
  max: number,
  hasBothLimits: boolean
): string => {
  if (!hasBothLimits || !Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return JOINT_VALUE_COLOR_PARAMS.limitCenterColor;
  }

  const clampedValue = Math.min(Math.max(value, min), max);
  const range = max - min;
  if (range <= 0) {
    return JOINT_VALUE_COLOR_PARAMS.limitWarningColor;
  }

  const normalizedValue = (clampedValue - min) / range;
  const distanceToEdge = Math.min(normalizedValue, 1 - normalizedValue);
  const edgeCloseness = clampUnitInterval(1 - distanceToEdge / 0.5);

  if (edgeCloseness <= 0.5) {
    return interpolateHexColor(
      JOINT_VALUE_COLOR_PARAMS.limitCenterColor,
      JOINT_VALUE_COLOR_PARAMS.limitWarningColor,
      edgeCloseness * 2
    );
  }

  return interpolateHexColor(
    JOINT_VALUE_COLOR_PARAMS.limitWarningColor,
    JOINT_VALUE_COLOR_PARAMS.limitEdgeColor,
    (edgeCloseness - 0.5) * 2
  );
};
