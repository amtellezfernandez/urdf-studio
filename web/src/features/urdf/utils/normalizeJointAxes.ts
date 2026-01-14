/**
 * Joint Axis Normalization Utility for URDF
 *
 * Corrects common issues with joint axis definitions:
 * - Non-unit vectors (e.g., "1 1 0")
 * - Zero vectors (e.g., "0 0 0")
 * - Very small floating point values (e.g., "0 -1e-12 1")
 * - Invalid formats
 */

import { parseURDF, serializeURDF } from "../parsing/urdfParser";

interface AxisNormalizationResult {
  urdfContent: string;
  corrections: AxisCorrection[];
  errors: AxisError[];
}

export interface AxisCorrection {
  jointName: string;
  jointType: string;
  original: string;
  corrected: string;
  reason: string;
}

export interface AxisError {
  jointName: string;
  jointType: string;
  issue: string;
}

const EPSILON = 1e-6;
const DEFAULT_AXIS = "1 0 0";

/**
 * Parses an axis string into a numeric array
 */
function parseAxis(axisStr: string): number[] | null {
  const parts = axisStr.trim().split(/\s+/);
  if (parts.length !== 3) return null;

  const values: number[] = [];
  for (const part of parts) {
    const num = parseFloat(part);
    if (isNaN(num)) return null;
    values.push(num);
  }

  return values;
}

/**
 * Computes the magnitude of a vector
 */
function magnitude(vec: number[]): number {
  return Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]);
}

/**
 * Normalizes a vector to unit length
 */
function normalize(vec: number[]): number[] {
  const mag = magnitude(vec);
  if (mag === 0) return vec;
  return vec.map((v) => v / mag);
}

/**
 * Clamps very small values to zero
 */
function epsilonClamp(vec: number[]): number[] {
  return vec.map((v) => (Math.abs(v) < EPSILON ? 0 : v));
}

/**
 * Formats a vector as a string with appropriate precision
 */
function formatAxis(vec: number[]): string {
  return vec.map((v) => (v === 0 ? "0" : v.toFixed(10).replace(/\.?0+$/, ""))).join(" ");
}

/**
 * Normalizes all joint axes in a URDF
 *
 * @param urdfContent - URDF XML content as string
 * @returns Result containing corrected URDF and list of corrections/errors
 */
export function normalizeJointAxes(urdfContent: string): AxisNormalizationResult {
  const parsed = parseURDF(urdfContent);

  const result: AxisNormalizationResult = {
    urdfContent: urdfContent,
    corrections: [],
    errors: [],
  };

  if (!parsed.isValid) {
    result.errors.push({
      jointName: "N/A",
      jointType: "N/A",
      issue: "Invalid URDF - cannot parse",
    });
    return result;
  }

  const robot = parsed.document.querySelector("robot");
  if (!robot) {
    return result;
  }

  const joints = robot.querySelectorAll("joint");

  for (const joint of joints) {
    const jointName = joint.getAttribute("name") || "unnamed";
    const jointType = joint.getAttribute("type") || "unknown";

    // Skip fixed joints - they don't have axes
    if (jointType === "fixed" || jointType === "floating" || jointType === "planar") {
      continue;
    }

    let axisElement = joint.querySelector("axis");
    const currentAxisAttr = axisElement?.getAttribute("xyz") || DEFAULT_AXIS;

    const parsedAxis = parseAxis(currentAxisAttr);

    if (!parsedAxis) {
      // Invalid format - replace with default
      result.errors.push({
        jointName,
        jointType,
        issue: `Invalid axis format: "${currentAxisAttr}"`,
      });

      if (!axisElement) {
        axisElement = parsed.document.createElement("axis");
        joint.appendChild(axisElement);
      }
      axisElement.setAttribute("xyz", DEFAULT_AXIS);

      result.corrections.push({
        jointName,
        jointType,
        original: currentAxisAttr,
        corrected: DEFAULT_AXIS,
        reason: "Invalid format - using default axis",
      });
      continue;
    }

    const mag = magnitude(parsedAxis);

    // Check for zero vector
    if (mag < EPSILON) {
      result.errors.push({
        jointName,
        jointType,
        issue: `Zero or near-zero axis vector: "${currentAxisAttr}"`,
      });

      if (!axisElement) {
        axisElement = parsed.document.createElement("axis");
        joint.appendChild(axisElement);
      }
      axisElement.setAttribute("xyz", DEFAULT_AXIS);

      result.corrections.push({
        jointName,
        jointType,
        original: currentAxisAttr,
        corrected: DEFAULT_AXIS,
        reason: "Zero vector - using default axis",
      });
      continue;
    }

    // Normalize and epsilon-clamp
    let correctedAxis = normalize(parsedAxis);
    correctedAxis = epsilonClamp(correctedAxis);

    // Re-normalize after epsilon clamping (in case we changed values)
    const newMag = magnitude(correctedAxis);
    if (newMag > EPSILON) {
      correctedAxis = normalize(correctedAxis);
    }

    const correctedStr = formatAxis(correctedAxis);

    // Check if correction was needed
    const originalNormalized = formatAxis(epsilonClamp(parsedAxis));
    if (correctedStr !== originalNormalized || Math.abs(mag - 1.0) > EPSILON) {
      if (!axisElement) {
        axisElement = parsed.document.createElement("axis");
        joint.appendChild(axisElement);
      }
      axisElement.setAttribute("xyz", correctedStr);

      let reason = "";
      if (Math.abs(mag - 1.0) > EPSILON) {
        reason = `Non-unit vector (magnitude: ${mag.toFixed(4)})`;
      } else {
        reason = "Cleaned up floating point precision";
      }

      result.corrections.push({
        jointName,
        jointType,
        original: currentAxisAttr,
        corrected: correctedStr,
        reason,
      });
    }
  }

  result.urdfContent = serializeURDF(parsed.document);
  return result;
}

/**
 * Simple wrapper that just returns the corrected URDF string
 *
 * @param urdfContent - URDF XML content as string
 * @returns Corrected URDF content
 */
