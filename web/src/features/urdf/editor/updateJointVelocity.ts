/**
 * Updates the velocity limit of a joint in the URDF XML content
 */
export function updateJointVelocityInURDF(
  urdfContent: string,
  jointName: string,
  velocity: number | null
): string {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) {
    const errorText = parserError.textContent || "Unknown XML parsing error";
    console.warn("URDF parsing error:", errorText);
    return urdfContent;
  }

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

  const preservedName = joint.getAttribute("name");
  const preservedType = joint.getAttribute("type");

  let limitElement = joint.querySelector("limit");
  if (!limitElement) {
    if (velocity === null || velocity === undefined) {
      return urdfContent;
    }
    limitElement = xmlDoc.createElement("limit");
    joint.appendChild(limitElement);
  }

  if (velocity === null || velocity === undefined || !Number.isFinite(velocity) || velocity <= 0) {
    limitElement.removeAttribute("velocity");
  } else {
    limitElement.setAttribute("velocity", velocity.toString());
  }

  if (preservedName) {
    joint.setAttribute("name", preservedName);
  }
  if (preservedType) {
    joint.setAttribute("type", preservedType);
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}
