/**
 * Updates the name of a link in the URDF XML content
 */
export function updateLinkNameInURDF(
  urdfContent: string,
  oldLinkName: string,
  newLinkName: string
): string {
  if (oldLinkName === newLinkName) {
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

  // Find the link element
  const link = xmlDoc.querySelector(`link[name="${oldLinkName}"]`);
  if (!link) {
    console.warn(`Link "${oldLinkName}" not found in URDF.`);
    return urdfContent;
  }

  // Check if new name already exists
  const existingLink = xmlDoc.querySelector(`link[name="${newLinkName}"]`);
  if (existingLink) {
    console.warn(`Link "${newLinkName}" already exists in URDF.`);
    return urdfContent;
  }

  // Update the link name attribute
  link.setAttribute("name", newLinkName);

  // Update all joint references to this link (parent and child)
  const joints = xmlDoc.querySelectorAll("joint");
  joints.forEach((joint) => {
    const parent = joint.querySelector("parent");
    const child = joint.querySelector("child");
    
    if (parent && parent.getAttribute("link") === oldLinkName) {
      parent.setAttribute("link", newLinkName);
    }
    if (child && child.getAttribute("link") === oldLinkName) {
      child.setAttribute("link", newLinkName);
    }
  });

  // Serialize back to string
  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

