import { useCallback } from "react";
import { toast } from "sonner";
import { updateMaterialColorInUrdf } from "@/shared/lib/urdfCore";

type UseUrdfMaterialHandlersArgs = {
  vizUrdfContent: string;
  updateUrdfFile: (content: string) => void;
};

export const useUrdfMaterialHandlers = ({
  vizUrdfContent,
  updateUrdfFile,
}: UseUrdfMaterialHandlersArgs) => {
  const handleMaterialChange = useCallback(
    (linkName: string, materialName: string, color: string) => {
      if (!vizUrdfContent) {
        toast.error("No URDF content available");
        return;
      }
      const result = updateMaterialColorInUrdf(vizUrdfContent, linkName, materialName, color);
      if (!result.success) {
        toast.error(result.error ?? "Failed to update material");
        return;
      }
      updateUrdfFile(result.content);
      toast.success(`Updated material for link "${linkName}"`);
    },
    [updateUrdfFile, vizUrdfContent]
  );

  return { handleMaterialChange };
};
