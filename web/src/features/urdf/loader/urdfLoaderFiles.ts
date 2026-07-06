import {
  analyzeUrdfDocument,
  buildPackageRootsFromRepositoryFiles,
  buildRepositoryFileEntriesFromPaths,
  extractPackageNameFromPackageXml,
  isXacroPath,
} from "@/shared/lib/urdfCore";
import { getPathSegments } from "@/shared/lib/pathNames";
import {
  normalizeMeshPathForMatch,
  parseURDF,
} from "@/shared/lib/urdfBrowser";
import { getFileRelativePath } from "@/features/urdf/loader/urdfMeshIndex";

export const getBasePathFromRelativePath = (relativePath: string): string => {
  const normalized = normalizeMeshPathForMatch(relativePath);
  if (!normalized) return "";
  const parts = getPathSegments(normalized);
  if (parts.length <= 1) return "";
  parts.pop();
  return parts.join("/");
};

export const buildPackageRootsFromFiles = async (files: readonly File[]) => {
  const packageFiles = files.filter((file) => file.name.toLowerCase() === "package.xml");
  const packageNameByPath: Record<string, string> = {};

  await Promise.all(
    packageFiles.map(async (file) => {
      try {
        const relativePath = getFileRelativePath(file);
        const normalizedPath = normalizeMeshPathForMatch(relativePath);
        if (!normalizedPath) return;
        const text = await file.text();
        const packageName = extractPackageNameFromPackageXml(text);
        if (!packageName) return;
        packageNameByPath[normalizedPath] = packageName;
      } catch {
        // Ignore package.xml read errors.
      }
    })
  );

  const repositoryFiles = buildRepositoryFileEntriesFromPaths(
    files.map((file) => getFileRelativePath(file))
  );

  return buildPackageRootsFromRepositoryFiles(repositoryFiles, {
    packageNameByPath,
  });
};

export const readUrdfDocumentsFromFiles = async (files: readonly File[]) => {
  const documentEntries = await Promise.all(
    files
      .filter(
        (file) => file.name.toLowerCase().endsWith(".urdf") || isXacroPath(getFileRelativePath(file))
      )
      .map(async (file) => {
        const rawPath = getFileRelativePath(file);
        const normalizedPath = normalizeMeshPathForMatch(rawPath) || file.name;
        return {
          content: await file.text(),
          path: normalizedPath,
        };
      })
  );

  return documentEntries.reduce<Record<string, string>>((documents, entry) => {
    documents[entry.path] = entry.content;
    return documents;
  }, {});
};

export const extractMeshReferencesFromUrdfContent = (urdfContent: string): string[] => {
  if (!urdfContent.trim()) return [];
  const parsed = parseURDF(urdfContent);
  return analyzeUrdfDocument(parsed.document).meshReferences;
};
