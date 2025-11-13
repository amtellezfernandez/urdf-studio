/**
 * Parses URDF to get hierarchical joint structure
 */

export interface JointHierarchyNode {
  jointName: string;
  childLink: string;
  parentLink: string;
  type: string;
  children: JointHierarchyNode[];
  depth: number; // Hierarchy depth level
  order: number; // Original order in URDF
  parentJoint?: string; // Name of parent joint
}

export interface JointHierarchy {
  rootJoints: JointHierarchyNode[];
  allJoints: Map<string, JointHierarchyNode>;
  orderedJoints: JointHierarchyNode[]; // All joints in URDF order
}

export function parseJointHierarchy(urdfContent: string): JointHierarchy {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
  
  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) {
    const errorText = parserError.textContent || "Unknown XML parsing error";
    console.error("URDF parsing error:", errorText);
    return { rootJoints: [], allJoints: new Map(), orderedJoints: [] };
  }
  
  // Validate robot element exists
  const robot = xmlDoc.querySelector("robot");
  if (!robot) {
    console.error("No <robot> element found in URDF");
    return { rootJoints: [], allJoints: new Map(), orderedJoints: [] };
  }
  
  const allJoints = new Map<string, JointHierarchyNode>();
  const linkToJoint = new Map<string, string>(); // child link -> joint name
  const jointToParentLink = new Map<string, string>(); // joint name -> parent link
  const jointToParentJoint = new Map<string, string>(); // joint name -> parent joint name
  const orderedJoints: JointHierarchyNode[] = [];
  
  // First pass: collect all joints in URDF order
  const jointElements = xmlDoc.querySelectorAll("joint");
  let orderIndex = 0;
  jointElements.forEach((joint) => {
    const name = joint.getAttribute("name");
    const type = joint.getAttribute("type") || "unknown";
    const parent = joint.querySelector("parent")?.getAttribute("link");
    const child = joint.querySelector("child")?.getAttribute("link");
    
    if (name && parent && child) {
      const jointNode: JointHierarchyNode = {
        jointName: name,
        childLink: child,
        parentLink: parent,
        type,
        children: [],
        depth: 0,
        order: orderIndex++,
      };
      allJoints.set(name, jointNode);
      orderedJoints.push(jointNode);
      linkToJoint.set(child, name);
      jointToParentLink.set(name, parent);
    }
  });
  
  // Second pass: build hierarchy
  const rootJoints: JointHierarchyNode[] = [];
  const processedLinks = new Set<string>();
  
  // Find root links (links that are not children of any joint)
  const allLinks = new Set<string>();
  xmlDoc.querySelectorAll("link").forEach(link => {
    const name = link.getAttribute("name");
    if (name) allLinks.add(name);
  });
  
  const childLinks = new Set(linkToJoint.keys());
  const rootLinks = new Set(Array.from(allLinks).filter(link => !childLinks.has(link)));
  
  // Build parent joint relationships
  allJoints.forEach((joint) => {
    const parentLink = joint.parentLink;
    // Find which joint has this parent link as its child link
    allJoints.forEach((otherJoint) => {
      if (otherJoint.childLink === parentLink) {
        jointToParentJoint.set(joint.jointName, otherJoint.jointName);
      }
    });
  });
  
  // Calculate depth for each joint
  const calculateDepth = (jointName: string, visited: Set<string> = new Set()): number => {
    if (visited.has(jointName)) {
      const joint = allJoints.get(jointName);
      return joint?.depth ?? 0; // Return existing depth if already visited
    }
    visited.add(jointName);
    
    const joint = allJoints.get(jointName);
    if (!joint) return 0;
    
    const parentJoint = jointToParentJoint.get(jointName);
    if (parentJoint) {
      const parentDepth = calculateDepth(parentJoint, visited);
      joint.depth = parentDepth + 1;
      joint.parentJoint = parentJoint;
      return parentDepth + 1;
    }
    joint.depth = 0;
    return 0;
  };
  
  // Calculate depths for all joints
  allJoints.forEach((joint) => {
    calculateDepth(joint.jointName);
  });
  
  // Build tree starting from root links (for backward compatibility)
  const buildTree = (linkName: string, level: number = 0, parentJointName?: string): JointHierarchyNode[] => {
    if (processedLinks.has(linkName) || level > 100) return []; // Prevent infinite loops
    processedLinks.add(linkName);
    
    const joints: JointHierarchyNode[] = [];
    
    // Find all joints that have this link as parent
    allJoints.forEach((joint) => {
      if (joint.parentLink === linkName) {
        const jointNode = { ...joint, children: [], parentJoint: parentJointName };
        // Recursively get children joints
        jointNode.children = buildTree(joint.childLink, level + 1, joint.jointName);
        joints.push(jointNode);
      }
    });
    
    return joints;
  };
  
  // Start from root links
  rootLinks.forEach(rootLink => {
    const joints = buildTree(rootLink);
    rootJoints.push(...joints);
  });
  
  // Also handle any joints that weren't connected to root links
  allJoints.forEach((joint, jointName) => {
    if (!processedLinks.has(joint.parentLink)) {
      // This joint's parent link wasn't processed, it might be a disconnected part
      const jointNode = { ...joint, children: [] };
      jointNode.children = buildTree(joint.childLink, 0);
      rootJoints.push(jointNode);
    }
  });
  
  return { rootJoints, allJoints, orderedJoints };
}

