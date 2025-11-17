/**
 * Updates the axis of a joint in the URDF XML content
 */
export function updateJointAxisInURDF(
  urdfContent: string,
  jointName: string,
  axis: [number, number, number]
): string {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) {
    const errorText = parserError.textContent || "Unknown XML parsing error";
    console.warn("URDF parsing error:", errorText);
    return urdfContent;
  }
  
  // Validate robot element exists
  const robot = xmlDoc.querySelector("robot");
  if (!robot) {
    console.error("No <robot> element found in URDF");
    return urdfContent;
  }

  const joint = xmlDoc.querySelector(`joint[name="${jointName}"]`);
  if (!joint) {
    console.warn(`Joint "${jointName}" not found in URDF.`);
    return urdfContent;
  }

  // Preserve joint attributes - they must remain fixed
  const preservedName = joint.getAttribute("name");
  const preservedType = joint.getAttribute("type");

  // Normalize the axis vector
  const length = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
  if (length < 1e-10) {
    console.warn(`Axis vector for joint "${jointName}" is too small`);
    return urdfContent;
  }
  const normalized: [number, number, number] = [
    axis[0] / length,
    axis[1] / length,
    axis[2] / length,
  ];

  // Find or create axis element
  let axisElement = joint.querySelector("axis");
  if (!axisElement) {
    axisElement = xmlDoc.createElement("axis");
    // Insert after origin or child, or just append
    const originTag = joint.querySelector("origin");
    const childTag = joint.querySelector("child");
    if (originTag && originTag.nextSibling) {
      joint.insertBefore(axisElement, originTag.nextSibling);
    } else if (childTag && childTag.nextSibling) {
      joint.insertBefore(axisElement, childTag.nextSibling);
    } else {
      joint.appendChild(axisElement);
    }
  }

  // Set axis value
  axisElement.setAttribute("xyz", `${normalized[0]} ${normalized[1]} ${normalized[2]}`);

  // Explicitly restore preserved attributes to ensure they're not lost
  if (preservedName) {
    joint.setAttribute("name", preservedName);
  }
  if (preservedType) {
    joint.setAttribute("type", preservedType);
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

