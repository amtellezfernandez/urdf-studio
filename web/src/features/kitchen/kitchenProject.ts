import {
  KITCHEN_AXIS_BY_ROTATION_ID,
  KITCHEN_BASE_LINK_INERTIA,
  KITCHEN_BASE_LINK_NAME,
  KITCHEN_DEFAULT_ROBOT_NAME,
  KITCHEN_DESCRIPTION_SUFFIX,
  KITCHEN_FIXED_ROTATION_AXIS_ID,
  KITCHEN_MESHES_DIRECTORY,
  KITCHEN_NUMBER_DECIMAL_PLACES,
  KITCHEN_NUMBER_EPSILON,
  KITCHEN_OUTPUT_PORT_PREFIX,
  KITCHEN_OUTPUT_PORT_INDEX_OFFSET,
  KITCHEN_PART_ROOT_TAG,
  KITCHEN_POINT_NAME_INDEX_OFFSET,
  KITCHEN_PROJECT_CONNECTIONS_TAG,
  KITCHEN_PROJECT_NODES_TAG,
  KITCHEN_PROJECT_ROOT_TAG,
  KITCHEN_RGB_BYTE_MAX,
  KITCHEN_RGB_HEX_RADIX,
  KITCHEN_RGB_HEX_WIDTH,
  KITCHEN_RGB_MAX,
  KITCHEN_RGB_MIN,
  KITCHEN_STL_EXTENSION,
  KITCHEN_URDF_DEFAULT_EFFORT,
  KITCHEN_URDF_DEFAULT_VELOCITY,
  KITCHEN_URDF_REVOLUTE_LIMIT_LOWER_RAD,
  KITCHEN_URDF_REVOLUTE_LIMIT_UPPER_RAD,
  KITCHEN_VECTOR_LENGTH,
  KITCHEN_VECTOR_ZERO_VALUE,
  KITCHEN_VECTOR_X_INDEX,
  KITCHEN_VECTOR_Y_INDEX,
  KITCHEN_VECTOR_Z_INDEX,
  KITCHEN_XML_PARSE_ERROR_SELECTOR,
  KITCHEN_X_ROTATION_AXIS_ID,
  KITCHEN_Y_ROTATION_AXIS_ID,
  KITCHEN_Z_ROTATION_AXIS_ID,
} from "@/features/kitchen/kitchenParams";

export type KitchenVector3 = [number, number, number];

export type KitchenInertia = {
  ixx: number;
  ixy: number;
  ixz: number;
  iyy: number;
  iyz: number;
  izz: number;
};

export type KitchenPoint = {
  name: string;
  type: string;
  xyz: KitchenVector3;
};

export type KitchenNode = {
  name: string;
  type: string;
  stlFile: string | null;
  volume: number;
  mass: number;
  inertia: KitchenInertia;
  color: KitchenVector3;
  rotationAxis: number;
  masslessDecoration: boolean;
  points: KitchenPoint[];
};

export type KitchenConnection = {
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
};

export type KitchenProject = {
  robotName: string;
  packageName: string | null;
  meshesDirectory: string | null;
  nodes: KitchenNode[];
  connections: KitchenConnection[];
};

export type KitchenPartRecipe = {
  name: string;
  sourcePath: string;
  stlFile: string;
  mass: number;
  volume: number;
  inertia: KitchenInertia;
  color: KitchenVector3;
  rotationAxis: number;
  points: KitchenPoint[];
};

export type KitchenUrdfBuildResult = {
  robotName: string;
  urdfContent: string;
  warnings: string[];
};

const DEFAULT_VECTOR: KitchenVector3 = [0, 0, 0];
const DEFAULT_COLOR: KitchenVector3 = [1, 1, 1];

const createXmlDocument = (xml: string): XMLDocument => {
  const parser = new DOMParser();
  const document = parser.parseFromString(xml, "application/xml");
  if (document.querySelector(KITCHEN_XML_PARSE_ERROR_SELECTOR)) {
    throw new Error("Kitchen XML is not well-formed.");
  }
  return document;
};

const directChildren = (element: Element, tagName: string): Element[] =>
  Array.from(element.children).filter(
    (child) => child.tagName.toLowerCase() === tagName.toLowerCase()
  );

const directChild = (element: Element, tagName: string): Element | null =>
  directChildren(element, tagName)[0] ?? null;

const directChildText = (element: Element, tagName: string): string =>
  directChild(element, tagName)?.textContent?.trim() ?? "";

const parseNumber = (value: string | null | undefined, fallback: number): number => {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBoolean = (value: string): boolean => value.trim().toLowerCase() === "true";

const parseVector3 = (
  value: string | null | undefined,
  fallback: KitchenVector3 = DEFAULT_VECTOR
): KitchenVector3 => {
  const parts = (value ?? "")
    .trim()
    .replace(/[(),]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Number(part));
  if (parts.length < KITCHEN_VECTOR_LENGTH || parts.some((part) => !Number.isFinite(part))) {
    return [...fallback] as KitchenVector3;
  }
  return [
    parts[KITCHEN_VECTOR_X_INDEX],
    parts[KITCHEN_VECTOR_Y_INDEX],
    parts[KITCHEN_VECTOR_Z_INDEX],
  ];
};

const parseColor = (value: string | null | undefined): KitchenVector3 => {
  const parsed = parseVector3(value, DEFAULT_COLOR);
  return parsed.map((channel) =>
    Math.min(KITCHEN_RGB_MAX, Math.max(KITCHEN_RGB_MIN, channel))
  ) as KitchenVector3;
};

const parseInertiaElement = (inertiaElement: Element | null): KitchenInertia => ({
  ixx: parseNumber(inertiaElement?.getAttribute("ixx"), KITCHEN_BASE_LINK_INERTIA.ixx),
  ixy: parseNumber(inertiaElement?.getAttribute("ixy"), KITCHEN_BASE_LINK_INERTIA.ixy),
  ixz: parseNumber(inertiaElement?.getAttribute("ixz"), KITCHEN_BASE_LINK_INERTIA.ixz),
  iyy: parseNumber(inertiaElement?.getAttribute("iyy"), KITCHEN_BASE_LINK_INERTIA.iyy),
  iyz: parseNumber(inertiaElement?.getAttribute("iyz"), KITCHEN_BASE_LINK_INERTIA.iyz),
  izz: parseNumber(inertiaElement?.getAttribute("izz"), KITCHEN_BASE_LINK_INERTIA.izz),
});

const parsePointsElement = (pointsElement: Element | null): KitchenPoint[] => {
  if (!pointsElement) return [];
  return directChildren(pointsElement, "point").map((pointElement, index) => ({
    name:
      directChildText(pointElement, "name") ||
      pointElement.getAttribute("name") ||
      `point_${index + KITCHEN_POINT_NAME_INDEX_OFFSET}`,
    type: directChildText(pointElement, "type") || pointElement.getAttribute("type") || "fixed",
    xyz: parseVector3(directChildText(pointElement, "xyz") || directChildText(pointElement, "point_xyz")),
  }));
};

const resolveRotationAxisFromAxisVector = (axis: KitchenVector3): number => {
  const [x, y, z] = axis.map((value) => Math.abs(value)) as KitchenVector3;
  if (
    x === KITCHEN_VECTOR_ZERO_VALUE &&
    y === KITCHEN_VECTOR_ZERO_VALUE &&
    z === KITCHEN_VECTOR_ZERO_VALUE
  ) {
    return KITCHEN_FIXED_ROTATION_AXIS_ID;
  }
  if (z >= x && z >= y) return KITCHEN_Z_ROTATION_AXIS_ID;
  if (y >= x) return KITCHEN_Y_ROTATION_AXIS_ID;
  return KITCHEN_X_ROTATION_AXIS_ID;
};

const parseProjectNode = (nodeElement: Element): KitchenNode => {
  const name = directChildText(nodeElement, "name");
  const inertiaElement = directChild(nodeElement, "inertia");
  const color = parseColor(directChildText(nodeElement, "color"));
  return {
    name,
    type: directChildText(nodeElement, "type"),
    stlFile: directChildText(nodeElement, "stl_file") || null,
    volume: parseNumber(directChildText(nodeElement, "volume"), 0),
    mass: parseNumber(directChildText(nodeElement, "mass"), 0),
    inertia: parseInertiaElement(inertiaElement),
    color,
    rotationAxis: parseNumber(directChildText(nodeElement, "rotation_axis"), 0),
    masslessDecoration: parseBoolean(directChildText(nodeElement, "massless_decoration")),
    points: parsePointsElement(directChild(nodeElement, "points")),
  };
};

const parseProjectConnection = (connectionElement: Element): KitchenConnection | null => {
  const fromNode = directChildText(connectionElement, "from_node");
  const fromPort = directChildText(connectionElement, "from_port");
  const toNode = directChildText(connectionElement, "to_node");
  const toPort = directChildText(connectionElement, "to_port");
  if (!fromNode || !fromPort || !toNode || !toPort) return null;
  return { fromNode, fromPort, toNode, toPort };
};

export const parseKitchenProjectXml = (xml: string): KitchenProject => {
  const document = createXmlDocument(xml);
  const root = document.documentElement;
  if (root.tagName !== KITCHEN_PROJECT_ROOT_TAG) {
    throw new Error("Kitchen project XML must use a <project> root.");
  }

  const nodesElement = directChild(root, KITCHEN_PROJECT_NODES_TAG);
  const connectionsElement = directChild(root, KITCHEN_PROJECT_CONNECTIONS_TAG);
  const nodes = nodesElement ? directChildren(nodesElement, "node").map(parseProjectNode) : [];
  const connections = connectionsElement
    ? directChildren(connectionsElement, "connection")
        .map(parseProjectConnection)
        .filter((connection): connection is KitchenConnection => connection !== null)
    : [];

  return {
    robotName: sanitizeUrdfName(directChildText(root, "robot_name") || KITCHEN_DEFAULT_ROBOT_NAME),
    packageName: null,
    meshesDirectory: directChildText(root, "meshes_directory") || null,
    nodes: nodes.filter((node) => node.name.length > 0),
    connections,
  };
};

export const parseKitchenPartRecipeXml = (
  xml: string,
  sourcePath: string
): KitchenPartRecipe => {
  const document = createXmlDocument(xml);
  const root = document.documentElement;
  if (root.tagName !== KITCHEN_PART_ROOT_TAG) {
    throw new Error("Kitchen part XML must use a <urdf_part> root.");
  }
  const linkElement = directChild(root, "link");
  const linkName = linkElement?.getAttribute("name")?.trim() || deriveNameFromPath(sourcePath);
  const inertialElement = linkElement ? directChild(linkElement, "inertial") : null;
  const materialColorElement = root.querySelector("material > color");
  const axisElement = root.querySelector("joint > axis");
  return {
    name: sanitizeUrdfName(linkName),
    sourcePath,
    stlFile: replaceExtension(sourcePath, KITCHEN_STL_EXTENSION),
    mass: parseNumber(directChild(inertialElement ?? root, "mass")?.getAttribute("value"), 0),
    volume: parseNumber(directChild(inertialElement ?? root, "volume")?.getAttribute("value"), 0),
    inertia: parseInertiaElement(directChild(inertialElement ?? root, "inertia")),
    color: parseColor(materialColorElement?.getAttribute("rgba")),
    rotationAxis: resolveRotationAxisFromAxisVector(parseVector3(axisElement?.getAttribute("xyz"))),
    points: directChildren(root, "point").map((pointElement, index) => ({
      name: pointElement.getAttribute("name") || `point_${index + KITCHEN_POINT_NAME_INDEX_OFFSET}`,
      type: pointElement.getAttribute("type") || "fixed",
      xyz: parseVector3(directChildText(pointElement, "point_xyz")),
    })),
  };
};

const sanitizeUrdfName = (value: string): string => {
  const normalized = value
    .trim()
    .replace(new RegExp(`${KITCHEN_DESCRIPTION_SUFFIX}$`), "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return KITCHEN_DEFAULT_ROBOT_NAME;
  return /^[0-9]/.test(normalized) ? `m_${normalized}` : normalized;
};

const sanitizePackageName = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const fallback = `${KITCHEN_DEFAULT_ROBOT_NAME}${KITCHEN_DESCRIPTION_SUFFIX}`;
  const packageName = normalized || fallback;
  return /^[0-9]/.test(packageName) ? `m_${packageName}` : packageName;
};

const deriveNameFromPath = (path: string): string =>
  path
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/\.[^.]+$/, "") || KITCHEN_DEFAULT_ROBOT_NAME;

const replaceExtension = (path: string, extension: string): string =>
  path.replace(/\.[^.]+$/, extension);

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) < KITCHEN_NUMBER_EPSILON) return "0";
  return value.toFixed(KITCHEN_NUMBER_DECIMAL_PLACES).replace(/\.?0+$/, "");
};

const formatVector = (value: KitchenVector3): string => value.map(formatNumber).join(" ");

const colorToMaterialName = (color: KitchenVector3): string =>
  `#${color
    .map((channel) =>
      Math.round(channel * KITCHEN_RGB_BYTE_MAX)
        .toString(KITCHEN_RGB_HEX_RADIX)
        .padStart(KITCHEN_RGB_HEX_WIDTH, "0")
    )
    .join("")}`;

const escapeXmlAttribute = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const normalizeMeshPath = (meshPath: string | null): string | null => {
  if (!meshPath) return null;
  const normalized = meshPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const meshSegment = `/${KITCHEN_MESHES_DIRECTORY}/`;
  const meshIndex = normalized.toLowerCase().lastIndexOf(meshSegment);
  if (meshIndex >= 0) {
    return normalized.slice(meshIndex + 1);
  }
  if (normalized.toLowerCase().startsWith(`${KITCHEN_MESHES_DIRECTORY}/`)) {
    return normalized;
  }
  return `${KITCHEN_MESHES_DIRECTORY}/${normalized.split("/").pop() || normalized}`;
};

const packageMeshPath = (packageName: string, meshPath: string | null): string | null => {
  const normalized = normalizeMeshPath(meshPath);
  if (!normalized) return null;
  return `package://${packageName}/${normalized}`;
};

const resolvePortPoint = (node: KitchenNode, portName: string): KitchenPoint | null => {
  if (portName === "out") return node.points[0] ?? null;
  if (!portName.startsWith(KITCHEN_OUTPUT_PORT_PREFIX)) return null;
  const rawIndex = Number(portName.slice(KITCHEN_OUTPUT_PORT_PREFIX.length));
  if (!Number.isInteger(rawIndex)) return null;
  return node.points[rawIndex - KITCHEN_OUTPUT_PORT_INDEX_OFFSET] ?? null;
};

const axisForNode = (node: KitchenNode): KitchenVector3 | null => {
  if (node.rotationAxis === KITCHEN_FIXED_ROTATION_AXIS_ID) return null;
  return (
    KITCHEN_AXIS_BY_ROTATION_ID[
      node.rotationAxis as keyof typeof KITCHEN_AXIS_BY_ROTATION_ID
    ] ?? KITCHEN_AXIS_BY_ROTATION_ID[0]
  ) as KitchenVector3;
};

const writeMaterialDefinitions = (lines: string[], colors: KitchenVector3[]) => {
  const unique = new Map<string, KitchenVector3>();
  colors.forEach((color) => unique.set(colorToMaterialName(color), color));
  lines.push("  <!-- material color setting -->");
  unique.forEach((color, materialName) => {
    lines.push(`  <material name="${materialName}">`);
    lines.push(`    <color rgba="${formatVector(color)} 1"/>`);
    lines.push("  </material>");
  });
  lines.push("");
};

const writeInertial = (lines: string[], mass: number, inertia: KitchenInertia) => {
  lines.push("    <inertial>");
  lines.push('      <origin xyz="0 0 0" rpy="0 0 0"/>');
  lines.push(`      <mass value="${formatNumber(mass)}"/>`);
  lines.push(
    `      <inertia ixx="${formatNumber(inertia.ixx)}" ixy="${formatNumber(
      inertia.ixy
    )}" ixz="${formatNumber(inertia.ixz)}" iyy="${formatNumber(
      inertia.iyy
    )}" iyz="${formatNumber(inertia.iyz)}" izz="${formatNumber(inertia.izz)}"/>`
  );
  lines.push("    </inertial>");
};

const writeVisual = (
  lines: string[],
  packageName: string,
  meshPath: string | null,
  color: KitchenVector3,
  origin: KitchenVector3 = DEFAULT_VECTOR
) => {
  const packagePath = packageMeshPath(packageName, meshPath);
  if (!packagePath) return;
  lines.push("    <visual>");
  lines.push(`      <origin xyz="${formatVector(origin)}" rpy="0 0 0"/>`);
  lines.push("      <geometry>");
  lines.push(`        <mesh filename="${escapeXmlAttribute(packagePath)}"/>`);
  lines.push("      </geometry>");
  lines.push(`      <material name="${colorToMaterialName(color)}"/>`);
  lines.push("    </visual>");
};

const writeCollision = (
  lines: string[],
  packageName: string,
  meshPath: string | null
) => {
  const packagePath = packageMeshPath(packageName, meshPath);
  if (!packagePath) return;
  lines.push("    <collision>");
  lines.push('      <origin xyz="0 0 0" rpy="0 0 0"/>');
  lines.push("      <geometry>");
  lines.push(`        <mesh filename="${escapeXmlAttribute(packagePath)}"/>`);
  lines.push("      </geometry>");
  lines.push("    </collision>");
};

const writeLink = (
  lines: string[],
  packageName: string,
  node: KitchenNode,
  decorationChildren: Array<{ node: KitchenNode; origin: KitchenVector3 }>
) => {
  lines.push(`  <link name="${escapeXmlAttribute(node.name)}">`);
  writeInertial(lines, node.mass, node.inertia);
  writeVisual(lines, packageName, node.stlFile, node.color);
  decorationChildren.forEach((decoration) => {
    writeVisual(lines, packageName, decoration.node.stlFile, decoration.node.color, decoration.origin);
  });
  writeCollision(lines, packageName, node.stlFile);
  lines.push("  </link>");
};

const writeJoint = (
  lines: string[],
  parent: KitchenNode,
  child: KitchenNode,
  origin: KitchenVector3
) => {
  const axis = axisForNode(child);
  const jointType = axis ? "revolute" : "fixed";
  lines.push(`  <joint name="${escapeXmlAttribute(`${parent.name}_to_${child.name}`)}" type="${jointType}">`);
  lines.push(`    <origin xyz="${formatVector(origin)}" rpy="0 0 0"/>`);
  if (axis) {
    lines.push(`    <axis xyz="${formatVector(axis)}"/>`);
  }
  lines.push(`    <parent link="${escapeXmlAttribute(parent.name)}"/>`);
  lines.push(`    <child link="${escapeXmlAttribute(child.name)}"/>`);
  if (axis) {
    lines.push(
      `    <limit lower="${formatNumber(
        KITCHEN_URDF_REVOLUTE_LIMIT_LOWER_RAD
      )}" upper="${formatNumber(KITCHEN_URDF_REVOLUTE_LIMIT_UPPER_RAD)}" effort="${formatNumber(
        KITCHEN_URDF_DEFAULT_EFFORT
      )}" velocity="${formatNumber(KITCHEN_URDF_DEFAULT_VELOCITY)}"/>`
    );
  }
  lines.push("  </joint>");
};

export const buildKitchenUrdfFromProject = (project: KitchenProject): KitchenUrdfBuildResult => {
  const robotName = sanitizeUrdfName(project.robotName);
  const packageName = sanitizePackageName(
    project.packageName || `${robotName}${KITCHEN_DESCRIPTION_SUFFIX}`
  );
  const warnings: string[] = [];
  const nodesByName = new Map(project.nodes.map((node) => [node.name, node] as const));
  const childConnections = new Map<string, Array<KitchenConnection & { child: KitchenNode }>>();
  const incomingNodeNames = new Set<string>();

  project.connections.forEach((connection) => {
    const parent = nodesByName.get(connection.fromNode);
    const child = nodesByName.get(connection.toNode);
    if (!parent || !child) {
      warnings.push(`Skipped connection with missing node: ${connection.fromNode} -> ${connection.toNode}.`);
      return;
    }
    const bucket = childConnections.get(parent.name) ?? [];
    bucket.push({ ...connection, child });
    childConnections.set(parent.name, bucket);
    incomingNodeNames.add(child.name);
  });

  const rootNode =
    nodesByName.get(KITCHEN_BASE_LINK_NAME) ??
    project.nodes.find((node) => !incomingNodeNames.has(node.name) && !node.masslessDecoration) ??
    project.nodes.find((node) => !node.masslessDecoration);
  if (!rootNode) {
    throw new Error("Kitchen project has no link node to export.");
  }

  const lines = [`<?xml version="1.0"?>`, `<robot name="${escapeXmlAttribute(robotName)}">`, ""];
  writeMaterialDefinitions(lines, project.nodes.map((node) => node.color));
  const visited = new Set<string>();

  const writeSubtree = (node: KitchenNode) => {
    if (visited.has(node.name)) return;
    visited.add(node.name);
    const childEdges = childConnections.get(node.name) ?? [];
    const decorations = childEdges
      .filter((edge) => edge.child.masslessDecoration)
      .map((edge) => ({
        node: edge.child,
        origin: resolvePortPoint(node, edge.fromPort)?.xyz ?? DEFAULT_VECTOR,
      }));
    writeLink(lines, packageName, node, decorations);
    lines.push("");

    childEdges
      .filter((edge) => !edge.child.masslessDecoration)
      .forEach((edge) => {
        writeJoint(lines, node, edge.child, resolvePortPoint(node, edge.fromPort)?.xyz ?? DEFAULT_VECTOR);
        lines.push("");
        writeSubtree(edge.child);
      });
  };

  writeSubtree(rootNode);
  project.nodes
    .filter((node) => !node.masslessDecoration && !visited.has(node.name))
    .forEach((node) => {
      warnings.push(`Attached orphan Kitchen node "${node.name}" to ${rootNode.name}.`);
      writeJoint(lines, rootNode, node, DEFAULT_VECTOR);
      lines.push("");
      writeSubtree(node);
    });

  lines.push("</robot>");
  return {
    robotName,
    urdfContent: lines.join("\n"),
    warnings,
  };
};

export const buildKitchenUrdfFromPartCatalog = (
  robotNameHint: string,
  parts: KitchenPartRecipe[],
  options?: { packageName?: string | null }
): KitchenUrdfBuildResult => {
  const robotName = sanitizeUrdfName(robotNameHint);
  const baseNode: KitchenNode = {
    name: KITCHEN_BASE_LINK_NAME,
    type: "BaseLinkNode",
    stlFile: null,
    volume: 0,
    mass: 0,
    inertia: { ...KITCHEN_BASE_LINK_INERTIA },
    color: DEFAULT_COLOR,
    rotationAxis: KITCHEN_FIXED_ROTATION_AXIS_ID,
    masslessDecoration: false,
    points: [],
  };
  const project: KitchenProject = {
    robotName,
    packageName: options?.packageName ?? `${robotName}${KITCHEN_DESCRIPTION_SUFFIX}`,
    meshesDirectory: KITCHEN_MESHES_DIRECTORY,
    nodes: [
      baseNode,
      ...parts.map((part): KitchenNode => ({
        name: part.name,
        type: "FooNode",
        stlFile: part.stlFile,
        volume: part.volume,
        mass: part.mass,
        inertia: part.inertia,
        color: part.color,
        rotationAxis: KITCHEN_FIXED_ROTATION_AXIS_ID,
        masslessDecoration: false,
        points: part.points,
      })),
    ],
    connections: parts.map((part) => ({
      fromNode: KITCHEN_BASE_LINK_NAME,
      fromPort: "out",
      toNode: part.name,
      toPort: "in",
    })),
  };
  const result = buildKitchenUrdfFromProject(project);
  return {
    ...result,
    warnings: [
      "No Kitchen project graph was found; generated a fixed part catalog from urdf_part XML files.",
      ...result.warnings,
    ],
  };
};
