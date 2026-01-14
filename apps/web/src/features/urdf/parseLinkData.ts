/**
 * Parses all visual, collision, and inertial elements from a link
 */

interface GeometryData {
  type: "box" | "sphere" | "cylinder" | "mesh" | null;
  params: Record<string, string>;
}

export interface OriginData {
  xyz: [number, number, number];
  rpy: [number, number, number];
}

export interface VisualData {
  origin: OriginData;
  geometry: GeometryData;
  materialName: string | null;
  materialColor: string | null; // hex color
}

export interface CollisionData {
  origin: OriginData;
  geometry: GeometryData;
}

export interface InertialData {
  mass: number;
  origin: OriginData;
  inertia: {
    ixx: number;
    ixy: number;
    ixz: number;
    iyy: number;
    iyz: number;
    izz: number;
  };
}

export interface LinkData {
  name: string;
  visuals: VisualData[];
  collisions: CollisionData[];
  inertial: InertialData | null;
}

function parseOrigin(element: Element): OriginData {
  const origin = element.querySelector("origin");
  if (!origin) {
    return { xyz: [0, 0, 0], rpy: [0, 0, 0] };
  }

  const xyzStr = origin.getAttribute("xyz") || "0 0 0";
  const rpyStr = origin.getAttribute("rpy") || "0 0 0";
  
  const xyz = xyzStr.split(" ").map(parseFloat).slice(0, 3) as [number, number, number];
  const rpy = rpyStr.split(" ").map(parseFloat).slice(0, 3) as [number, number, number];

  return {
    xyz: [xyz[0] || 0, xyz[1] || 0, xyz[2] || 0],
    rpy: [rpy[0] || 0, rpy[1] || 0, rpy[2] || 0],
  };
}

function parseGeometry(geometry: Element): GeometryData {
  const box = geometry.querySelector("box");
  if (box) {
    const size = box.getAttribute("size") || "1 1 1";
    return {
      type: "box",
      params: { size },
    };
  }

  const sphere = geometry.querySelector("sphere");
  if (sphere) {
    const radius = sphere.getAttribute("radius") || "1";
    return {
      type: "sphere",
      params: { radius },
    };
  }

  const cylinder = geometry.querySelector("cylinder");
  if (cylinder) {
    const radius = cylinder.getAttribute("radius") || "1";
    const length = cylinder.getAttribute("length") || "1";
    return {
      type: "cylinder",
      params: { radius, length },
    };
  }

  const mesh = geometry.querySelector("mesh");
  if (mesh) {
    const filename = mesh.getAttribute("filename") || "";
    const scale = mesh.getAttribute("scale") || "1 1 1";
    return {
      type: "mesh",
      params: { filename, scale },
    };
  }

  return { type: null, params: {} };
}

function parseMaterial(visual: Element, xmlDoc: Document): { name: string | null; color: string | null } {
  const material = visual.querySelector("material");
  if (!material) {
    return { name: null, color: null };
  }

  const materialName = material.getAttribute("name");
  
  // Check for inline color
  const inlineColor = material.querySelector("color");
  if (inlineColor) {
    const rgba = inlineColor.getAttribute("rgba");
    if (rgba) {
      const [r, g, b] = rgba.split(" ").map(parseFloat);
      const hex = `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`;
      return { name: materialName, color: hex };
    }
  }

  // Check for referenced material
  if (materialName) {
    const materialDef = xmlDoc.querySelector(`material[name="${materialName}"]`);
    if (materialDef) {
      const color = materialDef.querySelector("color");
      if (color) {
        const rgba = color.getAttribute("rgba");
        if (rgba) {
          const [r, g, b] = rgba.split(" ").map(parseFloat);
          const hex = `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`;
          return { name: materialName, color: hex };
        }
      }
    }
  }

  return { name: materialName, color: null };
}

function parseLinkDataFromElement(link: Element, xmlDoc: Document): LinkData | null {
  const linkName = link.getAttribute("name");
  if (!linkName) return null;

  // Parse visuals
  const visuals: VisualData[] = [];
  const visualElements = link.querySelectorAll("visual");
  visualElements.forEach((visual) => {
    const geometry = visual.querySelector("geometry");
    if (!geometry) return;

    const origin = parseOrigin(visual);
    const geometryData = parseGeometry(geometry);
    const material = parseMaterial(visual, xmlDoc);

    visuals.push({
      origin,
      geometry: geometryData,
      materialName: material.name,
      materialColor: material.color,
    });
  });

  // Parse collisions
  const collisions: CollisionData[] = [];
  const collisionElements = link.querySelectorAll("collision");
  collisionElements.forEach((collision) => {
    const geometry = collision.querySelector("geometry");
    if (!geometry) return;

    const origin = parseOrigin(collision);
    const geometryData = parseGeometry(geometry);

    collisions.push({
      origin,
      geometry: geometryData,
    });
  });

  // Parse inertial
  let inertial: InertialData | null = null;
  const inertialElement = link.querySelector("inertial");
  if (inertialElement) {
    const massElement = inertialElement.querySelector("mass");
    const mass = massElement ? parseFloat(massElement.getAttribute("value") || "0") : 0;

    const origin = parseOrigin(inertialElement);

    const inertiaElement = inertialElement.querySelector("inertia");
    let inertia = {
      ixx: 0, ixy: 0, ixz: 0,
      iyy: 0, iyz: 0, izz: 0,
    };
    if (inertiaElement) {
      inertia = {
        ixx: parseFloat(inertiaElement.getAttribute("ixx") || "0"),
        ixy: parseFloat(inertiaElement.getAttribute("ixy") || "0"),
        ixz: parseFloat(inertiaElement.getAttribute("ixz") || "0"),
        iyy: parseFloat(inertiaElement.getAttribute("iyy") || "0"),
        iyz: parseFloat(inertiaElement.getAttribute("iyz") || "0"),
        izz: parseFloat(inertiaElement.getAttribute("izz") || "0"),
      };
    }

    inertial = {
      mass,
      origin,
      inertia,
    };
  }

  return {
    name: linkName,
    visuals,
    collisions,
    inertial,
  };
}

export function parseLinkData(urdfContent: string, linkName: string): LinkData | null {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      return null;
    }

    const robot = xmlDoc.querySelector("robot");
    if (!robot) {
      return null;
    }

    const link = xmlDoc.querySelector(`link[name="${linkName}"]`);
    if (!link) {
      return null;
    }

    const data = parseLinkDataFromElement(link, xmlDoc);
    if (!data) {
      return null;
    }
    return {
      ...data,
      name: linkName,
    };
  } catch (error) {
    console.error("Error parsing link data:", error);
    return null;
  }
}

