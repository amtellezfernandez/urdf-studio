/**
 * Pretty Print Utility for URDF
 *
 * Formats URDF XML with consistent indentation and clean structure.
 * Converts messy or minified XML into human-readable format.
 */

import { parseURDF, serializeURDF } from "../parsing/urdfParser";

/**
 * Formats an XML string with proper indentation
 *
 * @param xmlString - XML string to format
 * @param indentSize - Number of spaces for each indent level (default: 2)
 * @returns Formatted XML string with consistent indentation
 */
function formatXML(xmlString: string, indentSize: number = 2): string {
  // Remove existing whitespace between tags
  let formatted = xmlString.replace(/>\s*</g, "><");

  // Add newlines between tags
  formatted = formatted.replace(/></g, ">\n<");

  // Split into lines for processing
  const lines = formatted.split("\n");
  let indentLevel = 0;
  const result: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Check if this is a closing tag
    const isClosingTag = /^<\//.test(trimmedLine);
    // Check if this is a self-closing tag
    const isSelfClosing = /\/>$/.test(trimmedLine);
    // Check if this is an opening tag (not closing or self-closing)
    const isOpeningTag = /^<[^/!?]/.test(trimmedLine) && !isSelfClosing;
    // Check if this line has both opening and closing tags (inline element)
    const hasInlineClose = /^<[^/].*<\//.test(trimmedLine);

    // Decrease indent for closing tags
    if (isClosingTag && indentLevel > 0) {
      indentLevel--;
    }

    // Add the indented line
    const indent = " ".repeat(indentLevel * indentSize);
    result.push(indent + trimmedLine);

    // Increase indent for opening tags (unless inline or self-closing)
    if (isOpeningTag && !hasInlineClose) {
      indentLevel++;
    }
  }

  return result.join("\n");
}

/**
 * Pretty prints URDF content with consistent indentation
 *
 * @param urdfContent - URDF XML content as string
 * @param indentSize - Number of spaces for each indent level (default: 2)
 * @returns Formatted URDF with proper indentation
 */
export function prettyPrintURDF(urdfContent: string, indentSize: number = 2): string {
  const parsed = parseURDF(urdfContent);

  if (!parsed.isValid) {
    console.error("Cannot pretty print: Invalid URDF");
    return urdfContent;
  }

  // Serialize the document first
  const serialized = serializeURDF(parsed.document);

  // Apply formatting
  const formatted = formatXML(serialized, indentSize);

  // Add XML declaration if not present
  if (!formatted.startsWith("<?xml")) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + formatted;
  }

  return formatted;
}
