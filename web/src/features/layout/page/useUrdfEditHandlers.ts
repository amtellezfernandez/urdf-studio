import { useCallback } from "react";
import { toast } from "sonner";
import {
  changeJointAxis,
  changeJointEffort,
  changeJointLimits,
  changeJointOrigin,
  changeJointType,
  changeJointVelocity,
  renameJoint,
  renameLink,
} from "@/features/urdf/editor/urdfEditorActions";
import type { JointAxisMap } from "@/shared/lib/urdfBrowser";
import type { Dispatch, SetStateAction } from "react";
import {
  sanitizeUrdfName,
  updateJointLinksInUrdf,
  validateJointLinkReassignment,
} from "@/shared/lib/urdfCore";
import { useJointStore } from "@/shared/store/useJointStore";
import { getJointLimitsError } from "@/shared/lib/jointLimits";

type UrdfEditHandlersArgs = {
  vizUrdfContent: string;
  originalVizUrdfContent: string;
  originalJointAxes: JointAxisMap;
  selectedJoint: string | null;
  setSelectedJoint: Dispatch<SetStateAction<string | null>>;
  setAvailableJoints: Dispatch<SetStateAction<string[]>>;
  updateUrdfFile: (content: string) => void;
  setUrdfContentVersion: Dispatch<SetStateAction<number>>;
};

export const useUrdfEditHandlers = ({
  vizUrdfContent,
  originalVizUrdfContent,
  originalJointAxes,
  selectedJoint,
  setSelectedJoint,
  setAvailableJoints,
  updateUrdfFile,
  setUrdfContentVersion,
}: UrdfEditHandlersArgs) => {
  const setJointValue = useJointStore((state) => state.setJointValue);
  const jointValues = useJointStore((state) => state.jointValues);
  const handleVizUrdfChange = useCallback(
    (newContent: string) => {
      updateUrdfFile(newContent);
      toast.success("Viz URDF updated from manual edit");
    },
    [updateUrdfFile]
  );

  const handleLinkNameChange = useCallback(
    (oldName: string, newName: string) => {
      if (newName === oldName) return;
      if (!vizUrdfContent) {
        toast.error("No URDF content available");
        return;
      }

      try {
        const sanitizedName = sanitizeUrdfName(newName);
        if (!sanitizedName) {
          toast.error("Link name is invalid after sanitization");
          return;
        }
        if (sanitizedName !== newName) {
          toast.info(`Renamed to valid URDF name: "${sanitizedName}"`);
        }
        const result = renameLink(vizUrdfContent, oldName, sanitizedName);
        if (!result.success) {
          toast.error(result.error ?? "Failed to update link name");
          return;
        }

        updateUrdfFile(result.content);
        toast.success(result.message ?? `Renamed link "${oldName}" to "${sanitizedName}"`);
      } catch (error) {
        console.error("Error updating link name:", error);
        toast.error("Failed to update link name");
      }
    },
    [updateUrdfFile, vizUrdfContent]
  );

  const handleJointAxisChange = useCallback(
    (jointName: string, axis: [number, number, number]) => {
      if (!vizUrdfContent) {
        toast.error("No URDF content available");
        return;
      }

      const result = changeJointAxis(vizUrdfContent, jointName, axis);
      if (!result.success) {
        toast.error(result.error ?? `Unable to update axis for joint "${jointName}"`);
        return;
      }

      updateUrdfFile(result.content);
      setUrdfContentVersion((prev) => prev + 1); // Force reload of 3D viewer and sidebar

      toast.success(result.message ?? `Updated axis for joint "${jointName}"`);
    },
    [setUrdfContentVersion, updateUrdfFile, vizUrdfContent]
  );

  const handleJointOriginChange = useCallback(
    (jointName: string, xyz: [number, number, number], rpy: [number, number, number]) => {
      if (!vizUrdfContent) {
        toast.error("No URDF content available");
        return;
      }

      const result = changeJointOrigin(vizUrdfContent, jointName, xyz, rpy);
      if (!result.success) {
        toast.error(result.error ?? `Unable to update origin for joint "${jointName}"`);
        return;
      }

      updateUrdfFile(result.content);
      setUrdfContentVersion((prev) => prev + 1);
      toast.success(result.message ?? `Updated origin for joint "${jointName}"`);
    },
    [setUrdfContentVersion, updateUrdfFile, vizUrdfContent]
  );

  const handleResetAxis = useCallback(
    (jointName: string) => {
      if (!originalJointAxes[jointName]) {
        toast.error(`No original axis found for joint "${jointName}"`);
        return;
      }

      const originalAxis = originalJointAxes[jointName].xyz;
      handleJointAxisChange(jointName, originalAxis);
    },
    [handleJointAxisChange, originalJointAxes]
  );

  const handleJointTypeChange = useCallback(
    (jointName: string, newType: string, lowerLimit?: number, upperLimit?: number) => {
      if (!vizUrdfContent) {
        toast.error("No URDF content available");
        return;
      }
      const result = changeJointType(vizUrdfContent, jointName, newType, lowerLimit, upperLimit);
      if (!result.success) {
        toast.error(result.error ?? `Failed to update joint "${jointName}"`);
        return;
      }

      updateUrdfFile(result.content);
      const limitMsg =
        lowerLimit !== undefined && upperLimit !== undefined
          ? ` with limits [${lowerLimit.toFixed(2)}, ${upperLimit.toFixed(2)}]`
          : "";
      toast.success(result.message ?? `Updated joint "${jointName}" type to ${newType}${limitMsg}`);
    },
    [updateUrdfFile, vizUrdfContent]
  );

  const handleJointVelocityChange = useCallback(
    (jointName: string, velocity: number | null) => {
      if (!vizUrdfContent) {
        toast.error("No URDF content available");
        return;
      }
      const result = changeJointVelocity(vizUrdfContent, jointName, velocity);
      if (!result.success) {
        toast.error(result.error ?? `Failed to update joint "${jointName}" velocity`);
        return;
      }

      updateUrdfFile(result.content);
      toast.success(result.message ?? `Updated joint "${jointName}" velocity`);
    },
    [updateUrdfFile, vizUrdfContent]
  );

  const handleJointEffortChange = useCallback(
    (jointName: string, effort: number | null) => {
      if (!vizUrdfContent) {
        toast.error("No URDF content available");
        return;
      }
      const result = changeJointEffort(vizUrdfContent, jointName, effort);
      if (!result.success) {
        toast.error(result.error ?? `Failed to update joint "${jointName}" effort`);
        return;
      }

      updateUrdfFile(result.content);
      toast.success(result.message ?? `Updated joint "${jointName}" effort`);
    },
    [updateUrdfFile, vizUrdfContent]
  );

  const handleJointLimitsChange = useCallback(
    (jointName: string, lowerLimit?: number | null, upperLimit?: number | null) => {
      if (!vizUrdfContent) {
        toast.error("No URDF content available");
        return;
      }
      const error = getJointLimitsError(lowerLimit, upperLimit, jointName);
      if (error) {
        toast.error(error);
        return;
      }
      const result = changeJointLimits(vizUrdfContent, jointName, lowerLimit, upperLimit);
      if (!result.success) {
        toast.error(result.error ?? `Failed to update joint "${jointName}" limits`);
        return;
      }

      updateUrdfFile(result.content);
      const currentValue = jointValues[jointName];
      if (
        Number.isFinite(currentValue) &&
        Number.isFinite(lowerLimit) &&
        Number.isFinite(upperLimit)
      ) {
        const clamped = Math.min(upperLimit as number, Math.max(lowerLimit as number, currentValue));
        if (clamped !== currentValue) {
          setJointValue(jointName, clamped, { enforceVelocity: false });
        }
      }
      const cleared = !Number.isFinite(lowerLimit) && !Number.isFinite(upperLimit);
      toast.success(
        result.message ??
          (cleared
            ? `Cleared joint "${jointName}" limits`
            : `Updated joint "${jointName}" limits`)
      );
    },
    [jointValues, setJointValue, updateUrdfFile, vizUrdfContent]
  );

  const handleJointNameChange = useCallback(
    (oldName: string, newName: string) => {
      if (!vizUrdfContent) {
        toast.error("No URDF content available");
        return false;
      }
      const sanitizedName = sanitizeUrdfName(newName);
      if (!sanitizedName) {
        toast.error("Joint name is invalid after sanitization");
        return false;
      }
      if (sanitizedName !== newName) {
        toast.info(`Renamed to valid URDF name: "${sanitizedName}"`);
      }
      const result = renameJoint(vizUrdfContent, oldName, sanitizedName);
      if (!result.success) {
        toast.error(
          result.error ??
            `Failed to rename joint "${oldName}" to "${sanitizedName}". The name may already exist or be invalid.`
        );
        return false;
      }
      updateUrdfFile(result.content);

      // Update availableJoints to reflect the new name
      setAvailableJoints((prev) => prev.map((name) => (name === oldName ? sanitizedName : name)));

      // Update selected joint if it was the one renamed
      if (selectedJoint === oldName) {
        setSelectedJoint(sanitizedName);
      }

      toast.success(result.message ?? `Renamed joint "${oldName}" to "${sanitizedName}"`);
      return true;
    },
    [selectedJoint, setAvailableJoints, setSelectedJoint, updateUrdfFile, vizUrdfContent]
  );

  const handleJointLinkChange = useCallback(
    (jointName: string, parentLink: string, childLink: string) => {
      if (!vizUrdfContent) {
        toast.error("No URDF content available");
        return;
      }
      const validation = validateJointLinkReassignment(
        vizUrdfContent,
        jointName,
        parentLink,
        childLink
      );
      if (!validation.valid) {
        toast.error(
          "error" in validation ? validation.error : "Invalid joint link update"
        );
        return;
      }
      const result = updateJointLinksInUrdf(vizUrdfContent, jointName, parentLink, childLink);
      if (!result.success) {
        toast.error(result.error ?? "Failed to update joint links");
        return;
      }

      updateUrdfFile(result.content);
      toast.success(`Updated links for joint "${jointName}"`);
    },
    [updateUrdfFile, vizUrdfContent]
  );

  const handleResetRotation = useCallback(() => {
    if (!originalVizUrdfContent) {
      toast.error("No original URDF content found");
      return;
    }

    updateUrdfFile(originalVizUrdfContent);
    toast.success("Reset to original loaded file");
  }, [originalVizUrdfContent, updateUrdfFile]);

  return {
    handleVizUrdfChange,
    handleLinkNameChange,
    handleJointAxisChange,
    handleJointOriginChange,
    handleResetAxis,
    handleJointTypeChange,
    handleJointVelocityChange,
    handleJointEffortChange,
    handleJointLimitsChange,
    handleJointNameChange,
    handleJointLinkChange,
    handleResetRotation,
  };
};
