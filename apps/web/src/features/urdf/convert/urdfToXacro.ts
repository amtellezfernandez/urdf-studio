/**
 * URDF to Xacro Converter
 *
 * Automatically converts static URDF to parametric Xacro format by:
 * - Detecting repeated values and creating properties
 * - Identifying repeated structures and generating macros
 * - Substituting values with ${...} expressions
 */

import { parseURDF, serializeURDF } from "../parsing/urdfParser";

// ============================================================================
// MODULE A: AST Parser and Tree Structure
// ============================================================================

interface XacroNode {
  tag: string;
  attributes: Record<string, string>;
  children: XacroNode[];
  text: string;
  parent: XacroNode | null;
  element: Element;
}

interface XacroProperty {
  name: string;
  value: string;
  count: number;
  contexts: string[];
}

interface XacroMacro {
  name: string;
  params: string[];
  template: string;
  instances: MacroInstance[];
}

interface MacroInstance {
  originalElement: Element;
  paramValues: Record<string, string>;
}

interface ConversionResult {
  xacroContent: string;
  properties: XacroProperty[];
  macros: XacroMacro[];
  stats: {
    propertiesGenerated: number;
    macrosGenerated: number;
    valuesParameterized: number;
  };
}

/**
 * Builds an AST from XML Element
 */
function buildAST(element: Element, parent: XacroNode | null = null): XacroNode {
  const attributes: Record<string, string> = {};
  for (const attr of element.attributes) {
    attributes[attr.name] = attr.value;
  }

  const node: XacroNode = {
    tag: element.tagName,
    attributes,
    children: [],
    text: "",
    parent,
    element,
  };

  // Get direct text content (not from children)
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim() || "";
      if (text) node.text += text;
    }
  }

  // Build children recursively
  for (const child of element.children) {
    node.children.push(buildAST(child, node));
  }

  return node;
}

// ============================================================================
// MODULE B: Pattern Detection
// ============================================================================

interface NumberOccurrence {
  value: number;
  stringValue: string;
  context: string;
  path: string;
  attributeName: string;
  element: Element;
}

/**
 * Extracts all numeric values from the AST
 */
function extractAllNumbers(node: XacroNode, path: string = ""): NumberOccurrence[] {
  const occurrences: NumberOccurrence[] = [];
  const currentPath = path ? `${path}/${node.tag}` : node.tag;

  // Extract numbers from attributes
  for (const [attrName, attrValue] of Object.entries(node.attributes)) {
    const numbers = extractNumbersFromString(attrValue);
    for (const num of numbers) {
      occurrences.push({
        value: num.value,
        stringValue: num.stringValue,
        context: inferContext(node.tag, attrName, num.position),
        path: currentPath,
        attributeName: attrName,
        element: node.element,
      });
    }
  }

  // Recursively process children
  for (const child of node.children) {
    occurrences.push(...extractAllNumbers(child, currentPath));
  }

  return occurrences;
}

interface ExtractedNumber {
  value: number;
  stringValue: string;
  position: number;
}

/**
 * Extracts numbers from a string (handles space-separated values like "0.3 0.05 0.05")
 */
function extractNumbersFromString(str: string): ExtractedNumber[] {
  const numbers: ExtractedNumber[] = [];
  const regex = /-?\d+\.?\d*(?:[eE][-+]?\d+)?/g;
  let match;
  let position = 0;

  while ((match = regex.exec(str)) !== null) {
    const value = parseFloat(match[0]);
    if (!isNaN(value)) {
      numbers.push({
        value,
        stringValue: match[0],
        position: position++,
      });
    }
  }

  return numbers;
}

/**
 * Infers a semantic name based on context
 */
function inferContext(tag: string, attrName: string, position: number): string {
  // Box size: x y z -> length, width, height
  if (tag === "box" && attrName === "size") {
    const names = ["length", "width", "height"];
    return names[position] || "dimension";
  }

  // Cylinder
  if (tag === "cylinder") {
    if (attrName === "radius") return "radius";
    if (attrName === "length") return "length";
  }

  // Sphere
  if (tag === "sphere" && attrName === "radius") {
    return "radius";
  }

  // Origin xyz -> offset_x, offset_y, offset_z
  if (tag === "origin" && attrName === "xyz") {
    const names = ["offset_x", "offset_y", "offset_z"];
    return names[position] || "offset";
  }

  // Origin rpy -> roll, pitch, yaw
  if (tag === "origin" && attrName === "rpy") {
    const names = ["roll", "pitch", "yaw"];
    return names[position] || "rotation";
  }

  // Axis
  if (tag === "axis" && attrName === "xyz") {
    const names = ["axis_x", "axis_y", "axis_z"];
    return names[position] || "axis";
  }

  // Mass
  if (tag === "mass" && attrName === "value") {
    return "mass";
  }

  // Inertia
  if (tag === "inertia") {
    return `inertia_${attrName}`;
  }

  // Joint limits
  if (tag === "limit") {
    if (attrName === "lower") return "joint_lower_limit";
    if (attrName === "upper") return "joint_upper_limit";
    if (attrName === "effort") return "joint_effort";
    if (attrName === "velocity") return "joint_velocity";
  }

  // Generic fallback
  return `${tag}_${attrName}_${position}`;
}

/**
 * Groups numbers by value and counts occurrences
 */
function groupNumbersByValue(occurrences: NumberOccurrence[]): Map<string, NumberOccurrence[]> {
  const groups = new Map<string, NumberOccurrence[]>();

  for (const occ of occurrences) {
    // Use string value to avoid floating point comparison issues
    const key = occ.value.toString();
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(occ);
  }

  return groups;
}

// ============================================================================
// MODULE C: Property Generation
// ============================================================================

/**
 * Generates Xacro properties from repeated values
 */
function generateProperties(
  numberGroups: Map<string, NumberOccurrence[]>,
  threshold: number = 2
): XacroProperty[] {
  const properties: XacroProperty[] = [];
  const usedNames = new Set<string>();

  for (const [value, occurrences] of numberGroups) {
    if (occurrences.length >= threshold) {
      // Determine the best name based on contexts
      const contextCounts = new Map<string, number>();
      for (const occ of occurrences) {
        const count = contextCounts.get(occ.context) || 0;
        contextCounts.set(occ.context, count + 1);
      }

      // Find most common context
      let bestContext = "param";
      let maxCount = 0;
      for (const [context, count] of contextCounts) {
        if (count > maxCount) {
          maxCount = count;
          bestContext = context;
        }
      }

      // Ensure unique name
      let name = bestContext;
      let counter = 1;
      while (usedNames.has(name)) {
        name = `${bestContext}_${counter++}`;
      }
      usedNames.add(name);

      properties.push({
        name,
        value,
        count: occurrences.length,
        contexts: [...new Set(occurrences.map((o) => o.context))],
      });
    }
  }

  // Sort by count (most used first)
  properties.sort((a, b) => b.count - a.count);

  return properties;
}

// ============================================================================
// MODULE D: Value Substitution
// ============================================================================

/**
 * Substitutes numeric values with Xacro property references
 */
function substituteValues(
  xmlDoc: Document,
  properties: XacroProperty[]
): { doc: Document; substitutionCount: number } {
  let substitutionCount = 0;

  // Create a map of value -> property name
  const valueToProperty = new Map<string, string>();
  for (const prop of properties) {
    valueToProperty.set(prop.value, prop.name);
  }

  // Process all elements
  const allElements = xmlDoc.querySelectorAll("*");
  for (const element of allElements) {
    // Process attributes
    for (const attr of element.attributes) {
      let newValue = attr.value;
      let modified = false;

      // Replace each number with property reference if it exists
      const numbers = extractNumbersFromString(attr.value);
      // Sort by position descending to replace from end to start (avoid offset issues)
      numbers.sort((a, b) => b.stringValue.length - a.stringValue.length);

      for (const num of numbers) {
        const propName = valueToProperty.get(num.value.toString());
        if (propName) {
          // Replace with ${property_name}
          newValue = replaceValue(newValue, num.stringValue, `\${${propName}}`);
          modified = true;
          substitutionCount++;
        }
      }

      if (modified) {
        attr.value = newValue;
      }
    }
  }

  return { doc: xmlDoc, substitutionCount };
}

/**
 * Replaces a specific numeric value in a string with a property reference
 */
function replaceValue(str: string, oldValue: string, newValue: string): string {
  // Replace only the first occurrence to maintain correspondence
  return str.replace(oldValue, newValue);
}

// ============================================================================
// MODULE E: Macro Generation
// ============================================================================

interface StructuralHash {
  hash: string;
  element: Element;
  node: XacroNode;
}

/**
 * Computes a structural hash of an element (ignoring specific attribute values)
 */
function computeStructuralHash(node: XacroNode): string {
  const parts: string[] = [node.tag];

  // Add attribute names (not values) to hash
  const attrNames = Object.keys(node.attributes).sort();
  parts.push(attrNames.join(","));

  // Add children hashes recursively
  for (const child of node.children) {
    parts.push(computeStructuralHash(child));
  }

  return parts.join("|");
}

/**
 * Detects repeated subtrees that could become macros
 */
function detectRepeatedSubtrees(rootNode: XacroNode): Map<string, XacroNode[]> {
  const hashToNodes = new Map<string, XacroNode[]>();

  function traverse(node: XacroNode) {
    // Only consider link and joint elements for macro generation
    if (node.tag === "link" || node.tag === "joint") {
      const hash = computeStructuralHash(node);
      if (!hashToNodes.has(hash)) {
        hashToNodes.set(hash, []);
      }
      hashToNodes.get(hash)!.push(node);
    }

    // Continue traversing children
    for (const child of node.children) {
      traverse(child);
    }
  }

  traverse(rootNode);

  // Filter to only include groups with 2+ nodes
  const repeated = new Map<string, XacroNode[]>();
  for (const [hash, nodes] of hashToNodes) {
    if (nodes.length >= 2) {
      repeated.set(hash, nodes);
    }
  }

  return repeated;
}

/**
 * Generates macros from repeated structures
 */
function generateMacros(repeatedGroups: Map<string, XacroNode[]>): XacroMacro[] {
  const macros: XacroMacro[] = [];
  const usedNames = new Set<string>();

  for (const [_hash, nodes] of repeatedGroups) {
    if (nodes.length < 2) continue;

    const firstNode = nodes[0];
    const tag = firstNode.tag;

    // Generate macro name
    let macroName = `${tag}_macro`;
    let counter = 1;
    while (usedNames.has(macroName)) {
      macroName = `${tag}_macro_${counter++}`;
    }
    usedNames.add(macroName);

    // Determine parameters (attributes that differ between instances)
    const params = new Set<string>(["name"]); // name is always a parameter

    // Compare attributes across all instances
    const allAttrNames = new Set<string>();
    for (const node of nodes) {
      for (const attrName of Object.keys(node.attributes)) {
        allAttrNames.add(attrName);
      }
    }

    for (const attrName of allAttrNames) {
      const values = new Set<string>();
      for (const node of nodes) {
        values.add(node.attributes[attrName] || "");
      }
      if (values.size > 1) {
        params.add(attrName);
      }
    }

    // Create template (using first instance as base)
    const template = createMacroTemplate(firstNode, params);

    // Create instances
    const instances: MacroInstance[] = nodes.map((node) => ({
      originalElement: node.element,
      paramValues: extractParamValues(node, params),
    }));

    macros.push({
      name: macroName,
      params: Array.from(params),
      template,
      instances,
    });
  }

  return macros;
}

/**
 * Creates a macro template from a node
 */
function createMacroTemplate(node: XacroNode, params: Set<string>): string {
  const lines: string[] = [];
  const indent = "    ";

  function renderNode(n: XacroNode, depth: number): string {
    const pad = indent.repeat(depth);
    let result = `${pad}<${n.tag}`;

    // Add attributes (parameterize those in params set)
    for (const [attrName, attrValue] of Object.entries(n.attributes)) {
      if (params.has(attrName)) {
        result += ` ${attrName}="\${${attrName}}"`;
      } else {
        result += ` ${attrName}="${attrValue}"`;
      }
    }

    if (n.children.length === 0 && !n.text) {
      result += "/>";
    } else {
      result += ">";
      if (n.text) {
        result += n.text;
      }
      if (n.children.length > 0) {
        result += "\n";
        for (const child of n.children) {
          result += renderNode(child, depth + 1) + "\n";
        }
        result += `${pad}</${n.tag}>`;
      } else {
        result += `</${n.tag}>`;
      }
    }

    return result;
  }

  return renderNode(node, 0);
}

/**
 * Extracts parameter values from a node
 */
function extractParamValues(node: XacroNode, params: Set<string>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const param of params) {
    if (node.attributes[param] !== undefined) {
      values[param] = node.attributes[param];
    }
  }
  return values;
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Converts URDF to Xacro format
 */
export function convertURDFToXacro(urdfContent: string): ConversionResult {
  const parsed = parseURDF(urdfContent);

  if (!parsed.isValid) {
    return {
      xacroContent: urdfContent,
      properties: [],
      macros: [],
      stats: {
        propertiesGenerated: 0,
        macrosGenerated: 0,
        valuesParameterized: 0,
      },
    };
  }

  const robot = parsed.document.querySelector("robot");
  if (!robot) {
    return {
      xacroContent: urdfContent,
      properties: [],
      macros: [],
      stats: {
        propertiesGenerated: 0,
        macrosGenerated: 0,
        valuesParameterized: 0,
      },
    };
  }

  // MODULE A: Build AST
  const ast = buildAST(robot);

  // MODULE B: Extract and group numbers
  const numberOccurrences = extractAllNumbers(ast);
  const numberGroups = groupNumbersByValue(numberOccurrences);

  // MODULE C: Generate properties (threshold based on robot size)
  const totalElements = robot.querySelectorAll("*").length;
  const threshold = totalElements > 100 ? 3 : 2;
  const properties = generateProperties(numberGroups, threshold);

  // MODULE D: Substitute values
  const { substitutionCount } = substituteValues(parsed.document, properties);

  // MODULE E: Detect and generate macros (rebuild AST after substitution)
  const updatedAst = buildAST(robot);
  const repeatedSubtrees = detectRepeatedSubtrees(updatedAst);
  const macros = generateMacros(repeatedSubtrees);

  // Generate final Xacro output
  const xacroContent = generateXacroOutput(parsed.document, properties, macros);

  return {
    xacroContent,
    properties,
    macros,
    stats: {
      propertiesGenerated: properties.length,
      macrosGenerated: macros.length,
      valuesParameterized: substitutionCount,
    },
  };
}

/**
 * Generates the final Xacro XML output
 */
function generateXacroOutput(
  doc: Document,
  properties: XacroProperty[],
  macros: XacroMacro[]
): string {
  const robot = doc.querySelector("robot");
  if (!robot) return serializeURDF(doc);

  // Add Xacro namespace
  robot.setAttribute("xmlns:xacro", "http://ros.org/wiki/xacro");

  // Create property declarations
  const propertyElements: string[] = [];
  for (const prop of properties) {
    propertyElements.push(`  <xacro:property name="${prop.name}" value="${prop.value}"/>`);
  }

  // Create macro definitions
  const macroDefinitions: string[] = [];
  for (const macro of macros) {
    const paramsStr = macro.params.join(" ");
    macroDefinitions.push(`  <xacro:macro name="${macro.name}" params="${paramsStr}">`);
    // Indent the template
    const templateLines = macro.template.split("\n");
    for (const line of templateLines) {
      macroDefinitions.push(`    ${line}`);
    }
    macroDefinitions.push(`  </xacro:macro>`);
    macroDefinitions.push("");
  }

  // Generate macro invocations
  const macroInvocations: string[] = [];
  for (const macro of macros) {
    for (const instance of macro.instances) {
      let invocation = `  <xacro:${macro.name}`;
      for (const param of macro.params) {
        const value = instance.paramValues[param] || "";
        invocation += ` ${param}="${value}"`;
      }
      invocation += "/>";
      macroInvocations.push(invocation);

      // Mark original element for removal
      instance.originalElement.setAttribute("__xacro_remove__", "true");
    }
  }

  // Serialize the modified document
  let serialized = serializeURDF(doc);

  // Remove elements that were converted to macros
  const elementsToRemove = doc.querySelectorAll('[__xacro_remove__="true"]');
  for (const el of elementsToRemove) {
    el.parentNode?.removeChild(el);
  }

  // Re-serialize after removal
  serialized = serializeURDF(doc);

  // Insert properties and macros after <robot> opening tag
  const robotMatch = serialized.match(/(<robot[^>]*>)/);
  if (robotMatch) {
    const robotTag = robotMatch[1];
    const insertPosition = serialized.indexOf(robotTag) + robotTag.length;

    let insertion = "\n\n  <!-- Xacro Properties -->\n";
    insertion += propertyElements.join("\n");
    insertion += "\n";

    if (macroDefinitions.length > 0) {
      insertion += "\n  <!-- Xacro Macros -->\n";
      insertion += macroDefinitions.join("\n");
    }

    if (macroInvocations.length > 0) {
      insertion += "\n  <!-- Macro Invocations -->\n";
      insertion += macroInvocations.join("\n");
      insertion += "\n";
    }

    serialized = serialized.slice(0, insertPosition) + insertion + serialized.slice(insertPosition);
  }

  // Add XML declaration with xacro info
  if (!serialized.startsWith("<?xml")) {
    serialized = '<?xml version="1.0"?>\n' + serialized;
  }

  // Pretty print the result
  return formatXacroOutput(serialized);
}

/**
 * Formats Xacro output with proper indentation
 */
function formatXacroOutput(xml: string): string {
  // Remove existing whitespace between tags
  const formatted = xml.replace(/>\s+</g, ">\n<");

  // Split into lines
  const lines = formatted.split("\n");
  const result: string[] = [];
  let indentLevel = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Decrease indent for closing tags
    if (trimmed.startsWith("</") || trimmed.startsWith("-->")) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    // Add indented line
    result.push("  ".repeat(indentLevel) + trimmed);

    // Increase indent for opening tags (not self-closing or comments)
    if (
      trimmed.startsWith("<") &&
      !trimmed.startsWith("</") &&
      !trimmed.startsWith("<?") &&
      !trimmed.startsWith("<!--") &&
      !trimmed.endsWith("/>") &&
      !trimmed.endsWith("-->")
    ) {
      indentLevel++;
    }

    // Handle self-closing but multi-line xacro tags
    if (trimmed.startsWith("<xacro:") && trimmed.endsWith("/>")) {
      // Don't change indent
    }
  }

  return result.join("\n");
}
