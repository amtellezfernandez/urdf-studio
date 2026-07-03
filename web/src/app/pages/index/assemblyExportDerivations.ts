import type { AssemblyRobotInstance } from "@/features/assembly/store/useAssemblyStore";
import { normalizeMeshPathForMatch } from "@/shared/lib/urdfCore";

export type AssemblyExportModel = {
  id: string;
  isPrimary: boolean;
  name: string;
  urdfContent: string;
};

const normalizeAssemblyUrdfPath = (path: string): string =>
  normalizeMeshPathForMatch(path) || path;

const normalizeActiveAssemblyUrdfPath = (
  activeUrdfPath: string | null | undefined
): string | null =>
  activeUrdfPath && activeUrdfPath.length > 0
    ? normalizeAssemblyUrdfPath(activeUrdfPath)
    : null;

export const resolveAssemblyExportFileName = (
  urdfFileName: string | null | undefined
): string => urdfFileName?.replace(/^viz-/, "") || "primary.urdf";

export const resolveAssemblyExportPrimaryRobotId = (
  assemblySelectedRobots: AssemblyRobotInstance[]
): string | null =>
  assemblySelectedRobots.find((robot) => robot.isPrimary)?.instanceId ||
  assemblySelectedRobots[0]?.instanceId ||
  null;

export const buildAssemblyExportModels = ({
  activeUrdfPath,
  assemblySelectedRobots,
  fallbackUrdfFileName,
  urdfDocuments,
  vizUrdfContent,
}: {
  activeUrdfPath: string | null | undefined;
  assemblySelectedRobots: AssemblyRobotInstance[];
  fallbackUrdfFileName: string | null | undefined;
  urdfDocuments: Record<string, string>;
  vizUrdfContent: string;
}): AssemblyExportModel[] => {
  const normalizedActivePath = normalizeActiveAssemblyUrdfPath(activeUrdfPath);
  const selectedModels = assemblySelectedRobots
    .map((robot): AssemblyExportModel | null => {
      const normalizedPath = normalizeAssemblyUrdfPath(robot.urdfPath);
      const content =
        urdfDocuments[normalizedPath] ||
        (normalizedActivePath && normalizedPath === normalizedActivePath
          ? vizUrdfContent
          : "");
      if (!content.trim()) {
        return null;
      }
      return {
        id: robot.instanceId,
        isPrimary: robot.isPrimary,
        name: robot.name,
        urdfContent: content,
      };
    })
    .filter((model): model is AssemblyExportModel => model !== null);

  if (selectedModels.length > 0) {
    return selectedModels;
  }

  return vizUrdfContent.trim().length > 0
    ? [
        {
          id: "primary_robot",
          isPrimary: false,
          name: resolveAssemblyExportFileName(fallbackUrdfFileName),
          urdfContent: vizUrdfContent,
        },
      ]
    : [];
};
