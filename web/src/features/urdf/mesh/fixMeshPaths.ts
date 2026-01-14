/**
 * Mesh Path Fixing Utility for URDF
 *
 * Detects and fixes common issues with mesh file paths:
 * - Absolute paths (/home/user/.../mesh.stl)
 * - Windows-style paths (meshes\part.stl)
 * - Paths with unnecessary .. segments
 * - Non-standard package paths
 *
 * Normalizes to standard ROS package:// format
 */

import { parseURDF, serializeURDF } from "../parsing/urdfParser";

interface PathFixResult {
  urdfContent: string;
  corrections: PathCorrection[];
  packageName: string;
}

interface PathCorrection {
  element: string; // "visual" or "collision"
  linkName: string;
  original: string;
  corrected: string;
  reason: string;
}

/**
 * Normalizes a file path by resolving .. segments and converting backslashes
 */
function normalizePath(path: string): string {
  // Convert Windows backslashes to forward slashes
  let normalized = path.replace(/\\/g, "/");

  // Remove duplicate slashes
  normalized = normalized.replace(/\/+/g, "/");

  // Resolve .. segments
  const parts = normalized.split("/");
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === "..") {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== "..") {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    } else if (part !== "." && part !== "") {
      resolved.push(part);
    }
  }

  return resolved.join("/");
}

/**
 * Extracts the filename from a path
 */
function getFilename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1];
}

/**
 * Determines if a path is absolute
 */
function isAbsolutePath(path: string): boolean {
  // Unix absolute path
  if (path.startsWith("/")) return true;
  // Windows absolute path (C:\, D:\, etc.)
  if (/^[A-Za-z]:[\\/]/.test(path)) return true;
  return false;
}

/**
 * Determines if a path is already a ROS package path
 */
function isPackagePath(path: string): boolean {
  return path.startsWith("package://");
}

/**
 * Extracts package name from a package:// path
 */
function extractPackageName(path: string): string | null {
  const match = path.match(/^package:\/\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Detects common mesh folder patterns
 */
function detectMeshFolder(path: string): string {
  const normalized = path.toLowerCase();

  // Common mesh folder patterns
  const patterns = ["meshes/", "mesh/", "visual/", "visuals/", "collision/", "collisions/", "models/", "assets/"];

  for (const pattern of patterns) {
    const index = normalized.indexOf(pattern);
    if (index !== -1) {
      // Return from the mesh folder onwards
      return path.substring(index);
    }
  }

  // If no common folder found, just return the filename
  return getFilename(path);
}

/**
 * Fixes mesh paths in a URDF to use proper package:// format
 *
 * @param urdfContent - URDF XML content as string
 * @param packageName - Optional package name to use (auto-detected if not provided)
 * @returns Result with corrected URDF and list of corrections
 */
export function fixMeshPaths(urdfContent: string, packageName?: string): PathFixResult {
  const parsed = parseURDF(urdfContent);

  const result: PathFixResult = {
    urdfContent: urdfContent,
    corrections: [],
    packageName: packageName || "",
  };

  if (!parsed.isValid) {
    return result;
  }

  const robot = parsed.document.querySelector("robot");
  if (!robot) {
    return result;
  }

  // Auto-detect package name from robot name if not provided
  if (!packageName) {
    const robotName = robot.getAttribute("name") || "robot";
    // Common convention: robot name without spaces, lowercase, with _description suffix
    packageName = robotName.toLowerCase().replace(/\s+/g, "_");
    if (!packageName.endsWith("_description")) {
      packageName += "_description";
    }
    result.packageName = packageName;
  }

  // Find all mesh elements
  const meshElements = robot.querySelectorAll("mesh");

  for (const mesh of meshElements) {
    const filename = mesh.getAttribute("filename");
    if (!filename) continue;

    let correctedPath = filename;
    let reason = "";
    let needsCorrection = false;

    // Get context (link name, visual/collision)
    const linkElement = mesh.closest("link");
    const linkName = linkElement?.getAttribute("name") || "unknown";
    const visualElement = mesh.closest("visual");
    const collisionElement = mesh.closest("collision");
    const elementType = visualElement ? "visual" : collisionElement ? "collision" : "unknown";

    // Check for issues and fix
    if (isAbsolutePath(filename)) {
      // Absolute path - extract mesh folder and filename
      const meshPart = detectMeshFolder(filename);
      correctedPath = `package://${packageName}/${meshPart}`;
      reason = "Converted absolute path to package:// format";
      needsCorrection = true;
    } else if (filename.includes("\\")) {
      // Windows-style path
      const normalized = normalizePath(filename);
      if (isPackagePath(filename)) {
        correctedPath = filename.replace(/\\/g, "/");
      } else {
        const meshPart = detectMeshFolder(normalized);
        correctedPath = `package://${packageName}/${meshPart}`;
      }
      reason = "Fixed Windows-style backslashes";
      needsCorrection = true;
    } else if (filename.includes("/../") || filename.includes("/./")) {
      // Path with unnecessary segments
      if (isPackagePath(filename)) {
        const packageMatch = filename.match(/^(package:\/\/[^/]+)(.*)/);
        if (packageMatch) {
          const basePath = packageMatch[1];
          const restPath = normalizePath(packageMatch[2]);
          correctedPath = basePath + "/" + restPath;
        }
      } else {
        const normalized = normalizePath(filename);
        const meshPart = detectMeshFolder(normalized);
        correctedPath = `package://${packageName}/${meshPart}`;
      }
      reason = "Normalized path segments (removed .. and .)";
      needsCorrection = true;
    } else if (!isPackagePath(filename)) {
      // Relative path without package:// prefix
      const normalized = normalizePath(filename);
      const meshPart = detectMeshFolder(normalized);
      correctedPath = `package://${packageName}/${meshPart}`;
      reason = "Added package:// prefix to relative path";
      needsCorrection = true;
    } else if (isPackagePath(filename)) {
      // Already a package path, but check for issues
      const normalized = filename.replace(/\/+/g, "/");
      if (normalized !== filename) {
        correctedPath = normalized;
        reason = "Removed duplicate slashes";
        needsCorrection = true;
      }
    }

    if (needsCorrection && correctedPath !== filename) {
      mesh.setAttribute("filename", correctedPath);

      result.corrections.push({
        element: elementType,
        linkName,
        original: filename,
        corrected: correctedPath,
        reason,
      });
    }
  }

  result.urdfContent = serializeURDF(parsed.document);
  return result;
}

/**
 * Simple wrapper that just returns the corrected URDF string
 *
 * @param urdfContent - URDF XML content as string
 * @param packageName - Optional package name to use
 * @returns Corrected URDF content
 */
