/**
 * URDF Correction Script: Update Joint Types and Limits
 * 
 * This script modifies URDF files to update joint types and add/modify limits
 */

/**
 * Updates joint type and limits in URDF
 * @param urdfContent URDF XML content
 * @param jointName Name of the joint to update
 * @param jointType New joint type (revolute, continuous, prismatic, fixed, etc.)
 * @param lowerLimit Lower limit (optional, for revolute/prismatic)
 * @param upperLimit Upper limit (optional, for revolute/prismatic)
 * @returns Modified URDF XML content
 */
export function updateJointTypeInURDF(
  urdfContent: string,
  jointName: string,
  jointType: string,
  lowerLimit?: number,
  upperLimit?: number
): string {
  // Parse the URDF XML
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

  // Check for parsing errors
  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) {
    const errorText = parserError.textContent || "Unknown XML parsing error";
    console.error("URDF parsing error:", errorText);
    return urdfContent; // Return original if parsing fails
  }
  
  // Validate robot element exists
  const robot = xmlDoc.querySelector("robot");
  if (!robot) {
    console.error("No <robot> element found in URDF");
    return urdfContent;
  }

  // Find the joint
  const joint = xmlDoc.querySelector(`joint[name="${jointName}"]`);
  if (!joint) {
    console.warn(`Joint "${jointName}" not found in URDF`);
    return urdfContent;
  }

  // Update joint type
  joint.setAttribute("type", jointType);

  // Handle limits based on joint type
  if (jointType === "fixed") {
    // Fixed joints don't need limits - remove if present
    const limitTag = joint.querySelector("limit");
    if (limitTag) {
      joint.removeChild(limitTag);
    }
  } else if (jointType === "continuous") {
    // Continuous joints don't need limits - remove if present
    const limitTag = joint.querySelector("limit");
    if (limitTag) {
      joint.removeChild(limitTag);
    }
  } else if (jointType === "revolute" || jointType === "prismatic") {
    // Revolute and prismatic joints need limits
    let limitTag = joint.querySelector("limit");
    
    if (!limitTag) {
      // Create limit tag if it doesn't exist
      limitTag = xmlDoc.createElement("limit");
      // Insert after axis tag if present, otherwise after origin or child, or just append
      const axisTag = joint.querySelector("axis");
      const childTag = joint.querySelector("child");
      const originTag = joint.querySelector("origin");
      
      if (axisTag && axisTag.nextSibling) {
        joint.insertBefore(limitTag, axisTag.nextSibling);
      } else if (axisTag) {
        joint.appendChild(limitTag);
      } else if (childTag && childTag.nextSibling) {
        joint.insertBefore(limitTag, childTag.nextSibling);
      } else if (originTag && originTag.nextSibling) {
        joint.insertBefore(limitTag, originTag.nextSibling);
      } else {
        joint.appendChild(limitTag);
      }
    }

    // Set limits (use provided values or defaults)
    if (lowerLimit !== undefined) {
      limitTag.setAttribute("lower", String(lowerLimit));
    } else if (!limitTag.hasAttribute("lower")) {
      // Default limits for revolute: -π to π, for prismatic: -1 to 1
      const defaultLower = jointType === "revolute" ? -Math.PI : -1.0;
      limitTag.setAttribute("lower", String(defaultLower));
    }

    if (upperLimit !== undefined) {
      limitTag.setAttribute("upper", String(upperLimit));
    } else if (!limitTag.hasAttribute("upper")) {
      // Default limits for revolute: -π to π, for prismatic: -1 to 1
      const defaultUpper = jointType === "revolute" ? Math.PI : 1.0;
      limitTag.setAttribute("upper", String(defaultUpper));
    }
  }
  // For other joint types (planar, floating), we don't modify limits

  // Convert back to XML string
  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

