import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BlenderPanel, BlenderPropertyRow } from "@/components/ui/blender-panel";
import { Eye, EyeOff, Info, Trash2 } from "lucide-react";
import {
  autoFitCollisionGeometry,
  computeMeshBounds,
  findMeshFile,
  updateCollisionInLink,
  type CollisionData,
  type LinkData,
} from "@/features/urdf";
import { toast } from "sonner";
import { useDeferredUrdfUpdate } from "@/components/link-editor/useDeferredUrdfUpdate";
import {
  formatVector3,
  parseVector3,
  updateVector3Value,
} from "@/components/link-editor/sizeUtils";
import { Vector3Inputs } from "@/components/link-editor/Vector3Inputs";

interface CollisionControlProps {
  linkName: string;
  collision: CollisionData;
  index: number;
  urdfContent?: string;
  onUrdfChange?: (newContent: string) => void;
  onRemove: () => void;
  linkData: LinkData;
  meshFiles?: Record<string, Blob>;
  isVisible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

export const CollisionControl = ({
  linkName,
  collision,
  index,
  linkData,
  urdfContent,
  onUrdfChange,
  meshFiles = {},
  onRemove,
  isVisible = false,
  onVisibilityChange,
}: CollisionControlProps) => {
  const [geometryType, setGeometryType] = useState<"box" | "sphere" | "cylinder" | "mesh">(
    collision.geometry.type || "box"
  );
  const [geometryParams, setGeometryParams] = useState(collision.geometry.params || {});
  const [origin, setOrigin] = useState(collision.origin);
  const [isComputing, setIsComputing] = useState(false);
  const [selectedVisualMeshIndex, setSelectedVisualMeshIndex] = useState<number>(0);
  const [calculationInfo, setCalculationInfo] = useState<{
    meshIndex: number;
    meshFilename: string;
    method: string;
    formula?: string;
  } | null>(null);

  const visualMeshInfo = useMemo(() => {
    if (linkData.visuals.length === 0) return null;
    const visualMeshes = linkData.visuals.filter((v) => v.geometry.type === "mesh");
    if (visualMeshes.length === 0) return null;
    return visualMeshes.map((visual) => ({
      filename: visual.geometry.params.filename || "",
      scale: visual.geometry.params.scale || "1 1 1",
      origin: visual.origin,
    }));
  }, [linkData.visuals]);

  const collisionKey = useMemo(() => {
    return `${linkName}-${index}-${collision.geometry.type}-${JSON.stringify(
      collision.geometry.params
    )}-${JSON.stringify(collision.origin)}`;
  }, [linkName, index, collision.geometry.type, collision.geometry.params, collision.origin]);

  useEffect(() => {
    setGeometryType(collision.geometry.type || "box");
    setGeometryParams(collision.geometry.params || {});
    setOrigin(collision.origin);

    if (visualMeshInfo && visualMeshInfo.length > 1 && collision.geometry.type === "mesh") {
      const currentFilename = collision.geometry.params?.filename || "";
      const matchingIndex = visualMeshInfo.findIndex(
        (mesh) =>
          mesh.filename === currentFilename ||
          mesh.filename.split("/").pop() === currentFilename.split("/").pop()
      );
      if (matchingIndex >= 0) {
        setSelectedVisualMeshIndex(matchingIndex);
      }
    }
  }, [collisionKey, visualMeshInfo, collision.geometry.type, collision.geometry.params, collision.origin]);

  const updateURDF = () => {
    if (!urdfContent || !onUrdfChange) return;
    const newContent = updateCollisionInLink(
      urdfContent,
      linkName,
      index,
      geometryType,
      geometryParams,
      origin
    );
    onUrdfChange(newContent);
  };
  const scheduleUpdate = useDeferredUrdfUpdate(updateURDF);

  const handleGeometryTypeChange = async (
    newType: "box" | "sphere" | "cylinder" | "mesh"
  ) => {
    setCalculationInfo(null);

    let newParams: Record<string, string> = {};
    let newOrigin = { xyz: [0, 0, 0] as [number, number, number], rpy: [0, 0, 0] as [number, number, number] };

    if (newType === "mesh" && visualMeshInfo && visualMeshInfo.length > 0) {
      const meshIndex = Math.min(selectedVisualMeshIndex, visualMeshInfo.length - 1);
      const selectedMesh = visualMeshInfo[meshIndex];
      newParams = {
        filename: selectedMesh.filename,
        scale: selectedMesh.scale,
      };
      newOrigin = selectedMesh.origin;
    } else if (newType === "box" || newType === "sphere" || newType === "cylinder") {
      if (visualMeshInfo && visualMeshInfo.length > 0) {
        await handleAutoFill(newType);
        return;
      } else {
        if (newType === "box") {
          newParams = {
            size: geometryType === "box" && geometryParams.size ? geometryParams.size : "1 1 1",
          };
        } else if (newType === "sphere") {
          newParams = {
            radius:
              geometryType === "sphere" && geometryParams.radius ? geometryParams.radius : "1",
          };
        } else if (newType === "cylinder") {
          newParams = {
            radius:
              geometryType === "cylinder" && geometryParams.radius
                ? geometryParams.radius
                : "1",
            length:
              geometryType === "cylinder" && geometryParams.length
                ? geometryParams.length
                : "1",
          };
        }
      }
    }

    setGeometryType(newType);
    setGeometryParams(newParams);
    setOrigin(newOrigin);

    if (!urdfContent || !onUrdfChange) return;
    const newContent = updateCollisionInLink(
      urdfContent,
      linkName,
      index,
      newType,
      newParams,
      newOrigin
    );
    onUrdfChange(newContent);
  };

  const handleAutoFill = async (type: "box" | "sphere" | "cylinder" | "capsule") => {
    if (!visualMeshInfo || visualMeshInfo.length === 0 || !onUrdfChange) {
      toast.error("No visual mesh found");
      return;
    }

    setIsComputing(true);
    try {
      const meshIndex = Math.min(selectedVisualMeshIndex, visualMeshInfo.length - 1);
      const selectedMeshInfo = visualMeshInfo[meshIndex];

      const meshFile = findMeshFile(selectedMeshInfo.filename, meshFiles);
      if (!meshFile) {
        toast.error(`Mesh file not found: ${selectedMeshInfo.filename}`);
        return;
      }

      const bounds = await computeMeshBounds(meshFile, selectedMeshInfo.scale);
      if (!bounds) {
        toast.error("Failed to compute mesh bounds");
        return;
      }

      const fitResult = autoFitCollisionGeometry(bounds, selectedMeshInfo.origin, type);
      if (!fitResult) {
        toast.error("Failed to compute collision geometry");
        return;
      }

      if (fitResult.warning) {
        if (type === "capsule") {
          toast.info(fitResult.warning);
        } else {
          toast.warning(fitResult.warning, { duration: 5000 });
        }
      }

      setGeometryType(fitResult.geometryType);
      setGeometryParams(fitResult.geometryParams);
      setOrigin(fitResult.origin);

      const meshFilename = selectedMeshInfo.filename.split("/").pop() || selectedMeshInfo.filename;
      setCalculationInfo({
        meshIndex,
        meshFilename,
        method: fitResult.method,
        formula: fitResult.formula,
      });

      const newContent = updateCollisionInLink(
        urdfContent!,
        linkName,
        index,
        fitResult.geometryType,
        fitResult.geometryParams,
        fitResult.origin
      );
      onUrdfChange(newContent);

      const meshLabel = visualMeshInfo.length > 1 ? ` (from Visual Mesh ${meshIndex + 1})` : "";
      toast.success(`Computed ${type} collision geometry${meshLabel}`);
    } catch (error) {
      console.error("Error auto-filling collision:", error);
      toast.error("Failed to auto-fill collision");
    } finally {
      setIsComputing(false);
    }
  };

  const handleParamChange = (key: string, value: string) => {
    setGeometryParams({ ...geometryParams, [key]: value });
    setCalculationInfo(null);
    scheduleUpdate();
  };

  const handleOriginChange = (field: "xyz" | "rpy", index: number, value: number) => {
    setOrigin((prev) => ({
      ...prev,
      [field]: updateVector3Value(prev[field], index, value),
    }));
    setCalculationInfo(null);
    scheduleUpdate();
  };

  const sizeValues = parseVector3(geometryParams.size || "1 1 1");
  const scaleValues = parseVector3(geometryParams.scale || "1 1 1");

  return (
    <BlenderPanel
      title={
        <div className="flex items-center justify-between w-full pr-2">
          <span>Collision {index + 1}</span>
          {onVisibilityChange && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onVisibilityChange(!isVisible);
              }}
              className="h-4 w-4 flex items-center justify-center hover:bg-muted/50 rounded transition-colors flex-shrink-0"
              title={isVisible ? "Hide collision in visualizer" : "Show collision in visualizer"}
            >
              {isVisible ? (
                <Eye className="w-3 h-3 text-primary" />
              ) : (
                <EyeOff className="w-3 h-3 text-muted-foreground" />
              )}
            </button>
          )}
        </div>
      }
      defaultOpen={false}
      className="mb-0.5"
    >
      <div className="space-y-0.5">
        <BlenderPropertyRow label="Geometry Type">
          <Select value={geometryType} onValueChange={handleGeometryTypeChange}>
            <SelectTrigger className="h-6 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="box">Box</SelectItem>
              <SelectItem value="sphere">Sphere</SelectItem>
              <SelectItem value="cylinder">Cylinder</SelectItem>
              <SelectItem value="mesh">Mesh</SelectItem>
            </SelectContent>
          </Select>
        </BlenderPropertyRow>

        {calculationInfo && (
          <div className="px-1 py-0.5 bg-muted/10 rounded-sm border border-border/15">
            <div className="flex items-start gap-1 mb-0.5">
              <Info className="w-2.5 h-2.5 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-semibold text-foreground mb-0.5">
                  Calculated from Mesh
                </div>
                <div className="text-[8px] text-muted-foreground">
                  {visualMeshInfo && visualMeshInfo.length > 1
                    ? `Visual Mesh ${calculationInfo.meshIndex + 1}: ${calculationInfo.meshFilename}`
                    : calculationInfo.meshFilename}
                </div>
              </div>
            </div>
            <div className="px-2.5 space-y-0.5">
              <div className="text-[8px] font-medium text-foreground/90">
                Method: {calculationInfo.method}
              </div>
              {calculationInfo.formula && (
                <div className="text-[7px] text-muted-foreground font-mono bg-background/50 px-1 py-0.5 rounded border border-border/20 whitespace-pre-wrap">
                  {calculationInfo.formula}
                </div>
              )}
            </div>
          </div>
        )}

        {geometryType === "box" && (
          <BlenderPropertyRow label="Size">
            <Vector3Inputs
              values={sizeValues}
              onChange={(i, newVal) => {
                const nextSize = updateVector3Value(sizeValues, i, newVal);
                handleParamChange("size", formatVector3(nextSize));
              }}
              step={0.01}
              min={0.001}
            />
          </BlenderPropertyRow>
        )}

        {geometryType === "sphere" && (
          <BlenderPropertyRow label="Radius">
            <NumberInput
              value={parseFloat(geometryParams.radius || "1")}
              onValueChange={(val) => handleParamChange("radius", String(val))}
              step={0.01}
              min={0.001}
              compact
              className="w-20"
            />
          </BlenderPropertyRow>
        )}

        {geometryType === "cylinder" && (
          <>
            <BlenderPropertyRow label="Radius">
              <NumberInput
                value={parseFloat(geometryParams.radius || "1")}
                onValueChange={(val) => handleParamChange("radius", String(val))}
                step={0.01}
                min={0.001}
                compact
                className="w-20"
              />
            </BlenderPropertyRow>
            <BlenderPropertyRow label="Length">
              <NumberInput
                value={parseFloat(geometryParams.length || "1")}
                onValueChange={(val) => handleParamChange("length", String(val))}
                step={0.01}
                min={0.001}
                compact
                className="w-20"
              />
            </BlenderPropertyRow>
          </>
        )}

        {geometryType === "mesh" && (
          <>
            {visualMeshInfo && visualMeshInfo.length > 1 && (
              <BlenderPropertyRow label="Visual Mesh">
                <Select
                  value={String(selectedVisualMeshIndex)}
                  onValueChange={(value) => {
                    const newIndex = parseInt(value, 10);
                    setSelectedVisualMeshIndex(newIndex);
                    const selectedMesh = visualMeshInfo[newIndex];
                    handleParamChange("filename", selectedMesh.filename);
                    handleParamChange("scale", selectedMesh.scale);
                    setOrigin(selectedMesh.origin);
                    updateURDF();
                  }}
                >
                  <SelectTrigger className="h-6 text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {visualMeshInfo.map((mesh, idx) => (
                      <SelectItem key={idx} value={String(idx)} className="text-[10px]">
                        Visual Mesh {idx + 1}{" "}
                        {mesh.filename ? `(${mesh.filename.split("/").pop()})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </BlenderPropertyRow>
            )}
            <BlenderPropertyRow label="Filename">
              <Input
                value={geometryParams.filename || ""}
                onChange={(e) => handleParamChange("filename", e.target.value)}
                className="h-6 text-[10px]"
                placeholder="model.stl"
              />
            </BlenderPropertyRow>
            <BlenderPropertyRow label="Scale">
              <Vector3Inputs
                values={scaleValues}
                onChange={(i, newVal) => {
                  const nextScale = updateVector3Value(scaleValues, i, newVal);
                  handleParamChange("scale", formatVector3(nextScale));
                }}
                step={0.01}
                min={0.001}
              />
            </BlenderPropertyRow>
          </>
        )}

        <BlenderPropertyRow label="Origin XYZ">
          <Vector3Inputs
            values={origin.xyz}
            onChange={(i, newVal) => handleOriginChange("xyz", i, newVal)}
            step={0.01}
          />
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin RPY">
          <Vector3Inputs
            values={origin.rpy}
            onChange={(i, newVal) => handleOriginChange("rpy", i, newVal)}
            step={0.01}
          />
        </BlenderPropertyRow>

        {onUrdfChange && (
          <div className="pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[9px] text-destructive w-full"
              onClick={onRemove}
            >
              <Trash2 className="w-2.5 h-2.5 mr-0.5" />
              Remove
            </Button>
          </div>
        )}
      </div>
    </BlenderPanel>
  );
};
