import {
  isXacroPath,
  normalizeExpandedUrdfPath,
} from "@/shared/lib/urdfCore";
import { normalizeMeshPathForMatch } from "@/shared/lib/urdfBrowser";
import {
  collectXacroSupportFiles,
  expandXacro,
} from "@/features/urdf/xacro/xacroClient";
import { createExpandedXacroUrdfFile } from "@/features/urdf/loader/urdfFileFactory";
import { getFileRelativePath } from "@/features/urdf/loader/urdfMeshIndex";

type ExpandXacroFile = (
  xacroRelativePath: string,
  supportFiles: File[]
) => Promise<{ urdf: string }>;

export type FolderUrdfSource = {
  expandedFromXacro: boolean;
  file: File;
  filename: string;
  relativePath: string;
  urdfContent: string;
  urdfDocuments: Record<string, string>;
  warnings: string[];
};

export const resolveFolderUrdfSource = async (
  fileList: FileList,
  options: { expandXacroFile?: ExpandXacroFile } = {}
): Promise<FolderUrdfSource> => {
  const allFiles = Array.from(fileList);
  const urdfFiles = allFiles.filter((file) => file.name.toLowerCase().endsWith(".urdf"));
  const xacroFiles = allFiles.filter((file) => isXacroPath(file.name));
  const warnings: string[] = [];

  if (urdfFiles.length === 0 && xacroFiles.length === 0) {
    throw new Error("No URDF or Xacro file found in selected folder");
  }

  if (urdfFiles.length > 1) {
    warnings.push(
      `Multiple URDF files found (${urdfFiles.length}), using only the first one: ${urdfFiles[0].name}`
    );
  }

  if (urdfFiles.length === 0 && xacroFiles.length > 1) {
    warnings.push(
      `Multiple Xacro files found (${xacroFiles.length}), using only the first one: ${xacroFiles[0].name}`
    );
  }

  if (urdfFiles.length > 0) {
    const urdfEntries = await Promise.all(
      urdfFiles.map(async (candidateFile) => {
        const rawPath = getFileRelativePath(candidateFile);
        const normalizedPath = normalizeMeshPathForMatch(rawPath) || candidateFile.name;
        return {
          content: await candidateFile.text(),
          file: candidateFile,
          path: normalizedPath,
        };
      })
    );
    const urdfDocuments = urdfEntries.reduce<Record<string, string>>((documents, entry) => {
      documents[entry.path] = entry.content;
      return documents;
    }, {});
    const selected = urdfEntries[0];

    return {
      expandedFromXacro: false,
      file: selected.file,
      filename: selected.file.name,
      relativePath: selected.path,
      urdfContent: selected.content,
      urdfDocuments,
      warnings,
    };
  }

  const xacroFile = xacroFiles[0];
  const xacroRelativePath = getFileRelativePath(xacroFile);
  const supportFiles = collectXacroSupportFiles(fileList);
  let urdfContent = "";
  try {
    const result = await (options.expandXacroFile ?? expandXacro)(xacroRelativePath, supportFiles);
    urdfContent = result.urdf;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to expand xacro file";
    throw new Error(message);
  }

  const expandedRelativePath = normalizeExpandedUrdfPath(xacroRelativePath);
  const filename = normalizeExpandedUrdfPath(xacroFile.name);
  const normalizedUrdfPath = normalizeMeshPathForMatch(expandedRelativePath) || expandedRelativePath;
  const file = createExpandedXacroUrdfFile({
    content: urdfContent,
    filename,
    relativePath: normalizedUrdfPath,
  });

  return {
    expandedFromXacro: true,
    file,
    filename,
    relativePath: normalizedUrdfPath,
    urdfContent,
    urdfDocuments: {
      [normalizedUrdfPath]: urdfContent,
    },
    warnings,
  };
};
