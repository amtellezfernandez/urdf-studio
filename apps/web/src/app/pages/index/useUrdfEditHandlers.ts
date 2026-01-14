import { useCallback } from "react";
import { toast } from "sonner";
import { changeJointAxis, changeJointType, renameJoint, renameLink } from "@/features/urdf";
import type { JointAxisMap, JointLimits } from "@/features/urdf";
import type { Dispatch, SetStateAction } from "react";

type UrdfEditHandlersArgs = {
  vizUrdfContent: string;
  originalVizUrdfContent: string;
  originalJointAxes: JointAxisMap;
  selectedJoint: string | null;
  setSelectedJoint: Dispatch<SetStateAction<string | null>>;
  setAvailableJoints: Dispatch<SetStateAction<string[]>>;
  setJointLimits: Dispatch<SetStateAction<JointLimits>>;
  setJointAxes: Dispatch<SetStateAction<JointAxisMap>>;
  setUrdfFile: Dispatch<SetStateAction<File | null>>;
  setVizUrdfContent: Dispatch<SetStateAction<string>>;
  createUrdfFile: (content: string) => File;
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
  setJointLimits,
  setJointAxes,
  setUrdfFile,
  setVizUrdfContent,
  createUrdfFile,
  updateUrdfFile,
  setUrdfContentVersion,
}: UrdfEditHandlersArgs) => {
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
        const result = renameLink(vizUrdfContent, oldName, newName);
        if (!result.success) {
          toast.error(result.error ?? "Failed to update link name");
          return;
        }

        updateUrdfFile(result.content);
        toast.success(result.message ?? `Renamed link "${oldName}" to "${newName}"`);
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

      // Immediately update all state synchronously for consistency with other handlers
      // This ensures immediate UI updates without deferred transitions that could cause conflicts
      setVizUrdfContent(result.content);
      if (result.jointLimits) {
        setJointLimits(result.jointLimits);
      }
      if (result.jointAxes) {
        setJointAxes(result.jointAxes);
      }
      setUrdfFile(createUrdfFile(result.content));
      setUrdfContentVersion((prev) => prev + 1); // Force reload of 3D viewer and sidebar

      toast.success(result.message ?? `Updated axis for joint "${jointName}"`);
    },
    [
      createUrdfFile,
      setJointAxes,
      setJointLimits,
      setUrdfContentVersion,
      setUrdfFile,
      setVizUrdfContent,
      vizUrdfContent,
    ]
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
      if (result.jointLimits) {
        setJointLimits(result.jointLimits);
      }
      if (result.jointAxes) {
        setJointAxes(result.jointAxes);
      }
      const limitMsg =
        lowerLimit !== undefined && upperLimit !== undefined
          ? ` with limits [${lowerLimit.toFixed(2)}, ${upperLimit.toFixed(2)}]`
          : "";
      toast.success(result.message ?? `Updated joint "${jointName}" type to ${newType}${limitMsg}`);
    },
    [setJointAxes, setJointLimits, updateUrdfFile, vizUrdfContent]
  );

  const handleJointNameChange = useCallback(
    (oldName: string, newName: string) => {
      if (!vizUrdfContent) {
        toast.error("No URDF content available");
        return;
      }
      const result = renameJoint(vizUrdfContent, oldName, newName);
      if (!result.success) {
        toast.error(
          result.error ??
            `Failed to rename joint "${oldName}" to "${newName}". The name may already exist or be invalid.`
        );
        return;
      }
      updateUrdfFile(result.content);

      // Update availableJoints to reflect the new name
      setAvailableJoints((prev) => prev.map((name) => (name === oldName ? newName : name)));

      // Update selected joint if it was the one renamed
      if (selectedJoint === oldName) {
        setSelectedJoint(newName);
      }

      toast.success(result.message ?? `Renamed joint "${oldName}" to "${newName}"`);
    },
    [selectedJoint, setAvailableJoints, setSelectedJoint, updateUrdfFile, vizUrdfContent]
  );

  const handleJointLinkChange = useCallback(
    (jointName: string, parentLink: string, childLink: string) => {
      if (!vizUrdfContent) {
        toast.error("No URDF content available");
        return;
      }

      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(vizUrdfContent, "text/xml");

        const parserError = xmlDoc.querySelector("parsererror");
        if (parserError) {
          toast.error("Invalid URDF XML");
          return;
        }

        const joint = xmlDoc.querySelector(`joint[name="${jointName}"]`);
        if (!joint) {
          toast.error(`Joint "${jointName}" not found`);
          return;
        }

        // Preserve joint attributes
        const preservedName = joint.getAttribute("name");
        const preservedType = joint.getAttribute("type");

        // Update or create parent element
        let parentElement = joint.querySelector("parent");
        if (!parentElement) {
          parentElement = xmlDoc.createElement("parent");
          joint.insertBefore(parentElement, joint.firstChild);
        }
        parentElement.setAttribute("link", parentLink);

        // Update or create child element
        let childElement = joint.querySelector("child");
        if (!childElement) {
          childElement = xmlDoc.createElement("child");
          if (parentElement.nextSibling) {
            joint.insertBefore(childElement, parentElement.nextSibling);
          } else {
            joint.appendChild(childElement);
          }
        }
        childElement.setAttribute("link", childLink);

        // Restore preserved attributes
        if (preservedName) {
          joint.setAttribute("name", preservedName);
        }
        if (preservedType) {
          joint.setAttribute("type", preservedType);
        }

        // Serialize back
        const serializer = new XMLSerializer();
        const newContent = serializer.serializeToString(xmlDoc);

        updateUrdfFile(newContent);
        toast.success(`Updated links for joint "${jointName}"`);
      } catch (error) {
        console.error("Error updating joint links:", error);
        toast.error("Failed to update joint links");
      }
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
    handleResetAxis,
    handleJointTypeChange,
    handleJointNameChange,
    handleJointLinkChange,
    handleResetRotation,
  };
};
