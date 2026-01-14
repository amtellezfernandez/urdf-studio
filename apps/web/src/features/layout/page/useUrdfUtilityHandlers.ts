import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  canonicalizeUrdf,
  fixMeshPaths,
  normalizeAxes,
  parseURDF,
  prettifyUrdf,
  rotateUrdf,
} from "@/features/urdf";
import type { RotationAxis } from "@/shared/types/feature";
import { AXIS_NAMES } from "@/features/layout/page/constants";

type UseUrdfUtilityHandlersArgs = {
  vizUrdfContent: string;
  deletedJoints: Set<string>;
  toggleDeletedJoint: (jointName: string) => void;
  handleVizUrdfChange: (newContent: string) => void;
  updateUrdfFile: (content: string) => void;
};

export const useUrdfUtilityHandlers = ({
  vizUrdfContent,
  deletedJoints,
  toggleDeletedJoint,
  handleVizUrdfChange,
  updateUrdfFile,
}: UseUrdfUtilityHandlersArgs) => {
  const deleteJointsFromURDF = useCallback(
    (urdfContent: string, jointsToDelete: Set<string>): string => {
      if (jointsToDelete.size === 0) return urdfContent;

      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(urdfContent, "text/xml");

      // Check for parsing errors
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        const errorText = parserError.textContent || "Unknown XML parsing error";
        console.error("URDF parsing error:", errorText);
        return urdfContent;
      }

      // Validate robot element exists
      const robot = xmlDoc.querySelector("robot");
      if (!robot) {
        console.error("No <robot> element found in URDF");
        return urdfContent;
      }

      jointsToDelete.forEach((jointName) => {
        xmlDoc.querySelector(`joint[name="${jointName}"]`)?.remove();
      });

      return new XMLSerializer().serializeToString(xmlDoc);
    },
    []
  );

  const handleCanonicalOrder = useCallback(() => {
    if (!vizUrdfContent) return;
    const result = canonicalizeUrdf(vizUrdfContent);
    if (!result.success) {
      toast.error(result.error ?? "Failed to reorder URDF");
      return;
    }
    handleVizUrdfChange(result.content);
    toast.success(result.message ?? "URDF elements reordered to canonical format");
  }, [handleVizUrdfChange, vizUrdfContent]);

  const handlePrettyPrint = useCallback(() => {
    if (!vizUrdfContent) return;
    const result = prettifyUrdf(vizUrdfContent);
    if (!result.success) {
      toast.error(result.error ?? "Failed to format URDF");
      return;
    }
    handleVizUrdfChange(result.content);
    toast.success(result.message ?? "URDF formatted with consistent indentation");
  }, [handleVizUrdfChange, vizUrdfContent]);

  const handleNormalizeAxes = useCallback(() => {
    if (!vizUrdfContent) return;
    const result = normalizeAxes(vizUrdfContent);
    if (!result.success) {
      toast.error(result.error ?? "Failed to normalize joint axes");
      return;
    }
    handleVizUrdfChange(result.content);

    if (result.issues.length > 0) {
      toast.warning(`Normalized axes with ${result.issues.length} error(s) fixed`);
      result.issues.forEach((err) => {
        console.warn(`Joint "${err.jointName}" (${err.jointType}): ${err.issue}`);
      });
    } else if (result.corrections.length > 0) {
      toast.success(result.message ?? `Normalized ${result.corrections.length} joint axis(es)`);
      result.corrections.forEach((correction) => {
        console.info(`Joint "${correction.jointName}": ${correction.reason}`);
      });
    } else {
      toast.info("All joint axes are already normalized");
    }
  }, [handleVizUrdfChange, vizUrdfContent]);

  const handleFixMeshPaths = useCallback(() => {
    if (!vizUrdfContent) return;
    const result = fixMeshPaths(vizUrdfContent);
    handleVizUrdfChange(result.urdfContent);

    if (result.corrections.length > 0) {
      toast.success(`Fixed ${result.corrections.length} mesh path(s)`);
      result.corrections.forEach((correction) => {
        console.info(`Fixed path: "${correction.original}" -> "${correction.corrected}"`);
      });
    } else {
      toast.info("All mesh paths are already correct");
    }
  }, [handleVizUrdfChange, vizUrdfContent]);

  const getExportUrdfContent = useCallback(() => {
    if (!vizUrdfContent) return "";
    return deleteJointsFromURDF(vizUrdfContent, deletedJoints);
  }, [deletedJoints, deleteJointsFromURDF, vizUrdfContent]);

  const robotName = useMemo(() => {
    if (!vizUrdfContent) return "robot";
    const parsed = parseURDF(vizUrdfContent);
    if (!parsed.isValid) return "robot";
    const robot = parsed.document.querySelector("robot");
    return robot?.getAttribute("name") || "robot";
  }, [vizUrdfContent]);

  const handleDeleteJoint = useCallback(
    (jointName: string) => {
      const willRemove = !deletedJoints.has(jointName);
      toggleDeletedJoint(jointName);
      toast.success(
        willRemove
          ? `Joint "${jointName}" will be removed from exported URDF`
          : `Joint "${jointName}" will be included in exported URDF`
      );
    },
    [deletedJoints, toggleDeletedJoint]
  );

  const handleRotateRobot = useCallback(
    (axis: RotationAxis) => {
      if (!vizUrdfContent) {
        toast.error("No URDF loaded");
        return;
      }

      const result = rotateUrdf(vizUrdfContent, axis);

      if (!result.success) {
        toast.error(result.error ?? "Failed to rotate robot");
        return;
      }

      updateUrdfFile(result.content);
      toast.success(result.message ?? `Robot rotated 90° around ${AXIS_NAMES[axis]}-axis`);
    },
    [updateUrdfFile, vizUrdfContent]
  );

  return {
    handleCanonicalOrder,
    handlePrettyPrint,
    handleNormalizeAxes,
    handleFixMeshPaths,
    handleRotateRobot,
    getExportUrdfContent,
    robotName,
    handleDeleteJoint,
  };
};
