import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { BlenderPanel, BlenderPropertyRow } from "@/components/ui/blender-panel";
import { updateVisualInLink, type LinkData, type VisualData } from "@/features/urdf";
import { useDeferredUrdfUpdate } from "@/components/link-editor/useDeferredUrdfUpdate";

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
    const newOrigin = { ...origin };
    newOrigin[field][index] = value;
    setOrigin(newOrigin);
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

  const parseSize = (sizeStr: string): [number, number, number] => {
    const parts = sizeStr.split(" ").map(parseFloat);
    return [parts[0] || 1, parts[1] || 1, parts[2] || 1];
  };

  const formatSize = (size: [number, number, number]): string => {
    return `${size[0]} ${size[1]} ${size[2]}`;
  };

  const title =
    linkData.visuals.length === 1 ? "Visual (Mesh)" : `Visual ${index + 1} (Mesh)`;

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
          <div className="flex items-center gap-0.5">
            {parseSize(geometryParams.scale || "1 1 1").map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => {
                  const scale = parseSize(geometryParams.scale || "1 1 1");
                  scale[i] = newVal;
                  handleParamChange("scale", formatSize(scale));
                }}
                step={0.0001}
                min={0.0001}
                compact
                className="w-14"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin XYZ">
          <div className="flex items-center gap-0.5">
            {origin.xyz.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("xyz", i, newVal)}
                step={0.01}
                compact
                className="w-14"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin RPY">
          <div className="flex items-center gap-0.5">
            {origin.rpy.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("rpy", i, newVal)}
                step={0.01}
                compact
                className="w-14"
              />
            ))}
          </div>
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
