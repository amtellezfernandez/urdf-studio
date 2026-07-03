import { useEffect, useState } from "react";
import { Input } from "@/shared/ui/input";
import { BlenderPanel, BlenderPropertyRow } from "@/shared/ui/blender-panel";
import { updateVisualInLink } from "@/features/urdf/editor/updateLinkData";
import type { LinkData, VisualData } from "@/shared/lib/urdfBrowser";
import { useDeferredUrdfUpdate } from "@/features/urdf/editor/link-editor/useDeferredUrdfUpdate";
import { GeometryParamsMeshFields } from "@/features/urdf/editor/link-editor/MeshGeometryFields";
import { toast } from "sonner";
import {
  createGeometryParamChangeHandler,
  createOriginChangeHandler,
} from "@/features/urdf/editor/link-editor/geometryFieldHelpers";
import { LinkEditorRemoveButton } from "@/features/urdf/editor/link-editor/LinkEditorRemoveButton";

interface VisualControlProps {
  linkName: string;
  visual: VisualData;
  index: number;
  linkData: LinkData;
  urdfContent?: string;
  onMaterialChange?: (linkName: string, materialName: string, color: string) => void;
  onUrdfChange?: (newContent: string) => void;
  onRemove: () => void;
}

export const VisualControl = ({
  linkName,
  visual,
  index,
  linkData,
  urdfContent,
  onMaterialChange,
  onUrdfChange,
  onRemove,
}: VisualControlProps) => {
  const [geometryParams, setGeometryParams] = useState(
    visual.geometry.params || { filename: "", scale: "1 1 1" }
  );
  const [origin, setOrigin] = useState(visual.origin);
  const [currentColor, setCurrentColor] = useState(visual.materialColor || "#cccccc");

  useEffect(() => {
    setGeometryParams(visual.geometry.params || { filename: "", scale: "1 1 1" });
    setOrigin(visual.origin);
    setCurrentColor(visual.materialColor || "#cccccc");
  }, [visual]);

  const updateURDF = () => {
    if (!urdfContent || !onUrdfChange) return;
    const newContent = updateVisualInLink(
      urdfContent,
      linkName,
      index,
      "mesh",
      geometryParams,
      origin,
      currentColor
    );
    onUrdfChange(newContent);
  };
  const scheduleUpdate = useDeferredUrdfUpdate(updateURDF);

  const handleParamChange = createGeometryParamChangeHandler(
    geometryParams,
    setGeometryParams,
    scheduleUpdate,
    {
      onInvalidPath: toast.error,
    }
  );

  const handleOriginChange = createOriginChangeHandler(setOrigin, scheduleUpdate);

  const handleColorChange = (newColor: string) => {
    setCurrentColor(newColor);
    if (onMaterialChange) {
      const materialName = `material_${linkName}`;
      onMaterialChange(linkName, materialName, newColor);
    }
    scheduleUpdate();
  };

  const title =
    linkData.visuals.length === 1 ? "Visual (Mesh)" : `Visual ${index + 1} (Mesh)`;
  return (
    <BlenderPanel title={title} defaultOpen={true} className="mb-0.5">
      <div className="space-y-0.5">
        <GeometryParamsMeshFields
          geometryParams={geometryParams}
          onParamChange={handleParamChange}
          origin={origin}
          onOriginChange={handleOriginChange}
          filenamePlaceholder="meshes/model.stl (or .glb/.gltf)"
          scaleStep={0.0001}
          scaleMin={0.0001}
          originStep={0.01}
          vectorClassName="gap-0.5"
          vectorInputClassName="w-14"
          originGapClassName="gap-0.5"
          originInputClassName="w-14"
        />

        {onMaterialChange && (
          <BlenderPropertyRow label="Color">
            <div className="flex items-center gap-1">
              <input
                type="color"
                value={currentColor}
                onChange={(e) => handleColorChange(e.target.value)}
                className="h-6 w-14 cursor-pointer rounded border border-border/20 bg-input"
              />
              <Input
                type="text"
                value={currentColor}
                onChange={(e) => {
                  const newColor = e.target.value;
                  if (/^#[0-9A-Fa-f]{6}$/.test(newColor)) {
                    handleColorChange(newColor);
                  } else {
                    setCurrentColor(newColor);
                  }
                }}
                className="h-6 w-18 text-[10px] font-mono"
                placeholder="#cccccc"
              />
            </div>
          </BlenderPropertyRow>
        )}

        {visual.materialTexture && (
          <BlenderPropertyRow label="Texture">
            <Input
              type="text"
              value={visual.materialTexture}
              readOnly
              className="h-6 text-[10px] font-mono"
            />
          </BlenderPropertyRow>
        )}

        {onUrdfChange && (
          <LinkEditorRemoveButton label="Remove Visual" onRemove={onRemove} />
        )}
      </div>
    </BlenderPanel>
  );
};
