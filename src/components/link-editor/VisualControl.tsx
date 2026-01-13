import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { BlenderPanel, BlenderPropertyRow } from "@/components/ui/blender-panel";
import { updateVisualInLink, type LinkData, type VisualData } from "@/features/urdf";
import { useDeferredUrdfUpdate } from "@/components/link-editor/useDeferredUrdfUpdate";
import {
  formatVector3,
  parseVector3,
  updateVector3Value,
} from "@/components/link-editor/sizeUtils";
import { Vector3Inputs } from "@/components/link-editor/Vector3Inputs";

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

  const handleParamChange = (key: string, value: string) => {
    setGeometryParams({ ...geometryParams, [key]: value });
    scheduleUpdate();
  };

  const handleOriginChange = (field: "xyz" | "rpy", index: number, value: number) => {
    setOrigin((prev) => ({
      ...prev,
      [field]: updateVector3Value(prev[field], index, value),
    }));
    scheduleUpdate();
  };

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
  const scaleValues = parseVector3(geometryParams.scale || "1 1 1");

  return (
    <BlenderPanel title={title} defaultOpen={true} className="mb-0.5">
      <div className="space-y-0.5">
        <BlenderPropertyRow label="Filename">
          <Input
            value={geometryParams.filename || ""}
            onChange={(e) => handleParamChange("filename", e.target.value)}
            className="h-6 text-[10px]"
            placeholder="meshes/model.stl"
          />
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Scale">
          <Vector3Inputs
            values={scaleValues}
            onChange={(i, newVal) => {
              const nextScale = updateVector3Value(scaleValues, i, newVal);
              handleParamChange("scale", formatVector3(nextScale));
            }}
            step={0.0001}
            min={0.0001}
            className="gap-0.5"
            inputClassName="w-14"
          />
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin XYZ">
          <Vector3Inputs
            values={origin.xyz}
            onChange={(i, newVal) => handleOriginChange("xyz", i, newVal)}
            step={0.01}
            className="gap-0.5"
            inputClassName="w-14"
          />
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin RPY">
          <Vector3Inputs
            values={origin.rpy}
            onChange={(i, newVal) => handleOriginChange("rpy", i, newVal)}
            step={0.01}
            className="gap-0.5"
            inputClassName="w-14"
          />
        </BlenderPropertyRow>

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

      </div>
    </BlenderPanel>
  );
};
