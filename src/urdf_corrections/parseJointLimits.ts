/**
 * URDF Joint Limits Parser
 * 
 * Parses joint types and limits from URDF XML
 */

export interface JointLimitInfo {
  type: string; // 'revolute', 'continuous', 'prismatic', 'fixed', etc.
  lower: number | null; // Lower limit if present, null if unlimited
  upper: number | null; // Upper limit if present, null if unlimited
}

export interface JointLimits {
  [jointName: string]: JointLimitInfo;
}

/**
 * Parses joint types and limits from URDF XML content
 * @param urdfContent URDF XML content as string
 * @returns Map of joint names to their limit information
 */
export function parseJointLimitsFromURDF(urdfContent: string): JointLimits {
  const limits: JointLimits = {};

  console.log("[parseJointLimits] Starting to parse URDF content, length:", urdfContent.length);

  // Parse the URDF XML using robust parser
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

  // Check for parsing errors
  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) {
    const errorText = parserError.textContent || "Unknown XML parsing error";
    console.error("URDF parsing error:", errorText);
    return limits;
  }

  // Validate robot element exists
  const robot = xmlDoc.querySelector("robot");
  if (!robot) {
    console.error("No <robot> element found in URDF");
    return limits;
  }

  // Find all joints
  const joints = xmlDoc.querySelectorAll("joint");
  console.log(`[parseJointLimits] Found ${joints.length} joints in URDF`);

  joints.forEach((joint) => {
    const jointName = joint.getAttribute("name");
    if (!jointName) return;

    // Get joint type - skip if no type attribute (these are hardware interface definitions, not actual joints)
    const jointTypeAttr = joint.getAttribute("type");
    if (!jointTypeAttr) {
      console.log(`[parseJointLimits] Skipping joint "${jointName}" - no type attribute (likely hardware interface definition)`);
      return;
    }
    const jointType = jointTypeAttr;

    // Debug: log what we're parsing
    console.log(`[parseJointLimits] Joint "${jointName}" has type="${jointType}"`);

    // Initialize with defaults based on joint type
    let lower: number | null = null;
    let upper: number | null = null;

    // Fixed joints can't move
    if (jointType === "fixed") {
      limits[jointName] = {
        type: jointType,
        lower: 0,
        upper: 0,
      };
      return;
    }

    // Continuous joints have unlimited range (no limits)
    if (jointType === "continuous") {
      limits[jointName] = {
        type: jointType,
        lower: null, // Unlimited
        upper: null, // Unlimited
      };
      return;
    }

    // For revolute and prismatic joints, check for <limit> tag
    if (jointType === "revolute" || jointType === "prismatic") {
      const limitTag = joint.querySelector("limit");
      if (limitTag) {
        const lowerStr = limitTag.getAttribute("lower");
        const upperStr = limitTag.getAttribute("upper");
        
        if (lowerStr !== null) {
          lower = parseFloat(lowerStr);
        }
        if (upperStr !== null) {
          upper = parseFloat(upperStr);
        }
      } else {
        // No limit tag - for revolute, assume continuous (unlimited)
        // For prismatic, this is unusual but we'll treat as unlimited
        if (jointType === "revolute") {
          console.warn(`Revolute joint "${jointName}" has no <limit> tag, treating as continuous`);
          lower = null;
          upper = null;
        } else {
          // Prismatic without limits - unusual but possible
          lower = null;
          upper = null;
        }
      }
    } else {
      // Other joint types (planar, floating) - treat as unlimited for now
      lower = null;
      upper = null;
    }

    limits[jointName] = {
      type: jointType,
      lower,
      upper,
    };
  });

  return limits;
}

/**
 * Gets joint limits for a specific joint, with fallback values
 * @param limitsMap Parsed joint limits map
 * @param jointName Name of the joint
 * @returns Object with lower and upper limits, or defaults for unlimited joints
 */
export function getJointLimits(
  limitsMap: JointLimits,
  jointName: string
): { lower: number; upper: number } {
  const jointInfo = limitsMap[jointName];

  if (!jointInfo) {
    // Joint not found - assume continuous (unlimited)
    return {
      lower: -Infinity,
      upper: Infinity,
    };
  }

  // Fixed joints
  if (jointInfo.type === "fixed") {
    return {
      lower: 0,
      upper: 0,
    };
  }

  // Continuous or unlimited joints
  if (jointInfo.lower === null || jointInfo.upper === null) {
    return {
      lower: -Infinity,
      upper: Infinity,
    };
  }

  // Joint with explicit limits
  return {
    lower: jointInfo.lower,
    upper: jointInfo.upper,
  };
}

