/**
 * Angle conversion utilities
 */

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

/**
 * Convert degrees to radians
 */
export const degToRad = (degrees: number): number => degrees * DEG_TO_RAD;

/**
 * Convert radians to degrees
 */
export const radToDeg = (radians: number): number => radians * RAD_TO_DEG;

/**
 * Convert angle value based on unit
 */
export const convertAngle = (
  value: number,
  fromUnit: "rad" | "deg",
  toUnit: "rad" | "deg",
): number => {
  if (fromUnit === toUnit) return value;
  return fromUnit === "deg" ? degToRad(value) : radToDeg(value);
};
