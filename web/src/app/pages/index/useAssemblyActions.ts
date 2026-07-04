import { useCallback } from "react";
import { toast } from "sonner";

import {
  buildAssemblyUrdf,
  createAssemblySpec,
  validateAssemblySpec,
} from "@/shared/lib/urdfCore";
import { downloadTextDocument } from "@/app/pages/index/useWorldSceneManager";
import {
  buildAssemblyExportModels,
  resolveAssemblyExportPrimaryRobotId,
} from "@/app/pages/index/assemblyExportDerivations";
import type { AssemblyPose } from "@/features/assembly/store/useAssemblyPlacementStore";
import type { AssemblyRobotInstance } from "@/features/assembly/store/useAssemblyStore";
import { resolveSubstitutionReplacement } from "@/features/assembly/substitution/substitutionApply";
import { applySubstitutionSubtree } from "@/features/assembly/substitution/substitutionSubtree";
import type { AssemblySubstitutionSession } from "@/features/assembly/workspace/assemblyWorkspaceTypes";
import type { LoadUrdfTextOptions } from "@/features/urdf/loader/urdfLoaderTypes";
import type { WorkspaceMode } from "@/features/workspace/types";
import type { MeshFiles } from "@/shared/types/feature";

type LoadUrdfText = (content: string, options?: LoadUrdfTextOptions) => void;

type UseAssemblyActionsParams = {
  activeUrdfPath: string | null;
  assemblyHasPhysicalContact: boolean;
  assemblyPoses: Record<string, AssemblyPose>;
  assemblySelectedRobots: AssemblyRobotInstance[];
  clearAssemblyPlacement: () => void;
  clearAssemblySelection: () => void;
  duplicateAssemblyRobot: (instanceId: string) => void;
  fallbackUrdfFileName?: string | null;
  isAssemblyWorkspace: boolean;
  loadUrdfText: LoadUrdfText;
  meshFiles: MeshFiles;
  packageRoots: Record<string, string[]>;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  substitutionSession: AssemblySubstitutionSession | null;
  urdfDocuments: Record<string, string>;
  vizUrdfContent: string;
};

export const useAssemblyActions = ({
  activeUrdfPath,
  assemblyHasPhysicalContact,
  assemblyPoses,
  assemblySelectedRobots,
  clearAssemblyPlacement,
  clearAssemblySelection,
  duplicateAssemblyRobot,
  fallbackUrdfFileName,
  isAssemblyWorkspace,
  loadUrdfText,
  meshFiles,
  packageRoots,
  setWorkspaceMode,
  substitutionSession,
  urdfDocuments,
  vizUrdfContent,
}: UseAssemblyActionsParams) => {
  const handleExportAssemblyUrdf = useCallback(() => {
    if (isAssemblyWorkspace && !assemblyHasPhysicalContact) {
      toast.error("Assembly export requires at least one physical robot contact.");
      return;
    }
    const models = buildAssemblyExportModels({
      activeUrdfPath,
      assemblySelectedRobots,
      fallbackUrdfFileName,
      urdfDocuments,
      vizUrdfContent,
    });

    if (models.length === 0) {
      toast.error("No assembly robots available for export.");
      return;
    }

    try {
      const spec = createAssemblySpec(models, {
        robotName: "assembled_robot",
        poses: assemblyPoses,
        primaryRobotId: resolveAssemblyExportPrimaryRobotId(assemblySelectedRobots),
      });
      const validation = validateAssemblySpec(spec);
      if (!validation.isValid) {
        toast.error(validation.errors[0] || "Assembly export is invalid.");
        return;
      }
      const urdf = buildAssemblyUrdf(spec);
      downloadTextDocument(urdf, "assembled_robot.urdf", "application/xml");
      toast.success(
        `Exported assembly URDF (${models.length} robot${models.length > 1 ? "s" : ""})`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export assembly URDF");
    }
  }, [
    activeUrdfPath,
    assemblyHasPhysicalContact,
    assemblyPoses,
    assemblySelectedRobots,
    fallbackUrdfFileName,
    isAssemblyWorkspace,
    urdfDocuments,
    vizUrdfContent,
  ]);

  const handleDuplicateAssemblyRobot = useCallback(
    (instanceId: string) => {
      duplicateAssemblyRobot(instanceId);
      toast.success("Duplicated robot instance in assembly.");
    },
    [duplicateAssemblyRobot]
  );

  const handleApplySubstitution = useCallback(
    (hostRootLink: string, replacementRootLink: string) => {
      if (!substitutionSession) {
        toast.error("Substitution session is not active.");
        return;
      }
      if (!hostRootLink || !replacementRootLink) {
        toast.error("Choose both a host target link and a replacement root link.");
        return;
      }

      try {
        const { hostFilename, nextUrdfDocuments, replacementContent } =
          resolveSubstitutionReplacement({
            hostUrdfPath: substitutionSession.hostUrdfPath,
            replacementUrdfPath: substitutionSession.replacementUrdfPath,
            activeUrdfPath,
            urdfDocuments,
            vizUrdfContent,
          });
        const nextHostUrdf = applySubstitutionSubtree({
          hostUrdfContent: substitutionSession.hostUrdfContent,
          replacementUrdfContent: replacementContent,
          hostRootLink,
          replacementRootLink,
          replacementUrdfPath: substitutionSession.replacementUrdfPath,
          packageRoots: substitutionSession.packageRoots,
        });
        loadUrdfText(nextHostUrdf.urdfContent, {
          filename: hostFilename,
          activePath: substitutionSession.hostUrdfPath,
          urdfDocuments: {
            ...nextUrdfDocuments,
            [substitutionSession.hostUrdfPath]: nextHostUrdf.urdfContent,
          },
          meshFiles,
          packageRoots,
        });
        clearAssemblySelection();
        clearAssemblyPlacement();
        setWorkspaceMode("studio");
        toast.success(
          `Replaced ${hostRootLink} on ${substitutionSession.hostRobotName} with ${replacementRootLink} from ${substitutionSession.replacementRobotName}.`
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to apply substitution.");
      }
    },
    [
      activeUrdfPath,
      clearAssemblyPlacement,
      clearAssemblySelection,
      loadUrdfText,
      meshFiles,
      packageRoots,
      setWorkspaceMode,
      substitutionSession,
      urdfDocuments,
      vizUrdfContent,
    ]
  );

  return {
    handleApplySubstitution,
    handleDuplicateAssemblyRobot,
    handleExportAssemblyUrdf,
  };
};
