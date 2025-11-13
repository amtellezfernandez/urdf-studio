/**
 * Updates the parent and child links of a joint in the URDF XML content
 */
export function updateJointLinksInURDF(
  urdfContent: string,
  jointName: string,
  parentLink: string,
  childLink: string
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

  // Update or create parent element
  let parentElement = joint.querySelector("parent");
  if (!parentElement) {
    parentElement = xmlDoc.createElement("parent");
    // Insert at the beginning of the joint
    joint.insertBefore(parentElement, joint.firstChild);
  }
  parentElement.setAttribute("link", parentLink);

  // Update or create child element
  let childElement = joint.querySelector("child");
  if (!childElement) {
    childElement = xmlDoc.createElement("child");
    // Insert after parent
    if (parentElement.nextSibling) {
      joint.insertBefore(childElement, parentElement.nextSibling);
    } else {
      joint.appendChild(childElement);
    }
  }
  childElement.setAttribute("link", childLink);

  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

