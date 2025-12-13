/**
 * Gets the parent and child link names for a given joint name from URDF content
 */
export function getJointLinks(urdfContent: string, jointName: string): { parentLink: string | null; childLink: string | null } {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
    
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      const errorText = parserError.textContent || "Unknown XML parsing error";
      console.error("URDF parsing error:", errorText);
      return { parentLink: null, childLink: null };
    }
    
    // Validate robot element exists
    const robot = xmlDoc.querySelector("robot");
    if (!robot) {
      console.error("No <robot> element found in URDF");
      return { parentLink: null, childLink: null };
    }
    
    const joint = xmlDoc.querySelector(`joint[name="${jointName}"]`);
    if (!joint) {
      return { parentLink: null, childLink: null };
    }
    
    const parent = joint.querySelector("parent");
    const child = joint.querySelector("child");
    
    return {
      parentLink: parent?.getAttribute("link") || null,
      childLink: child?.getAttribute("link") || null,
    };
  } catch (error) {
    console.error("Error parsing URDF:", error);
    return { parentLink: null, childLink: null };
  }
}

