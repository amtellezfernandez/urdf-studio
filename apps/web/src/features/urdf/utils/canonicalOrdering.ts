/**
 * Canonical Ordering Utility for URDF
 *
 * Reorders URDF elements to follow standard ROS conventions:
 * - Robot level: link, joint, transmission, gazebo
 * - Link level: visual, collision, inertial
 * - Joint level: origin, parent, child, axis, limit, dynamics, mimic, safety_controller
 */

import { parseURDF, serializeURDF } from "../parsing/urdfParser";

// Order for top-level robot children
const ROBOT_CHILD_ORDER: Record<string, number> = {
  link: 0,
  joint: 1,
  transmission: 2,
  gazebo: 3,
  material: 4,
};

// Order for link children
const LINK_CHILD_ORDER: Record<string, number> = {
  visual: 0,
  collision: 1,
  inertial: 2,
};

// Order for joint children
const JOINT_CHILD_ORDER: Record<string, number> = {
  origin: 0,
  parent: 1,
  child: 2,
  axis: 3,
  limit: 4,
  dynamics: 5,
  mimic: 6,
  safety_controller: 7,
};

// Order for visual/collision children
const GEOMETRY_CHILD_ORDER: Record<string, number> = {
  origin: 0,
  geometry: 1,
  material: 2,
};

// Order for inertial children
const INERTIAL_CHILD_ORDER: Record<string, number> = {
  origin: 0,
  mass: 1,
  inertia: 2,
};

/**
 * Sorts child elements of a parent element according to a given order
 */
function sortChildElements(parent: Element, orderMap: Record<string, number>): void {
  const children = Array.from(parent.children);

  // Sort children based on the order map
  children.sort((a, b) => {
    const orderA = orderMap[a.tagName] ?? 999;
    const orderB = orderMap[b.tagName] ?? 999;
    return orderA - orderB;
  });

  // Remove all children and re-add in sorted order
  while (parent.firstChild) {
    parent.removeChild(parent.firstChild);
  }

  // Re-add children in sorted order with proper spacing
  children.forEach((child) => {
    parent.appendChild(child);
  });
}

/**
 * Recursively applies canonical ordering to URDF elements
 */
function applyCanonicalOrdering(element: Element): void {
  const tagName = element.tagName;

  if (tagName === "robot") {
    sortChildElements(element, ROBOT_CHILD_ORDER);
  } else if (tagName === "link") {
    sortChildElements(element, LINK_CHILD_ORDER);
  } else if (tagName === "joint") {
    sortChildElements(element, JOINT_CHILD_ORDER);
  } else if (tagName === "visual" || tagName === "collision") {
    sortChildElements(element, GEOMETRY_CHILD_ORDER);
  } else if (tagName === "inertial") {
    sortChildElements(element, INERTIAL_CHILD_ORDER);
  }

  // Recursively process all child elements
  Array.from(element.children).forEach((child) => {
    applyCanonicalOrdering(child);
  });
}

/**
 * Reorders URDF elements to follow canonical/standard ordering
 *
 * @param urdfContent - URDF XML content as string
 * @returns URDF with canonically ordered elements
 */
export function canonicalOrderURDF(urdfContent: string): string {
  const parsed = parseURDF(urdfContent);

  if (!parsed.isValid) {
    console.error("Cannot apply canonical ordering: Invalid URDF");
    return urdfContent;
  }

  const robot = parsed.document.querySelector("robot");
  if (!robot) {
    return urdfContent;
  }

  // Apply canonical ordering recursively
  applyCanonicalOrdering(robot);

  return serializeURDF(parsed.document);
}
