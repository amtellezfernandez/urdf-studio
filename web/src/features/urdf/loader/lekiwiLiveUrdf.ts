import type { MeshFiles } from "@/shared/types/feature";
import { normalizeMeshPathForMatch, parseURDF } from "@/shared/lib/urdfBrowser";

import {
  LEKIWI_LIVE_MESH_ROOT,
  LEKIWI_LIVE_MESH_SUFFIX_PATTERN,
  LEKIWI_LIVE_URDF_ROBOT_NAME,
} from "./lekiwiLiveUrdfParams";

const hasLeKiwiRobotName = (urdfContent: string): boolean => {
  const parsed = parseURDF(urdfContent);
  const robotElement = parsed.document.documentElement;
  return robotElement?.tagName === "robot" && robotElement.getAttribute("name") === LEKIWI_LIVE_URDF_ROBOT_NAME;
};

const splitMeshReference = (
  meshReference: string
): { directory: string; extension: string; stem: string } | null => {
  const normalized = meshReference.trim();
  if (!normalized.startsWith(LEKIWI_LIVE_MESH_ROOT)) {
    return null;
  }
  const slashIndex = normalized.lastIndexOf("/");
  const dotIndex = normalized.lastIndexOf(".");
  if (slashIndex < 0 || dotIndex <= slashIndex) {
    return null;
  }
  return {
    directory: normalized.slice(0, slashIndex + 1),
    extension: normalized.slice(dotIndex),
    stem: normalized.slice(slashIndex + 1, dotIndex),
  };
};

const buildRepeatedMeshReferenceForLink = (linkName: string, meshReference: string): string | null => {
  const meshParts = splitMeshReference(meshReference);
  if (!meshParts) {
    return null;
  }
  if (meshParts.stem === linkName) {
    return meshReference;
  }
  const repeatedMatch = linkName.match(LEKIWI_LIVE_MESH_SUFFIX_PATTERN);
  if (!repeatedMatch) {
    return null;
  }
  if (repeatedMatch[1] !== meshParts.stem) {
    return null;
  }
  return `${meshParts.directory}${linkName}${meshParts.extension}`;
};

const normalizeLeKiwiLiveUrdf = (urdfContent: string): string => {
  if (!urdfContent.trim() || !hasLeKiwiRobotName(urdfContent)) {
    return urdfContent;
  }

  const parsed = parseURDF(urdfContent);
  const robotElement = parsed.document.documentElement;
  if (robotElement?.tagName !== "robot") {
    return urdfContent;
  }

  let changed = false;
  const linkElements = Array.from(robotElement.getElementsByTagName("link"));
  linkElements.forEach((linkElement) => {
    const linkName = linkElement.getAttribute("name")?.trim();
    if (!linkName) {
      return;
    }
    const meshElements = Array.from(linkElement.getElementsByTagName("mesh"));
    meshElements.forEach((meshElement) => {
      const currentReference = meshElement.getAttribute("filename");
      if (!currentReference) {
        return;
      }
      const nextReference = buildRepeatedMeshReferenceForLink(linkName, currentReference);
      if (!nextReference || nextReference === currentReference) {
        return;
      }
      meshElement.setAttribute("filename", nextReference);
      changed = true;
    });
  });

  return changed ? new XMLSerializer().serializeToString(parsed.document) : urdfContent;
};

const resolveSharedMeshReferenceAlias = (meshReference: string, meshFiles: MeshFiles): string | null => {
  const meshParts = splitMeshReference(meshReference);
  if (!meshParts) {
    return null;
  }
  const repeatedMatch = meshParts.stem.match(LEKIWI_LIVE_MESH_SUFFIX_PATTERN);
  if (!repeatedMatch) {
    return null;
  }
  const sharedReference = `${meshParts.directory}${repeatedMatch[1]}${meshParts.extension}`;
  const normalizedSharedReference = normalizeMeshPathForMatch(sharedReference) ?? sharedReference;
  return meshFiles[normalizedSharedReference] ? normalizedSharedReference : null;
};

export const aliasLeKiwiLiveMeshFiles = (
  urdfContent: string,
  meshFiles: MeshFiles
): MeshFiles => {
  if (!hasLeKiwiRobotName(urdfContent) || Object.keys(meshFiles).length === 0) {
    return meshFiles;
  }

  const normalizedUrdf = normalizeLeKiwiLiveUrdf(urdfContent);
  const parsed = parseURDF(normalizedUrdf);
  const robotElement = parsed.document.documentElement;
  if (robotElement?.tagName !== "robot") {
    return meshFiles;
  }

  let nextMeshFiles: MeshFiles | null = null;
  const meshElements = Array.from(robotElement.getElementsByTagName("mesh"));
  meshElements.forEach((meshElement) => {
    const filename = meshElement.getAttribute("filename");
    if (!filename) {
      return;
    }
    const normalizedFilename = normalizeMeshPathForMatch(filename) ?? filename;
    if (meshFiles[normalizedFilename] || nextMeshFiles?.[normalizedFilename]) {
      return;
    }
    const sharedAlias = resolveSharedMeshReferenceAlias(normalizedFilename, meshFiles);
    if (!sharedAlias) {
      return;
    }
    nextMeshFiles = nextMeshFiles ?? { ...meshFiles };
    nextMeshFiles[normalizedFilename] = meshFiles[sharedAlias]!;
  });

  return nextMeshFiles ?? meshFiles;
};
