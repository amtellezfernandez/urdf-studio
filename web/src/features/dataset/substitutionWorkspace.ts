import type { AssemblyRobotInstance } from "@/features/assembly/store/useAssemblyStore";

export type SubstitutionWorkspaceSource =
  | {
      type: "github";
      owner: string;
      repo: string;
      path?: string;
      branch?: string;
      url?: string;
    }
  | {
      type: "local";
      folder?: string;
    };

export type SubstitutionWorkspaceSelection = {
  candidate: {
    path: string;
    name: string;
  };
  source: SubstitutionWorkspaceSource;
  files: FileList | File[];
};

export type SubstitutionWorkspaceLaunchPlan = {
  files: File[];
  selectedPaths: string[];
  namesByPath: Record<string, string>;
  sourceByPath: Record<string, AssemblyRobotInstance["source"]>;
  roleByPath: Record<string, AssemblyRobotInstance["role"]>;
};

const SUBSTITUTION_URDF_EXTENSION = ".urdf";

const sanitizePathToken = (value: string, fallback: string): string => {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_/-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^-+|-+$/g, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/-+/g, "-");
  return normalized || fallback;
};

const normalizePath = (value: string): string => value.replace(/\\/g, "/");

const toNamespacedPath = (prefix: string, relativePath: string): string => {
  const normalizedPath = normalizePath(relativePath).replace(/^\/+/, "");
  return `${prefix}/${normalizedPath}`;
};

const toFileArray = (files: FileList | File[]): File[] =>
  Array.isArray(files) ? files : Array.from(files);

const getRelativePath = (file: File): string => {
  const maybeRelativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return normalizePath(maybeRelativePath || file.name);
};

const buildSourcePrefix = (source: SubstitutionWorkspaceSource): string => {
  if (source.type === "github") {
    const repoBranchSegment = source.branch ? `/${source.branch}` : "/default";
    const repoPathSegment = source.path ? `/${source.path}` : "/root";
    return sanitizePathToken(
      `github/${source.owner}/${source.repo}${repoBranchSegment}${repoPathSegment}`,
      "github_source"
    );
  }
  return sanitizePathToken(`local/${source.folder || "folder"}`, "local_source");
};

const resolveSelectedRelativePath = (
  candidatePath: string,
  sourceFiles: File[]
): string => {
  const primaryUrdf =
    sourceFiles.find((file) => getRelativePath(file).toLowerCase().endsWith(SUBSTITUTION_URDF_EXTENSION)) ??
    null;
  return primaryUrdf ? getRelativePath(primaryUrdf) : normalizePath(candidatePath);
};

export const buildSubstitutionWorkspaceLaunchPlan = (
  hostSelection: SubstitutionWorkspaceSelection,
  elementSelection: SubstitutionWorkspaceSelection
): SubstitutionWorkspaceLaunchPlan => {
  const mergedFiles: File[] = [];
  const mergedPaths = new Set<string>();
  const selectedPaths: string[] = [];
  const namesByPath: Record<string, string> = {};
  const sourceByPath: Record<string, AssemblyRobotInstance["source"]> = {};
  const roleByPath: Record<string, AssemblyRobotInstance["role"]> = {};

  [hostSelection, elementSelection].forEach((selection, index) => {
    const sourceFiles = toFileArray(selection.files);
    const sourcePrefix = buildSourcePrefix(selection.source);

    sourceFiles.forEach((file) => {
      const nextRelativePath = toNamespacedPath(sourcePrefix, getRelativePath(file));
      if (mergedPaths.has(nextRelativePath)) {
        return;
      }
      mergedPaths.add(nextRelativePath);
      const clonedFile = new File([file], file.name, {
        type: file.type || "application/octet-stream",
        lastModified: file.lastModified,
      });
      Object.defineProperty(clonedFile, "webkitRelativePath", {
        value: nextRelativePath,
        configurable: true,
      });
      mergedFiles.push(clonedFile);
    });

    const selectedPath = toNamespacedPath(
      sourcePrefix,
      resolveSelectedRelativePath(selection.candidate.path, sourceFiles)
    );
    if (!selectedPaths.includes(selectedPath)) {
      selectedPaths.push(selectedPath);
    }
    namesByPath[selectedPath] = selection.candidate.name;
    sourceByPath[selectedPath] = selection.source;
    roleByPath[selectedPath] = index === 0 ? "host" : "replacement";
  });

  return {
    files: mergedFiles,
    selectedPaths,
    namesByPath,
    sourceByPath,
    roleByPath,
  };
};
