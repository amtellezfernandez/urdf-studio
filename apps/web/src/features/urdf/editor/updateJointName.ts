/**
 * Updates the name of a joint in the URDF XML content
 */
export function updateJointNameInURDF(
  urdfContent: string,
  oldJointName: string,
  newJointName: string
): string {
  // Validate new name
  if (!newJointName || newJointName.trim() === "") {
    console.warn("New joint name cannot be empty");
    return urdfContent;
  }

  const trimmedNewName = newJointName.trim();

  // Don't do anything if names are the same
  if (oldJointName === trimmedNewName) {
    return urdfContent;
  }

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

  // Check if new name already exists
  const existingJoint = xmlDoc.querySelector(`joint[name="${trimmedNewName}"]`);
  if (existingJoint) {
    console.warn(`Joint with name "${trimmedNewName}" already exists in URDF`);
    return urdfContent;
  }

  // Find the joint to rename
  const joint = xmlDoc.querySelector(`joint[name="${oldJointName}"]`);
  if (!joint) {
    console.warn(`Joint "${oldJointName}" not found in URDF.`);
    return urdfContent;
  }

  // Update the joint name
  joint.setAttribute("name", trimmedNewName);

  // Also update any mimic joints that reference this joint
  const mimicElements = xmlDoc.querySelectorAll(`mimic[joint="${oldJointName}"]`);
  mimicElements.forEach((mimic) => {
    mimic.setAttribute("joint", trimmedNewName);
  });

  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}
