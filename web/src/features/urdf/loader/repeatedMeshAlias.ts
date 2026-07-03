import type { MeshFiles } from "@/shared/types/feature";
import { normalizeMeshPathForMatch, parseURDF } from "@/shared/lib/urdfBrowser";

const REPEATED_LINK_SUFFIX_PATTERN = /^(.*)-(\d+)$/;

const splitMeshReference = (
  meshReference: string
): { directory: string; extension: string; stem: string } | null => {
  const normalized = meshReference.trim();
  const slashIndex = normalized.lastIndexOf("/");
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex <= slashIndex) {
    return null;
  }
  return {
    directory: slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : "",
    extension: normalized.slice(dotIndex),
    stem: normalized.slice(slashIndex + 1, dotIndex),
  };
};

const buildRepeatedMeshReferenceForLink = (
  linkName: string,
  meshReference: string
): string | null => {
  const meshParts = splitMeshReference(meshReference);
  if (!meshParts || meshParts.stem === linkName) {
    return null;
  }
  const repeatedMatch = linkName.match(REPEATED_LINK_SUFFIX_PATTERN);
  if (!repeatedMatch || repeatedMatch[1] !== meshParts.stem) {
    return null;
  }
  return `${meshParts.directory}${linkName}${meshParts.extension}`;
};

const collectRepeatedMeshAliases = (urdfContent: string): Map<string, string> => {
  if (!urdfContent.trim()) return new Map();
  const parsed = parseURDF(urdfContent);
  const robotElement = parsed.document.documentElement;
  if (robotElement?.tagName !== "robot") return new Map();

  const aliases = new Map<string, string>();
  Array.from(robotElement.getElementsByTagName("link")).forEach((linkElement) => {
    const linkName = linkElement.getAttribute("name")?.trim();
    if (!linkName) return;
    Array.from(linkElement.getElementsByTagName("mesh")).forEach((meshElement) => {
      const sourceReference = meshElement.getAttribute("filename");
      if (!sourceReference) return;
      const aliasReference = buildRepeatedMeshReferenceForLink(linkName, sourceReference);
      if (!aliasReference) return;
      const normalizedAlias = normalizeMeshPathForMatch(aliasReference) ?? aliasReference;
      const normalizedSource = normalizeMeshPathForMatch(sourceReference) ?? sourceReference;
      aliases.set(normalizedAlias, normalizedSource);
    });
  });
  return aliases;
};

export const aliasRepeatedLinkMeshFiles = (
  urdfContent: string,
  meshFiles: MeshFiles
): MeshFiles => {
  if (Object.keys(meshFiles).length === 0) return meshFiles;

  let nextMeshFiles: MeshFiles | null = null;
  collectRepeatedMeshAliases(urdfContent).forEach((sourceReference, aliasReference) => {
    if (meshFiles[aliasReference] || nextMeshFiles?.[aliasReference]) return;
    const sourceBlob = meshFiles[sourceReference];
    if (!sourceBlob) return;
    nextMeshFiles = nextMeshFiles ?? { ...meshFiles };
    nextMeshFiles[aliasReference] = sourceBlob;
  });

  return nextMeshFiles ?? meshFiles;
};
