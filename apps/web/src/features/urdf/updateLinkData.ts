/**
 * Helper functions to update link visual, collision, and inertial elements in URDF
 */

export function updateVisualInLink(
  urdfContent: string,
  linkName: string,
  visualIndex: number,
  geometryType: "box" | "sphere" | "cylinder" | "mesh",
  geometryParams: Record<string, string>,
  origin: { xyz: [number, number, number]; rpy: [number, number, number] },
  materialColor?: string
): string {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) return urdfContent;

  const link = xmlDoc.querySelector(`link[name="${linkName}"]`);
  if (!link) return urdfContent;

  const visuals = link.querySelectorAll("visual");
  if (visualIndex < 0 || visualIndex >= visuals.length) return urdfContent;

  const visual = visuals[visualIndex];

  // Update origin
  let originEl = visual.querySelector("origin");
  if (!originEl) {
    originEl = xmlDoc.createElement("origin");
    visual.insertBefore(originEl, visual.firstChild);
  }
  originEl.setAttribute("xyz", `${origin.xyz[0]} ${origin.xyz[1]} ${origin.xyz[2]}`);
  originEl.setAttribute("rpy", `${origin.rpy[0]} ${origin.rpy[1]} ${origin.rpy[2]}`);

  // Update geometry
  let geometry = visual.querySelector("geometry");
  if (!geometry) {
    geometry = xmlDoc.createElement("geometry");
    visual.appendChild(geometry);
  }

  // Remove old geometry elements
  geometry.querySelectorAll("box, sphere, cylinder, mesh").forEach(el => el.remove());

  let geometryEl: Element;
  if (geometryType === "box") {
    geometryEl = xmlDoc.createElement("box");
    geometryEl.setAttribute("size", geometryParams.size || "1 1 1");
  } else if (geometryType === "sphere") {
    geometryEl = xmlDoc.createElement("sphere");
    geometryEl.setAttribute("radius", geometryParams.radius || "1");
  } else if (geometryType === "cylinder") {
    geometryEl = xmlDoc.createElement("cylinder");
    geometryEl.setAttribute("radius", geometryParams.radius || "1");
    geometryEl.setAttribute("length", geometryParams.length || "1");
  } else { // mesh
    geometryEl = xmlDoc.createElement("mesh");
    geometryEl.setAttribute("filename", geometryParams.filename || "");
    if (geometryParams.scale) {
      geometryEl.setAttribute("scale", geometryParams.scale);
    }
  }
  geometry.appendChild(geometryEl);

  // Update material
  if (materialColor) {
    let material = visual.querySelector("material");
    if (!material) {
      material = xmlDoc.createElement("material");
      visual.appendChild(material);
    }
    const materialName = `material_${linkName}`;
    material.setAttribute("name", materialName);
    
    let color = material.querySelector("color");
    if (!color) {
      color = xmlDoc.createElement("color");
      material.appendChild(color);
    }
    const r = parseInt(materialColor.slice(1, 3), 16) / 255;
    const g = parseInt(materialColor.slice(3, 5), 16) / 255;
    const b = parseInt(materialColor.slice(5, 7), 16) / 255;
    color.setAttribute("rgba", `${r} ${g} ${b} 1.0`);
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

export function addCollisionToLink(
  urdfContent: string,
  linkName: string,
  geometryType: "box" | "sphere" | "cylinder" | "mesh",
  geometryParams: Record<string, string>,
  origin?: { xyz: [number, number, number]; rpy: [number, number, number] }
): string {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) return urdfContent;

  const robot = xmlDoc.querySelector("robot");
  if (!robot) return urdfContent;

  const link = xmlDoc.querySelector(`link[name="${linkName}"]`);
  if (!link) return urdfContent;

  // Create collision element
  const collision = xmlDoc.createElement("collision");

  // Create origin
  const originEl = xmlDoc.createElement("origin");
  originEl.setAttribute("xyz", origin ? `${origin.xyz[0]} ${origin.xyz[1]} ${origin.xyz[2]}` : "0 0 0");
  originEl.setAttribute("rpy", origin ? `${origin.rpy[0]} ${origin.rpy[1]} ${origin.rpy[2]}` : "0 0 0");
  collision.appendChild(originEl);

  // Create geometry
  const geometry = xmlDoc.createElement("geometry");
  let geometryEl: Element;
  
  if (geometryType === "box") {
    geometryEl = xmlDoc.createElement("box");
    geometryEl.setAttribute("size", geometryParams.size || "1 1 1");
  } else if (geometryType === "sphere") {
    geometryEl = xmlDoc.createElement("sphere");
    geometryEl.setAttribute("radius", geometryParams.radius || "1");
  } else if (geometryType === "cylinder") {
    geometryEl = xmlDoc.createElement("cylinder");
    geometryEl.setAttribute("radius", geometryParams.radius || "1");
    geometryEl.setAttribute("length", geometryParams.length || "1");
  } else { // mesh
    geometryEl = xmlDoc.createElement("mesh");
    geometryEl.setAttribute("filename", geometryParams.filename || "");
    if (geometryParams.scale) {
      geometryEl.setAttribute("scale", geometryParams.scale);
    }
  }
  
  geometry.appendChild(geometryEl);
  collision.appendChild(geometry);
  link.appendChild(collision);

  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

export function updateCollisionInLink(
  urdfContent: string,
  linkName: string,
  collisionIndex: number,
  geometryType: "box" | "sphere" | "cylinder" | "mesh",
  geometryParams: Record<string, string>,
  origin: { xyz: [number, number, number]; rpy: [number, number, number] }
): string {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) return urdfContent;

  const link = xmlDoc.querySelector(`link[name="${linkName}"]`);
  if (!link) return urdfContent;

  const collisions = link.querySelectorAll("collision");
  if (collisionIndex < 0 || collisionIndex >= collisions.length) return urdfContent;

  const collision = collisions[collisionIndex];

  // Update origin
  let originEl = collision.querySelector("origin");
  if (!originEl) {
    originEl = xmlDoc.createElement("origin");
    collision.insertBefore(originEl, collision.firstChild);
  }
  originEl.setAttribute("xyz", `${origin.xyz[0]} ${origin.xyz[1]} ${origin.xyz[2]}`);
  originEl.setAttribute("rpy", `${origin.rpy[0]} ${origin.rpy[1]} ${origin.rpy[2]}`);

  // Update geometry
  let geometry = collision.querySelector("geometry");
  if (!geometry) {
    geometry = xmlDoc.createElement("geometry");
    collision.appendChild(geometry);
  }

  // Remove old geometry elements
  geometry.querySelectorAll("box, sphere, cylinder, mesh").forEach(el => el.remove());

  let geometryEl: Element;
  if (geometryType === "box") {
    geometryEl = xmlDoc.createElement("box");
    geometryEl.setAttribute("size", geometryParams.size || "1 1 1");
  } else if (geometryType === "sphere") {
    geometryEl = xmlDoc.createElement("sphere");
    geometryEl.setAttribute("radius", geometryParams.radius || "1");
  } else if (geometryType === "cylinder") {
    geometryEl = xmlDoc.createElement("cylinder");
    geometryEl.setAttribute("radius", geometryParams.radius || "1");
    geometryEl.setAttribute("length", geometryParams.length || "1");
  } else { // mesh
    geometryEl = xmlDoc.createElement("mesh");
    geometryEl.setAttribute("filename", geometryParams.filename || "");
    if (geometryParams.scale) {
      geometryEl.setAttribute("scale", geometryParams.scale);
    }
  }
  geometry.appendChild(geometryEl);

  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

export function addInertialToLink(
  urdfContent: string,
  linkName: string,
  mass: number,
  inertia: { ixx: number; ixy: number; ixz: number; iyy: number; iyz: number; izz: number },
  origin?: { xyz: [number, number, number]; rpy: [number, number, number] }
): string {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) return urdfContent;

  const robot = xmlDoc.querySelector("robot");
  if (!robot) return urdfContent;

  const link = xmlDoc.querySelector(`link[name="${linkName}"]`);
  if (!link) return urdfContent;

  // Create inertial element
  const inertial = xmlDoc.createElement("inertial");

  // Create mass
  const massEl = xmlDoc.createElement("mass");
  massEl.setAttribute("value", String(mass));
  inertial.appendChild(massEl);

  // Create origin
  const originEl = xmlDoc.createElement("origin");
  originEl.setAttribute("xyz", origin ? `${origin.xyz[0]} ${origin.xyz[1]} ${origin.xyz[2]}` : "0 0 0");
  originEl.setAttribute("rpy", origin ? `${origin.rpy[0]} ${origin.rpy[1]} ${origin.rpy[2]}` : "0 0 0");
  inertial.appendChild(originEl);

  // Create inertia
  const inertiaEl = xmlDoc.createElement("inertia");
  inertiaEl.setAttribute("ixx", String(inertia.ixx));
  inertiaEl.setAttribute("ixy", String(inertia.ixy));
  inertiaEl.setAttribute("ixz", String(inertia.ixz));
  inertiaEl.setAttribute("iyy", String(inertia.iyy));
  inertiaEl.setAttribute("iyz", String(inertia.iyz));
  inertiaEl.setAttribute("izz", String(inertia.izz));
  inertial.appendChild(inertiaEl);

  link.appendChild(inertial);

  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

export function updateInertialInLink(
  urdfContent: string,
  linkName: string,
  mass: number,
  inertia: { ixx: number; ixy: number; ixz: number; iyy: number; iyz: number; izz: number },
  origin: { xyz: [number, number, number]; rpy: [number, number, number] }
): string {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) return urdfContent;

  const link = xmlDoc.querySelector(`link[name="${linkName}"]`);
  if (!link) return urdfContent;

  const inertial = link.querySelector("inertial");
  if (!inertial) return urdfContent;

  // Update mass
  let massEl = inertial.querySelector("mass");
  if (!massEl) {
    massEl = xmlDoc.createElement("mass");
    inertial.insertBefore(massEl, inertial.firstChild);
  }
  massEl.setAttribute("value", String(mass));

  // Update origin
  let originEl = inertial.querySelector("origin");
  if (!originEl) {
    originEl = xmlDoc.createElement("origin");
    inertial.insertBefore(originEl, massEl.nextSibling);
  }
  originEl.setAttribute("xyz", `${origin.xyz[0]} ${origin.xyz[1]} ${origin.xyz[2]}`);
  originEl.setAttribute("rpy", `${origin.rpy[0]} ${origin.rpy[1]} ${origin.rpy[2]}`);

  // Update inertia
  let inertiaEl = inertial.querySelector("inertia");
  if (!inertiaEl) {
    inertiaEl = xmlDoc.createElement("inertia");
    inertial.appendChild(inertiaEl);
  }
  inertiaEl.setAttribute("ixx", String(inertia.ixx));
  inertiaEl.setAttribute("ixy", String(inertia.ixy));
  inertiaEl.setAttribute("ixz", String(inertia.ixz));
  inertiaEl.setAttribute("iyy", String(inertia.iyy));
  inertiaEl.setAttribute("iyz", String(inertia.iyz));
  inertiaEl.setAttribute("izz", String(inertia.izz));

  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

export function removeVisualFromLink(urdfContent: string, linkName: string, visualIndex: number): string {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) return urdfContent;

  const link = xmlDoc.querySelector(`link[name="${linkName}"]`);
  if (!link) return urdfContent;

  const visuals = link.querySelectorAll("visual");
  if (visualIndex >= 0 && visualIndex < visuals.length) {
    visuals[visualIndex].remove();
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

export function removeCollisionFromLink(urdfContent: string, linkName: string, collisionIndex: number): string {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) return urdfContent;

  const link = xmlDoc.querySelector(`link[name="${linkName}"]`);
  if (!link) return urdfContent;

  const collisions = link.querySelectorAll("collision");
  if (collisionIndex >= 0 && collisionIndex < collisions.length) {
    collisions[collisionIndex].remove();
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

export function removeInertialFromLink(urdfContent: string, linkName: string): string {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) return urdfContent;

  const link = xmlDoc.querySelector(`link[name="${linkName}"]`);
  if (!link) return urdfContent;

  const inertial = link.querySelector("inertial");
  if (inertial) {
    inertial.remove();
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}
