/**
 * Gets the child link name for a given joint name from URDF content
 */
export function getJointChildLink(urdfContent: string, jointName: string): string | null {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
    
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      const errorText = parserError.textContent || "Unknown XML parsing error";
      console.error("URDF parsing error:", errorText);
      return null;
    }
    
    // Validate robot element exists
    const robot = xmlDoc.querySelector("robot");
    if (!robot) {
      console.error("No <robot> element found in URDF");
      return null;
    }
    
    const joint = xmlDoc.querySelector(`joint[name="${jointName}"]`);
    if (!joint) {
      return null;
    }
    
    const child = joint.querySelector("child");
    return child?.getAttribute("link") || null;
  } catch (error) {
    console.error("Error parsing URDF:", error);
    return null;
  }
}

/**
 * Gets the current material color for a link from URDF content
 */
export function getLinkMaterialColor(urdfContent: string, linkName: string): string | null {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
    
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      const errorText = parserError.textContent || "Unknown XML parsing error";
      console.error("URDF parsing error:", errorText);
      return null;
    }
    
    // Validate robot element exists
    const robot = xmlDoc.querySelector("robot");
    if (!robot) {
      console.error("No <robot> element found in URDF");
      return null;
    }
    
    const link = xmlDoc.querySelector(`link[name="${linkName}"]`);
    if (!link) {
      return null;
    }
    
    const visual = link.querySelector("visual");
    if (!visual) {
      return null;
    }
    
    const material = visual.querySelector("material");
    if (!material) {
      return null;
    }
    
    const materialName = material.getAttribute("name");
    if (!materialName) {
      // Check for inline color
      const color = material.querySelector("color");
      if (color) {
        const rgba = color.getAttribute("rgba");
        if (rgba) {
          const [r, g, b] = rgba.split(" ").map(parseFloat);
          const hex = `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`;
          return hex;
        }
      }
      return null;
    }
    
    // Find material definition
    const materialDef = xmlDoc.querySelector(`material[name="${materialName}"]`);
    if (!materialDef) {
      return null;
    }
    
    const color = materialDef.querySelector("color");
    if (!color) {
      return null;
    }
    
    const rgba = color.getAttribute("rgba");
    if (!rgba) {
      return null;
    }
    
    const [r, g, b] = rgba.split(" ").map(parseFloat);
    const hex = `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`;
    return hex;
  } catch (error) {
    console.error("Error parsing URDF:", error);
    return null;
  }
}

