import { normalizeMeshPathForMatch } from "@/shared/lib/urdfBrowser";

type ResolveSubstitutionReplacementParams = {
  hostUrdfPath: string;
  replacementUrdfPath: string;
  activeUrdfPath: string | null;
  urdfDocuments: Record<string, string>;
  vizUrdfContent: string;
};

const normalizeUrdfPath = (path: string | null): string | null =>
  path && path.trim().length > 0 ? normalizeMeshPathForMatch(path) || path : null;

export const resolveSubstitutionReplacement = ({
  hostUrdfPath,
  replacementUrdfPath,
  activeUrdfPath,
  urdfDocuments,
  vizUrdfContent,
}: ResolveSubstitutionReplacementParams): {
  hostFilename: string;
  replacementActivePath: string;
  nextUrdfDocuments: Record<string, string>;
  replacementContent: string;
} => {
  const normalizedHostPath = normalizeUrdfPath(hostUrdfPath);
  const normalizedReplacementPath = normalizeUrdfPath(replacementUrdfPath);
  const normalizedActivePath = normalizeUrdfPath(activeUrdfPath);

  if (!normalizedHostPath || !normalizedReplacementPath) {
    throw new Error("Substitution is missing host or replacement paths.");
  }

  const replacementContent =
    urdfDocuments[normalizedReplacementPath] ||
    (normalizedActivePath === normalizedReplacementPath ? vizUrdfContent : "");
  if (!replacementContent.trim()) {
    throw new Error("Replacement URDF is unavailable. Reload substitution mode and try again.");
  }

  return {
    hostFilename: normalizedHostPath.split("/").pop() || normalizedHostPath,
    replacementActivePath: normalizedReplacementPath,
    nextUrdfDocuments: {
      ...urdfDocuments,
      [normalizedReplacementPath]: replacementContent,
    },
    replacementContent,
  };
};
