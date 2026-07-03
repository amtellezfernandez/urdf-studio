import { Input } from "@/shared/ui/input";
import { BlenderPropertyRow } from "@/shared/ui/blender-panel";
import { Vector3Inputs } from "@/features/urdf/editor/link-editor/Vector3Inputs";
import {
  formatVector3,
  parseVector3,
  updateVector3Value,
} from "@/features/urdf/editor/link-editor/sizeUtils";
import { OriginRows } from "@/features/urdf/editor/link-editor/OriginRows";
import type { OriginData } from "@/shared/lib/urdfBrowser";

export interface MeshGeometryFieldsProps {
  filename: string;
  scale: string;
  onFilenameChange: (value: string) => void;
  onScaleChange: (value: string) => void;
  origin?: OriginData;
  onOriginChange?: (field: "xyz" | "rpy", index: number, value: number) => void;
  filenamePlaceholder?: string;
  scaleStep?: number;
  scaleMin?: number;
  originStep?: number;
  inputClassName?: string;
  vectorClassName?: string;
  vectorInputClassName?: string;
  originGapClassName?: string;
  originInputClassName?: string;
}

const MeshGeometryFields = ({
  filename,
  scale,
  onFilenameChange,
  onScaleChange,
  origin,
  onOriginChange,
  filenamePlaceholder = "model.stl (or .glb/.gltf)",
  scaleStep = 0.01,
  scaleMin,
  originStep = 0.01,
  inputClassName,
  vectorClassName,
  vectorInputClassName,
  originGapClassName,
  originInputClassName,
}: MeshGeometryFieldsProps) => {
  const scaleValues = parseVector3(scale || "1 1 1");

  return (
    <>
      <BlenderPropertyRow label="Filename">
        <Input
          value={filename}
          onChange={(e) => onFilenameChange(e.target.value)}
          className={inputClassName ?? "h-6 text-[10px]"}
          placeholder={filenamePlaceholder}
        />
      </BlenderPropertyRow>
      <BlenderPropertyRow label="Scale">
        <Vector3Inputs
          values={scaleValues}
          onChange={(i, newVal) => {
            const nextScale = updateVector3Value(scaleValues, i, newVal);
            onScaleChange(formatVector3(nextScale));
          }}
          step={scaleStep}
          min={scaleMin}
          className={vectorClassName}
          inputClassName={vectorInputClassName}
        />
      </BlenderPropertyRow>
      {origin && onOriginChange && (
        <OriginRows
          origin={origin}
          onChange={onOriginChange}
          step={originStep}
          gapClassName={originGapClassName}
          inputClassName={originInputClassName}
        />
      )}
    </>
  );
};

type GeometryParamsMeshFieldsProps = Omit<
  MeshGeometryFieldsProps,
  "filename" | "scale" | "onFilenameChange" | "onScaleChange"
> & {
  geometryParams: Record<string, string>;
  onParamChange: (key: string, value: string) => void;
};

export const GeometryParamsMeshFields = ({
  geometryParams,
  onParamChange,
  ...meshGeometryFieldsProps
}: GeometryParamsMeshFieldsProps) => (
  <MeshGeometryFields
    filename={geometryParams.filename || ""}
    scale={geometryParams.scale || "1 1 1"}
    onFilenameChange={(value) => onParamChange("filename", value)}
    onScaleChange={(value) => onParamChange("scale", value)}
    {...meshGeometryFieldsProps}
  />
);
