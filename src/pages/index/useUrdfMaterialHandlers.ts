import { useCallback } from "react";
import { toast } from "sonner";

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

      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(vizUrdfContent, "text/xml");

        const parserError = xmlDoc.querySelector("parsererror");
        if (parserError) {
          toast.error("Invalid URDF XML");
          return;
        }

        let material = xmlDoc.querySelector(`material[name="${materialName}"]`);
        if (!material) {
          const robot = xmlDoc.querySelector("robot");
          if (!robot) {
            toast.error("No robot tag found in URDF");
            return;
          }
          material = xmlDoc.createElement("material");
          material.setAttribute("name", materialName);
          const colorElement = xmlDoc.createElement("color");
          const r = parseInt(color.slice(1, 3), 16) / 255;
          const g = parseInt(color.slice(3, 5), 16) / 255;
          const b = parseInt(color.slice(5, 7), 16) / 255;
          colorElement.setAttribute("rgba", `${r} ${g} ${b} 1.0`);
          material.appendChild(colorElement);
          robot.appendChild(material);
        } else {
          let colorElement = material.querySelector("color");
          if (!colorElement) {
            colorElement = xmlDoc.createElement("color");
            material.appendChild(colorElement);
          }
          const r = parseInt(color.slice(1, 3), 16) / 255;
          const g = parseInt(color.slice(3, 5), 16) / 255;
          const b = parseInt(color.slice(5, 7), 16) / 255;
          colorElement.setAttribute("rgba", `${r} ${g} ${b} 1.0`);
        }

        const link = xmlDoc.querySelector(`link[name="${linkName}"]`);
        if (!link) {
          toast.error(`Link "${linkName}" not found`);
          return;
        }

        let visual = link.querySelector("visual");
        if (!visual) {
          visual = xmlDoc.createElement("visual");
          const geometry = xmlDoc.createElement("geometry");
          const box = xmlDoc.createElement("box");
          box.setAttribute("size", "0.1 0.1 0.1");
          geometry.appendChild(box);
          visual.appendChild(geometry);
          link.appendChild(visual);
        }

        let materialRef = visual.querySelector("material");
        if (!materialRef) {
          materialRef = xmlDoc.createElement("material");
          visual.appendChild(materialRef);
        }
        materialRef.setAttribute("name", materialName);

        const serializer = new XMLSerializer();
        const newContent = serializer.serializeToString(xmlDoc);

        updateUrdfFile(newContent);
        toast.success(`Updated material for link "${linkName}"`);
      } catch (error) {
        console.error("Error updating material:", error);
        toast.error("Failed to update material");
      }
    },
    [updateUrdfFile, vizUrdfContent]
  );

  return { handleMaterialChange };
};
