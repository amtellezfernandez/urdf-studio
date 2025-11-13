/**
 * Updates the name of a joint in the URDF XML content
 */
export function updateJointNameInURDF(
  urdfContent: string,
  oldJointName: string,
  newJointName: string
): string {
  if (oldJointName === newJointName) {
    return urdfContent;
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

  // Check for parser errors
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

  // Find the joint element
  const joint = xmlDoc.querySelector(`joint[name="${oldJointName}"]`);
  if (!joint) {
    console.warn(`Joint "${oldJointName}" not found in URDF.`);
    return urdfContent;
  }

  // Check if new name already exists
  const existingJoint = xmlDoc.querySelector(`joint[name="${newJointName}"]`);
  if (existingJoint) {
    console.warn(`Joint "${newJointName}" already exists in URDF.`);
    return urdfContent;
  }

  // Update the joint name attribute
  joint.setAttribute("name", newJointName);

  // Serialize back to string
  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

