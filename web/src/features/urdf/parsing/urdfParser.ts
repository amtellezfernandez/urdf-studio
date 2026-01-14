/**
 * Robust URDF XML Parser Utility
 * 
 * This module provides a centralized, robust way to parse URDF XML content
 * using the browser's DOMParser. All URDF parsing should go through this utility
 * to ensure consistent error handling and validation.
 */

interface ParsedURDF {
  document: Document;
  isValid: boolean;
  error?: string;
}

/**
 * Parses URDF XML content using DOMParser
 * @param urdfContent URDF XML content as string
 * @returns Parsed document with validation status
 */
export function parseURDF(urdfContent: string): ParsedURDF {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(urdfContent, "text/xml");
    
    // Check for parsing errors
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      const errorText = parserError.textContent || "Unknown XML parsing error";
      console.error("URDF parsing error:", errorText);
      return {
        document: xmlDoc,
        isValid: false,
        error: errorText,
      };
    }
    
    // Validate that we have a robot element
    const robot = xmlDoc.querySelector("robot");
    if (!robot) {
      const error = "No <robot> element found in URDF";
      console.error(error);
      return {
        document: xmlDoc,
        isValid: false,
        error,
      };
    }
    
    return {
      document: xmlDoc,
      isValid: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error parsing URDF:", errorMessage);
    // Return a minimal document structure even on error
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString("<robot></robot>", "text/xml");
    return {
      document: xmlDoc,
      isValid: false,
      error: errorMessage,
    };
  }
}

/**
 * Serializes a parsed URDF document back to XML string
 * @param document Parsed XML document
 * @returns XML string representation
 */
export function serializeURDF(document: Document): string {
  const serializer = new XMLSerializer();
  return serializer.serializeToString(document);
}

/**
 * Helper function to safely parse URDF and execute a callback with the parsed document
 * @param urdfContent URDF XML content as string
 * @param callback Function to execute with parsed document
 * @param fallback Fallback value if parsing fails
 * @returns Result of callback or fallback
 */

