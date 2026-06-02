import {
  KITCHEN_GENERATED_URDF_EXTENSION,
  KITCHEN_GENERATED_URDF_MIME_TYPE,
  KITCHEN_WARNING_TOAST_DURATION_MS,
  KITCHEN_XML_EXTENSION,
} from "@/features/kitchen/kitchenParams";
import {
  buildKitchenArtifactFromXmlFiles,
  describeKitchenArtifact,
  type KitchenGeneratedArtifact,
  type KitchenTextFile,
} from "@/features/kitchen/kitchenSource";
import type { GitHubFile, URDFCandidate } from "@/features/urdf/github/githubRepo";
import { normalizeMeshPathForMatch } from "@/shared/lib/urdfBrowser";
import { toast } from "sonner";

export { describeKitchenArtifact } from "@/features/kitchen/kitchenSource";

export type LocalWebkitFile = File & { webkitRelativePath?: string };
export type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  fullPath?: string;
  name: string;
};
type FileSystemFileEntryLike = FileSystemEntryLike & {
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
};
type FileSystemDirectoryReaderLike = {
  readEntries: (
    success: (entries: FileSystemEntryLike[]) => void,
    error?: (error: DOMException) => void
  ) => void;
};
type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  createReader: () => FileSystemDirectoryReaderLike;
};
export type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

export type SourceOriginLabel = "folder" | "files" | "zip";

export type PreparedLocalRobotSource = {
  files: File[];
  sourceOrigin: SourceOriginLabel;
  sourceLabel: string | null;
};

export type KitchenLocalGeneratedFile = {
  artifact: KitchenGeneratedArtifact;
  file: File;
};

export const normalizeLocalPath = (path: string): string =>
  path.replace(/\\/g, "/").replace(/^\/+/, "");

export const assignRelativePath = (file: File, relativePath: string): File => {
  Object.defineProperty(file, "webkitRelativePath", {
    value: normalizeLocalPath(relativePath),
    writable: false,
    enumerable: true,
    configurable: true,
  });
  return file;
};

export const dedupePathsPreserveOrder = (paths: string[]): string[] => {
  const seen = new Set<string>();
  const uniquePaths: string[] = [];
  paths.forEach((path) => {
    const normalizedPath = normalizeLocalPath(path);
    if (seen.has(normalizedPath)) return;
    seen.add(normalizedPath);
    uniquePaths.push(path);
  });
  return uniquePaths;
};

export const dedupeUrdfCandidatesByPath = (
  candidates: URDFCandidate[]
): URDFCandidate[] => {
  const byPath = new Map<string, URDFCandidate>();
  candidates.forEach((candidate) => {
    const normalizedPath = normalizeLocalPath(candidate.path);
    if (byPath.has(normalizedPath)) return;
    byPath.set(normalizedPath, candidate);
  });
  return Array.from(byPath.values());
};

export const getLocalRelativePath = (file: File): string => {
  const relativePath = (file as LocalWebkitFile).webkitRelativePath || file.name;
  return normalizeLocalPath(relativePath);
};

export const toLocalGitHubFiles = (files: File[]): GitHubFile[] => {
  const result: GitHubFile[] = [];
  const directories = new Set<string>();

  for (const file of files) {
    const path = getLocalRelativePath(file);
    const parts = path.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      directories.add(parts.slice(0, i).join("/"));
    }
    result.push({
      name: file.name,
      path,
      type: "file",
      download_url: null,
      size: file.size,
    });
  }

  Array.from(directories)
    .sort((a, b) => a.localeCompare(b))
    .forEach((dir) => {
      result.push({
        name: dir.split("/").pop() || dir,
        path: dir,
        type: "dir",
        download_url: null,
      });
    });

  return result;
};

export const createOrderedLocalFileList = (
  files: File[],
  selectedPath: string
): FileList => {
  const normalizedSelectedPath = normalizeLocalPath(selectedPath).toLowerCase();
  const selectedFile = files.find(
    (file) => getLocalRelativePath(file).toLowerCase() === normalizedSelectedPath
  );

  const dataTransfer = new DataTransfer();
  if (selectedFile) {
    dataTransfer.items.add(selectedFile);
  }
  files.forEach((file) => {
    if (selectedFile && file === selectedFile) return;
    dataTransfer.items.add(file);
  });
  return dataTransfer.files;
};

export const createFileListFromFiles = (files: File[]): FileList => {
  const dataTransfer = new DataTransfer();
  files.forEach((file) => {
    dataTransfer.items.add(file);
  });
  return dataTransfer.files;
};

const createKitchenGeneratedUrdfFile = (artifact: KitchenGeneratedArtifact): File => {
  const fileName =
    artifact.generatedUrdfPath.split("/").filter(Boolean).pop() ||
    `kitchen${KITCHEN_GENERATED_URDF_EXTENSION}`;
  const file = new File([artifact.urdfContent], fileName, {
    type: KITCHEN_GENERATED_URDF_MIME_TYPE,
  });
  return assignRelativePath(file, artifact.generatedUrdfPath);
};

const readKitchenTextFiles = async (files: File[]): Promise<KitchenTextFile[]> => {
  const kitchenXmlFiles = files.filter((file) =>
    getLocalRelativePath(file).toLowerCase().endsWith(KITCHEN_XML_EXTENSION)
  );
  return Promise.all(
    kitchenXmlFiles.map(async (file) => ({
      path: getLocalRelativePath(file),
      text: await file.text(),
    }))
  );
};

export const buildKitchenGeneratedUrdfFile = async (
  files: File[]
): Promise<KitchenLocalGeneratedFile | null> => {
  const kitchenTextFiles = await readKitchenTextFiles(files);
  const artifact = buildKitchenArtifactFromXmlFiles(kitchenTextFiles);
  if (!artifact) return null;
  return {
    artifact,
    file: createKitchenGeneratedUrdfFile(artifact),
  };
};

export const upsertKitchenGeneratedUrdfFile = (
  files: File[],
  generatedFile: File
): File[] => {
  const generatedPath = getLocalRelativePath(generatedFile).toLowerCase();
  return [
    ...files.filter((file) => getLocalRelativePath(file).toLowerCase() !== generatedPath),
    generatedFile,
  ];
};

export const reportKitchenArtifactWarnings = (
  artifact: KitchenGeneratedArtifact
): void => {
  if (artifact.warnings.length === 0) return;
  const firstWarning = artifact.warnings[0] ?? "Review the generated URDF before publishing.";
  toast.warning(
    `Kitchen generated with ${artifact.warnings.length} warning(s): ${firstWarning}`,
    { duration: KITCHEN_WARNING_TOAST_DURATION_MS }
  );
};

export const reportKitchenBuildWarning = (message: string): void => {
  toast.warning(`Kitchen XML could not be generated: ${message}`, {
    duration: KITCHEN_WARNING_TOAST_DURATION_MS,
  });
};

export const deriveSelectedLocalFolder = (files: File[]): string | null => {
  const directorySegments = files
    .map((file) => getLocalRelativePath(file).split("/").filter(Boolean).slice(0, -1))
    .filter((segments) => segments.length > 0);

  if (directorySegments.length === 0) return null;

  const commonPrefix = [...directorySegments[0]];
  for (let i = 1; i < directorySegments.length; i += 1) {
    const current = directorySegments[i];
    while (
      commonPrefix.length > 0 &&
      (current.length < commonPrefix.length ||
        commonPrefix.some((segment, index) => current[index] !== segment))
    ) {
      commonPrefix.pop();
    }
  }

  if (commonPrefix.length > 0) {
    return commonPrefix.join("/");
  }
  return directorySegments[0].join("/");
};

export const cloneWithRelativePath = (file: File, nextRelativePath: string): File => {
  const cloned = new File([file], file.name, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified,
  });
  return assignRelativePath(cloned, nextRelativePath);
};

const readFileSystemFileEntry = async (entry: FileSystemFileEntryLike): Promise<File> =>
  new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });

const readDirectoryEntries = async (
  reader: FileSystemDirectoryReaderLike
): Promise<FileSystemEntryLike[]> =>
  new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });

export const collectEntryFiles = async (
  entry: FileSystemEntryLike,
  pathPrefix = ""
): Promise<File[]> => {
  const normalizedPrefix = normalizeLocalPath(pathPrefix);
  if (entry.isFile) {
    const file = await readFileSystemFileEntry(entry as FileSystemFileEntryLike);
    const relativePath = normalizedPrefix || entry.name || file.name;
    return [assignRelativePath(file, relativePath)];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const directory = entry as FileSystemDirectoryEntryLike;
  const reader = directory.createReader();
  const out: File[] = [];
  while (true) {
    const entries = await readDirectoryEntries(reader);
    if (entries.length === 0) {
      break;
    }
    for (const child of entries) {
      const childPath = [normalizedPrefix, child.name].filter(Boolean).join("/");
      out.push(...(await collectEntryFiles(child, childPath)));
    }
  }
  return out;
};

export const inferZipRoot = (paths: string[]): string | null => {
  const directorySegments = paths
    .map((path) => normalizeLocalPath(path).split("/").filter(Boolean).slice(0, -1))
    .filter((segments) => segments.length > 0);
  if (directorySegments.length === 0) return null;
  const commonPrefix = [...directorySegments[0]];
  for (let i = 1; i < directorySegments.length; i += 1) {
    const current = directorySegments[i];
    while (
      commonPrefix.length > 0 &&
      (current.length < commonPrefix.length ||
        commonPrefix.some((segment, index) => current[index] !== segment))
    ) {
      commonPrefix.pop();
    }
  }
  return commonPrefix.length > 0 ? commonPrefix.join("/") : directorySegments[0].join("/");
};

export const toNamespacedPath = (prefix: string, relativePath: string): string => {
  const normalizedPath = normalizeMeshPathForMatch(relativePath) || relativePath;
  return `${prefix}/${normalizedPath.replace(/^\/+/, "")}`;
};
