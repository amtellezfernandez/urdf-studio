const TWO_PI_RAD = Math.PI * 2;

const normalizeRadiansToSignedPi = (valueRad: number) => {
  let normalized = (valueRad + Math.PI) % TWO_PI_RAD;
  if (normalized < 0) normalized += TWO_PI_RAD;
  return normalized - Math.PI;
};

export const resolveShortestWheelAngleDeltaRad = (
  previousAngleRad: number,
  currentAngleRad: number
) => normalizeRadiansToSignedPi(currentAngleRad - previousAngleRad);

