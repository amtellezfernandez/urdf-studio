/**
 * URDF to MJCF (MuJoCo XML Format) Converter
 *
 * Converts URDF robot descriptions to MuJoCo's MJCF format.
 * Based on the structure used by urdf2mjcf (https://github.com/kscalelabs/urdf2mjcf)
 */

import { parseURDF } from "../parsing/urdfParser";

interface MJCFConversionResult {
  mjcfContent: string;
  warnings: string[];
  stats: {
    bodiesCreated: number;
    jointsConverted: number;
    geometriesConverted: number;
  };
}

interface LinkData {
  name: string;
  inertial?: {
    mass: number;
    origin: { xyz: number[]; rpy: number[] };
    inertia: { ixx: number; ixy: number; ixz: number; iyy: number; iyz: number; izz: number };
  };
  visuals: GeometryData[];
  collisions: GeometryData[];
}

interface GeometryData {
  type: string;
  origin: { xyz: number[]; rpy: number[] };
  size?: number[];
  radius?: number;
  length?: number;
  filename?: string;
  scale?: number[];
}

interface JointData {
  name: string;
  type: string;
  parent: string;
  child: string;
  origin: { xyz: number[]; rpy: number[] };
  axis: number[];
  limit?: { lower: number; upper: number; effort: number; velocity: number };
}

/**
 * Parses origin element to extract position and rotation
 */
function parseOrigin(element: Element | null): { xyz: number[]; rpy: number[] } {
  if (!element) {
    return { xyz: [0, 0, 0], rpy: [0, 0, 0] };
  }

  const xyzStr = element.getAttribute("xyz") || "0 0 0";
  const rpyStr = element.getAttribute("rpy") || "0 0 0";

  const xyz = xyzStr.split(/\s+/).map((v) => parseFloat(v) || 0);
  const rpy = rpyStr.split(/\s+/).map((v) => parseFloat(v) || 0);

  return { xyz, rpy };
}

/**
 * Converts RPY (roll-pitch-yaw) to quaternion for MuJoCo
 */
function rpyToQuat(rpy: number[]): number[] {
  const [roll, pitch, yaw] = rpy;

  const cr = Math.cos(roll / 2);
  const sr = Math.sin(roll / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);

  const w = cr * cp * cy + sr * sp * sy;
  const x = sr * cp * cy - cr * sp * sy;
  const y = cr * sp * cy + sr * cp * sy;
  const z = cr * cp * sy - sr * sp * cy;

  return [w, x, y, z];
}

/**
 * Parses a link element from URDF
 */
function parseLink(linkElement: Element): LinkData {
  const name = linkElement.getAttribute("name") || "unnamed_link";

  const linkData: LinkData = {
    name,
    visuals: [],
    collisions: [],
  };

  // Parse inertial
  const inertialEl = linkElement.querySelector("inertial");
  if (inertialEl) {
    const massEl = inertialEl.querySelector("mass");
    const inertiaEl = inertialEl.querySelector("inertia");
    const originEl = inertialEl.querySelector("origin");

    if (massEl && inertiaEl) {
      linkData.inertial = {
        mass: parseFloat(massEl.getAttribute("value") || "1"),
        origin: parseOrigin(originEl),
        inertia: {
          ixx: parseFloat(inertiaEl.getAttribute("ixx") || "0.001"),
          ixy: parseFloat(inertiaEl.getAttribute("ixy") || "0"),
          ixz: parseFloat(inertiaEl.getAttribute("ixz") || "0"),
          iyy: parseFloat(inertiaEl.getAttribute("iyy") || "0.001"),
          iyz: parseFloat(inertiaEl.getAttribute("iyz") || "0"),
          izz: parseFloat(inertiaEl.getAttribute("izz") || "0.001"),
        },
      };
    }
  }

  // Parse visuals
  const visualEls = linkElement.querySelectorAll("visual");
  for (const visual of visualEls) {
    const geom = parseGeometry(visual);
    if (geom) linkData.visuals.push(geom);
  }

  // Parse collisions
  const collisionEls = linkElement.querySelectorAll("collision");
  for (const collision of collisionEls) {
    const geom = parseGeometry(collision);
    if (geom) linkData.collisions.push(geom);
  }

  return linkData;
}

/**
 * Parses geometry from visual or collision element
 */
function parseGeometry(parentElement: Element): GeometryData | null {
  const geometryEl = parentElement.querySelector("geometry");
  if (!geometryEl) return null;

  const originEl = parentElement.querySelector("origin");
  const origin = parseOrigin(originEl);

  // Check for different geometry types
  const box = geometryEl.querySelector("box");
  if (box) {
    const sizeStr = box.getAttribute("size") || "1 1 1";
    const size = sizeStr.split(/\s+/).map((v) => parseFloat(v) || 1);
    return { type: "box", origin, size };
  }

  const cylinder = geometryEl.querySelector("cylinder");
  if (cylinder) {
    const radius = parseFloat(cylinder.getAttribute("radius") || "1");
    const length = parseFloat(cylinder.getAttribute("length") || "1");
    return { type: "cylinder", origin, radius, length };
  }

  const sphere = geometryEl.querySelector("sphere");
  if (sphere) {
    const radius = parseFloat(sphere.getAttribute("radius") || "1");
    return { type: "sphere", origin, radius };
  }

  const mesh = geometryEl.querySelector("mesh");
  if (mesh) {
    const filename = mesh.getAttribute("filename") || "";
    const scaleStr = mesh.getAttribute("scale") || "1 1 1";
    const scale = scaleStr.split(/\s+/).map((v) => parseFloat(v) || 1);
    return { type: "mesh", origin, filename, scale };
  }

  return null;
}

/**
 * Parses a joint element from URDF
 */
function parseJoint(jointElement: Element): JointData {
  const name = jointElement.getAttribute("name") || "unnamed_joint";
  const type = jointElement.getAttribute("type") || "fixed";

  const parentEl = jointElement.querySelector("parent");
  const childEl = jointElement.querySelector("child");
  const originEl = jointElement.querySelector("origin");
  const axisEl = jointElement.querySelector("axis");
  const limitEl = jointElement.querySelector("limit");

  const parent = parentEl?.getAttribute("link") || "";
  const child = childEl?.getAttribute("link") || "";
  const origin = parseOrigin(originEl);

  const axisStr = axisEl?.getAttribute("xyz") || "1 0 0";
  const axis = axisStr.split(/\s+/).map((v) => parseFloat(v) || 0);

  const jointData: JointData = {
    name,
    type,
    parent,
    child,
    origin,
    axis,
  };

  if (limitEl) {
    jointData.limit = {
      lower: parseFloat(limitEl.getAttribute("lower") || "-3.14159"),
      upper: parseFloat(limitEl.getAttribute("upper") || "3.14159"),
      effort: parseFloat(limitEl.getAttribute("effort") || "100"),
      velocity: parseFloat(limitEl.getAttribute("velocity") || "1"),
    };
  }

  return jointData;
}

/**
 * Maps URDF joint type to MuJoCo joint type
 */
function mapJointType(urdfType: string): string {
  switch (urdfType) {
    case "revolute":
    case "continuous":
      return "hinge";
    case "prismatic":
      return "slide";
    case "fixed":
      return ""; // Fixed joints don't need a joint element in MuJoCo
    case "floating":
      return "free";
    case "planar":
      return "slide"; // Approximation
    default:
      return "hinge";
  }
}

/**
 * Converts URDF geometry to MuJoCo geom string
 */
function geometryToMJCF(geom: GeometryData, indent: string, groupType: string): string {
  const quat = rpyToQuat(geom.origin.rpy || [0, 0, 0]);
  const pos = geom.origin.xyz.join(" ");
  const quatStr = quat.map((v) => v.toFixed(6)).join(" ");

  let geomStr = `${indent}<geom `;

  if (groupType === "visual") {
    geomStr += 'group="1" ';
  } else {
    geomStr += 'group="0" ';
  }

  geomStr += `pos="${pos}" quat="${quatStr}" `;

  switch (geom.type) {
    case "box": {
      // MuJoCo uses half-sizes
      const halfSize = geom.size!.map((s) => (s / 2).toFixed(6)).join(" ");
      geomStr += `type="box" size="${halfSize}"`;
      break;
    }

    case "cylinder": {
      // MuJoCo cylinder: radius, half-length
      const cylSize = `${geom.radius!.toFixed(6)} ${(geom.length! / 2).toFixed(6)}`;
      geomStr += `type="cylinder" size="${cylSize}"`;
      break;
    }

    case "sphere":
      geomStr += `type="sphere" size="${geom.radius!.toFixed(6)}"`;
      break;

    case "mesh": {
      // Extract mesh name from filename
      const meshName = geom
        .filename!.split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9_]/g, "_");
      geomStr += `type="mesh" mesh="${meshName}"`;
      break;
    }

    default:
      geomStr += 'type="box" size="0.01 0.01 0.01"';
  }

  geomStr += "/>";
  return geomStr;
}

/**
 * Builds the kinematic tree structure
 */
function buildKinematicTree(
  links: Map<string, LinkData>,
  joints: JointData[]
): { root: string; children: Map<string, JointData[]> } {
  const children = new Map<string, JointData[]>();
  const hasParent = new Set<string>();

  // Initialize children map
  for (const link of links.keys()) {
    children.set(link, []);
  }

  // Build parent-child relationships
  for (const joint of joints) {
    if (!children.has(joint.parent)) {
      children.set(joint.parent, []);
    }
    children.get(joint.parent)!.push(joint);
    hasParent.add(joint.child);
  }

  // Find root (link with no parent)
  let root = "";
  for (const link of links.keys()) {
    if (!hasParent.has(link)) {
      root = link;
      break;
    }
  }

  return { root, children };
}

/**
 * Recursively generates body elements for the kinematic tree
 */
function generateBody(
  linkName: string,
  links: Map<string, LinkData>,
  childrenMap: Map<string, JointData[]>,
  indent: string,
  isRoot: boolean = false
): { xml: string; stats: { bodies: number; joints: number; geoms: number } } {
  const link = links.get(linkName);
  if (!link) {
    return { xml: "", stats: { bodies: 0, joints: 0, geoms: 0 } };
  }

  const stats = { bodies: 1, joints: 0, geoms: 0 };
  let xml = `${indent}<body name="${link.name}"`;

  if (!isRoot) {
    xml += ' pos="0 0 0"';
  }

  xml += ">\n";

  // Add inertial properties
  if (link.inertial) {
    const inertial = link.inertial;
    const ipos = inertial.origin.xyz.join(" ");
    const iquat = rpyToQuat(inertial.origin.rpy)
      .map((v) => v.toFixed(6))
      .join(" ");

    // MuJoCo uses full inertia matrix (diagonal and products)
    xml += `${indent}  <inertial pos="${ipos}" quat="${iquat}" `;
    xml += `mass="${inertial.mass.toFixed(6)}" `;
    xml += `fullinertia="${inertial.inertia.ixx.toFixed(6)} ${inertial.inertia.iyy.toFixed(6)} ${inertial.inertia.izz.toFixed(6)} `;
    xml += `${inertial.inertia.ixy.toFixed(6)} ${inertial.inertia.ixz.toFixed(6)} ${inertial.inertia.iyz.toFixed(6)}"/>\n`;
  }

  // Add visual geometries
  for (const visual of link.visuals) {
    xml += geometryToMJCF(visual, indent + "  ", "visual") + "\n";
    stats.geoms++;
  }

  // Add collision geometries
  for (const collision of link.collisions) {
    xml += geometryToMJCF(collision, indent + "  ", "collision") + "\n";
    stats.geoms++;
  }

  // Process children
  const childJoints = childrenMap.get(linkName) || [];
  for (const joint of childJoints) {
    const childLink = links.get(joint.child);
    if (!childLink) continue;

    // Add joint and child body
    const jpos = joint.origin.xyz.join(" ");
    const jquat = rpyToQuat(joint.origin.rpy)
      .map((v) => v.toFixed(6))
      .join(" ");

    const mjType = mapJointType(joint.type);

    // Child body with joint origin as position
    xml += `${indent}  <body name="${joint.child}" pos="${jpos}" quat="${jquat}">\n`;

    // Add joint if not fixed
    if (mjType) {
      xml += `${indent}    <joint name="${joint.name}" type="${mjType}" `;
      xml += `axis="${joint.axis.join(" ")}" `;

      if (joint.limit && (joint.type === "revolute" || joint.type === "prismatic")) {
        xml += `range="${joint.limit.lower.toFixed(6)} ${joint.limit.upper.toFixed(6)}" `;
      }

      xml += "/>\n";
      stats.joints++;
    }

    // Add child link content
    const childLinkData = links.get(joint.child);
    if (childLinkData) {
      // Add inertial for child
      if (childLinkData.inertial) {
        const inertial = childLinkData.inertial;
        const ipos = inertial.origin.xyz.join(" ");
        const iquat = rpyToQuat(inertial.origin.rpy)
          .map((v) => v.toFixed(6))
          .join(" ");

        xml += `${indent}    <inertial pos="${ipos}" quat="${iquat}" `;
        xml += `mass="${inertial.mass.toFixed(6)}" `;
        xml += `fullinertia="${inertial.inertia.ixx.toFixed(6)} ${inertial.inertia.iyy.toFixed(6)} ${inertial.inertia.izz.toFixed(6)} `;
        xml += `${inertial.inertia.ixy.toFixed(6)} ${inertial.inertia.ixz.toFixed(6)} ${inertial.inertia.iyz.toFixed(6)}"/>\n`;
      }

      // Add geometries for child
      for (const visual of childLinkData.visuals) {
        xml += geometryToMJCF(visual, indent + "    ", "visual") + "\n";
        stats.geoms++;
      }

      for (const collision of childLinkData.collisions) {
        xml += geometryToMJCF(collision, indent + "    ", "collision") + "\n";
        stats.geoms++;
      }

      // Recursively add grandchildren
      const grandchildJoints = childrenMap.get(joint.child) || [];
      for (const grandchildJoint of grandchildJoints) {
        const result = generateBody(grandchildJoint.child, links, childrenMap, indent + "    ");
        // We need to wrap this differently since we're already in the child body
        // Actually, we need to generate the full subtree
      }
    }

    // Recursively process children of this child
    const subChildJoints = childrenMap.get(joint.child) || [];
    for (const subJoint of subChildJoints) {
      const subResult = generateBodyRecursive(subJoint, links, childrenMap, indent + "    ");
      xml += subResult.xml;
      stats.bodies += subResult.stats.bodies;
      stats.joints += subResult.stats.joints;
      stats.geoms += subResult.stats.geoms;
    }

    xml += `${indent}  </body>\n`;
    stats.bodies++;
  }

  xml += `${indent}</body>\n`;

  return { xml, stats };
}

/**
 * Recursively generates body for a joint's child
 */
function generateBodyRecursive(
  joint: JointData,
  links: Map<string, LinkData>,
  childrenMap: Map<string, JointData[]>,
  indent: string
): { xml: string; stats: { bodies: number; joints: number; geoms: number } } {
  const childLink = links.get(joint.child);
  if (!childLink) {
    return { xml: "", stats: { bodies: 0, joints: 0, geoms: 0 } };
  }

  const stats = { bodies: 1, joints: 0, geoms: 0 };

  const jpos = joint.origin.xyz.join(" ");
  const jquat = rpyToQuat(joint.origin.rpy)
    .map((v) => v.toFixed(6))
    .join(" ");

  let xml = `${indent}<body name="${joint.child}" pos="${jpos}" quat="${jquat}">\n`;

  // Add joint
  const mjType = mapJointType(joint.type);
  if (mjType) {
    xml += `${indent}  <joint name="${joint.name}" type="${mjType}" `;
    xml += `axis="${joint.axis.join(" ")}" `;

    if (joint.limit && (joint.type === "revolute" || joint.type === "prismatic")) {
      xml += `range="${joint.limit.lower.toFixed(6)} ${joint.limit.upper.toFixed(6)}" `;
    }

    xml += "/>\n";
    stats.joints++;
  }

  // Add inertial
  if (childLink.inertial) {
    const inertial = childLink.inertial;
    const ipos = inertial.origin.xyz.join(" ");
    const iquat = rpyToQuat(inertial.origin.rpy)
      .map((v) => v.toFixed(6))
      .join(" ");

    xml += `${indent}  <inertial pos="${ipos}" quat="${iquat}" `;
    xml += `mass="${inertial.mass.toFixed(6)}" `;
    xml += `fullinertia="${inertial.inertia.ixx.toFixed(6)} ${inertial.inertia.iyy.toFixed(6)} ${inertial.inertia.izz.toFixed(6)} `;
    xml += `${inertial.inertia.ixy.toFixed(6)} ${inertial.inertia.ixz.toFixed(6)} ${inertial.inertia.iyz.toFixed(6)}"/>\n`;
  }

  // Add geometries
  for (const visual of childLink.visuals) {
    xml += geometryToMJCF(visual, indent + "  ", "visual") + "\n";
    stats.geoms++;
  }

  for (const collision of childLink.collisions) {
    xml += geometryToMJCF(collision, indent + "  ", "collision") + "\n";
    stats.geoms++;
  }

  // Process children recursively
  const subChildJoints = childrenMap.get(joint.child) || [];
  for (const subJoint of subChildJoints) {
    const subResult = generateBodyRecursive(subJoint, links, childrenMap, indent + "  ");
    xml += subResult.xml;
    stats.bodies += subResult.stats.bodies;
    stats.joints += subResult.stats.joints;
    stats.geoms += subResult.stats.geoms;
  }

  xml += `${indent}</body>\n`;

  return { xml, stats };
}

/**
 * Converts URDF to MJCF format
 */
export function convertURDFToMJCF(urdfContent: string): MJCFConversionResult {
  const parsed = parseURDF(urdfContent);

  const result: MJCFConversionResult = {
    mjcfContent: "",
    warnings: [],
    stats: {
      bodiesCreated: 0,
      jointsConverted: 0,
      geometriesConverted: 0,
    },
  };

  if (!parsed.isValid) {
    result.warnings.push("Invalid URDF content");
    return result;
  }

  const robot = parsed.document.querySelector("robot");
  if (!robot) {
    result.warnings.push("No robot element found");
    return result;
  }

  const robotName = robot.getAttribute("name") || "robot";

  // Parse all links
  const links = new Map<string, LinkData>();
  const linkElements = robot.querySelectorAll("link");
  for (const linkEl of linkElements) {
    const linkData = parseLink(linkEl);
    links.set(linkData.name, linkData);
  }

  // Parse all joints
  const joints: JointData[] = [];
  const jointElements = robot.querySelectorAll("joint");
  for (const jointEl of jointElements) {
    joints.push(parseJoint(jointEl));
  }

  // Build kinematic tree
  const { root, children } = buildKinematicTree(links, joints);

  if (!root) {
    result.warnings.push("Could not find root link");
    return result;
  }

  // Collect mesh assets
  const meshAssets: string[] = [];
  for (const link of links.values()) {
    for (const visual of link.visuals) {
      if (visual.type === "mesh" && visual.filename) {
        const meshName = visual
          .filename.split("/")
          .pop()
          ?.replace(/\.[^.]+$/, "")
          .replace(/[^a-zA-Z0-9_]/g, "_");
        const meshFile = visual.filename.split("/").pop();
        if (meshName && meshFile && !meshAssets.some((a) => a.includes(`name="${meshName}"`))) {
          meshAssets.push(`      <mesh name="${meshName}" file="${meshFile}"/>`);
        }
      }
    }
    for (const collision of link.collisions) {
      if (collision.type === "mesh" && collision.filename) {
        const meshName = collision
          .filename.split("/")
          .pop()
          ?.replace(/\.[^.]+$/, "")
          .replace(/[^a-zA-Z0-9_]/g, "_");
        const meshFile = collision.filename.split("/").pop();
        if (meshName && meshFile && !meshAssets.some((a) => a.includes(`name="${meshName}"`))) {
          meshAssets.push(`      <mesh name="${meshName}" file="${meshFile}"/>`);
        }
      }
    }
  }

  // Generate MJCF
  let mjcf = `<?xml version="1.0"?>
<mujoco model="${robotName}">
  <compiler angle="radian" meshdir="meshes"/>

  <option gravity="0 0 -9.81" timestep="0.001"/>

  <default>
    <joint damping="0.1"/>
    <geom contype="1" conaffinity="1" condim="3" friction="1 0.5 0.5"/>
  </default>

`;

  // Add assets section if there are meshes
  if (meshAssets.length > 0) {
    mjcf += `  <asset>\n`;
    mjcf += meshAssets.join("\n") + "\n";
    mjcf += `  </asset>\n\n`;
  }

  // Generate worldbody
  mjcf += `  <worldbody>\n`;

  // Generate root body and all children
  const rootLink = links.get(root);
  if (rootLink) {
    mjcf += `    <body name="${rootLink.name}" pos="0 0 0">\n`;

    // Add inertial for root
    if (rootLink.inertial) {
      const inertial = rootLink.inertial;
      const ipos = inertial.origin.xyz.join(" ");
      const iquat = rpyToQuat(inertial.origin.rpy)
        .map((v) => v.toFixed(6))
        .join(" ");

      mjcf += `      <inertial pos="${ipos}" quat="${iquat}" `;
      mjcf += `mass="${inertial.mass.toFixed(6)}" `;
      mjcf += `fullinertia="${inertial.inertia.ixx.toFixed(6)} ${inertial.inertia.iyy.toFixed(6)} ${inertial.inertia.izz.toFixed(6)} `;
      mjcf += `${inertial.inertia.ixy.toFixed(6)} ${inertial.inertia.ixz.toFixed(6)} ${inertial.inertia.iyz.toFixed(6)}"/>\n`;
    }

    // Add geometries for root
    for (const visual of rootLink.visuals) {
      mjcf += geometryToMJCF(visual, "      ", "visual") + "\n";
      result.stats.geometriesConverted++;
    }

    for (const collision of rootLink.collisions) {
      mjcf += geometryToMJCF(collision, "      ", "collision") + "\n";
      result.stats.geometriesConverted++;
    }

    result.stats.bodiesCreated++;

    // Process children of root
    const rootChildren = children.get(root) || [];
    for (const joint of rootChildren) {
      const bodyResult = generateBodyRecursive(joint, links, children, "      ");
      mjcf += bodyResult.xml;
      result.stats.bodiesCreated += bodyResult.stats.bodies;
      result.stats.jointsConverted += bodyResult.stats.joints;
      result.stats.geometriesConverted += bodyResult.stats.geoms;
    }

    mjcf += `    </body>\n`;
  }

  mjcf += `  </worldbody>\n\n`;

  // Add actuators for all non-fixed joints
  mjcf += `  <actuator>\n`;
  for (const joint of joints) {
    if (joint.type !== "fixed") {
      mjcf += `    <motor name="${joint.name}_motor" joint="${joint.name}" gear="1"/>\n`;
    }
  }
  mjcf += `  </actuator>\n`;

  mjcf += `</mujoco>\n`;

  result.mjcfContent = mjcf;

  return result;
}
