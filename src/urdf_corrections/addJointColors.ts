/**
 * URDF Correction Script: Add Joint Colors
 * 
 * This script modifies URDF files to add colors to joint links:
 * - Revolute joints: Blue color
 * - Other movable joints (continuous, prismatic, etc.): Green color
 */

export interface JointColorConfig {
  revoluteColor: string; // Color for revolute joints (e.g., "0.2 0.4 1.0" for blue)
  movableColor: string;  // Color for other movable joints (e.g., "0.2 1.0 0.4" for green)
  fixedColor: string;    // Color for fixed joints (e.g., "0.5 0.5 0.5" for grey)
}

export const DEFAULT_COLORS: JointColorConfig = {
  revoluteColor: "0.2 0.4 1.0",  // Blue
  movableColor: "0.2 1.0 0.4",   // Green
  fixedColor: "0.5 0.5 0.5",     // Grey
};

/**
 * Adds color materials to URDF for joint links
 * @param urdfContent Original URDF XML content
 * @param config Color configuration
 * @returns Modified URDF XML content with colors added
 */
export function addJointColorsToURDF(
  urdfContent: string,
  config: JointColorConfig = DEFAULT_COLORS
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
  const robotElement = xmlDoc.querySelector("robot");
  if (!robotElement) {
    console.error("No <robot> element found in URDF");
    return urdfContent;
  }

  // Find all joints
  const joints = xmlDoc.querySelectorAll("joint");

  // Create color materials if they don't exist
  const materials = xmlDoc.querySelector("robot")?.querySelectorAll("material") || [];
  const existingMaterialNames = new Set<string>();
  materials.forEach((mat) => {
    const name = mat.getAttribute("name");
    if (name) existingMaterialNames.add(name);
  });

  // Add revolute joint color material
  if (!existingMaterialNames.has("revolute_joint_color")) {
    const robot = xmlDoc.querySelector("robot");
    if (robot) {
      const revoluteMat = xmlDoc.createElement("material");
      revoluteMat.setAttribute("name", "revolute_joint_color");
      const color = xmlDoc.createElement("color");
      color.setAttribute("rgba", `${config.revoluteColor} 1.0`);
      revoluteMat.appendChild(color);
      robot.insertBefore(revoluteMat, robot.firstChild);
    }
  }

  // Add movable joint color material
  if (!existingMaterialNames.has("movable_joint_color")) {
    const robot = xmlDoc.querySelector("robot");
    if (robot) {
      const movableMat = xmlDoc.createElement("material");
      movableMat.setAttribute("name", "movable_joint_color");
      const color = xmlDoc.createElement("color");
      color.setAttribute("rgba", `${config.movableColor} 1.0`);
      movableMat.appendChild(color);
      robot.insertBefore(movableMat, robot.firstChild);
    }
  }

  // Add fixed joint color material (grey)
  if (!existingMaterialNames.has("fixed_joint_color")) {
    const robot = xmlDoc.querySelector("robot");
    if (robot) {
      const fixedMat = xmlDoc.createElement("material");
      fixedMat.setAttribute("name", "fixed_joint_color");
      const color = xmlDoc.createElement("color");
      color.setAttribute("rgba", `${config.fixedColor} 1.0`);
      fixedMat.appendChild(color);
      robot.insertBefore(fixedMat, robot.firstChild);
    }
  }

  // Apply colors to joint child links
  joints.forEach((joint) => {
    const jointType = joint.getAttribute("type");
    const childLinkName = joint.querySelector("child")?.getAttribute("link");
    
    if (!childLinkName || !jointType) return;

    // Determine which color to use
    let materialName: string | null = null;
    if (jointType === "fixed") {
      materialName = "fixed_joint_color";
    } else if (jointType === "revolute") {
      materialName = "revolute_joint_color";
    } else if (["continuous", "prismatic", "planar", "floating"].includes(jointType)) {
      // All movable joint types (excluding fixed and revolute)
      materialName = "movable_joint_color";
    }

    if (!materialName) return;

    // Find the child link
    const links = xmlDoc.querySelectorAll(`link[name="${childLinkName}"]`);
    links.forEach((link) => {
      // Find all visual elements in this link
      const visuals = link.querySelectorAll("visual");
      visuals.forEach((visual) => {
        // Check if material already exists
        let material = visual.querySelector("material");
        if (!material) {
          material = xmlDoc.createElement("material");
          visual.appendChild(material);
        }
        // Set or update the material name
        material.setAttribute("name", materialName!);
      });
    });
  });

  // Convert back to XML string
  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

/**
 * Creates a viz-*.urdf filename from the original filename
 */
export function createVizFilename(originalFilename: string): string {
  const parts = originalFilename.split(".");
  if (parts.length > 1) {
    const ext = parts.pop();
    return `viz-${parts.join(".")}.${ext}`;
  }
  return `viz-${originalFilename}.urdf`;
}

