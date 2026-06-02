import { useEffect, useMemo, useState } from "react";
import { NumberInput } from "@/shared/ui/number-input";
import { BlenderPropertyRow } from "@/shared/ui/blender-panel";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/shared/ui/tooltip";
import { AlertTriangle } from "lucide-react";
import { updateInertialInLink } from "@/features/urdf/editor/updateLinkData";
import type { InertialData } from "@/shared/lib/urdfBrowser";
import { useDeferredUrdfUpdate } from "@/features/urdf/editor/link-editor/useDeferredUrdfUpdate";
import { OriginRows } from "@/features/urdf/editor/link-editor/OriginRows";
import { createOriginChangeHandler } from "@/features/urdf/editor/link-editor/geometryFieldHelpers";
import { InertialDraftGeneratorControls } from "@/features/urdf/editor/link-editor/InertialDraftGeneratorControls";
import {
  INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID,
  type InertialDensityPresetId,
} from "@/features/urdf/inertia/inertialSynthesisParams";

interface InertialControlProps {
  linkName: string;
  inertial: InertialData;
  urdfContent?: string;
  onUrdfChange?: (newContent: string) => void;
  onGenerateFromGeometry?: (linkName: string, densityPresetId: InertialDensityPresetId) => void;
  voxelDerived?: boolean;
}

type InertiaTensor = {
  ixx: number;
  ixy: number;
  ixz: number;
  iyy: number;
  iyz: number;
  izz: number;
};

const validateInertia = (inertia: InertiaTensor): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (inertia.ixx <= 0) errors.push("Ixx must be positive");
  if (inertia.iyy <= 0) errors.push("Iyy must be positive");
  if (inertia.izz <= 0) errors.push("Izz must be positive");

  const det2x2_xy = inertia.ixx * inertia.iyy - inertia.ixy * inertia.ixy;
  const det2x2_xz = inertia.ixx * inertia.izz - inertia.ixz * inertia.ixz;
  const det2x2_yz = inertia.iyy * inertia.izz - inertia.iyz * inertia.iyz;

  if (det2x2_xy <= 0) errors.push("Ixx*Iyy - Ixy² must be positive");
  if (det2x2_xz <= 0) errors.push("Ixx*Izz - Ixz² must be positive");
  if (det2x2_yz <= 0) errors.push("Iyy*Izz - Iyz² must be positive");

  const det3x3 =
    inertia.ixx * (inertia.iyy * inertia.izz - inertia.iyz * inertia.iyz) -
    inertia.ixy * (inertia.ixy * inertia.izz - inertia.ixz * inertia.iyz) +
    inertia.ixz * (inertia.ixy * inertia.iyz - inertia.iyy * inertia.ixz);

  if (det3x3 <= 0) errors.push("Full inertia matrix determinant must be positive");

  return { isValid: errors.length === 0, errors };
};

type InertiaKey = keyof InertiaTensor;

export const InertialControl = ({
  linkName,
  inertial,
  urdfContent,
  onUrdfChange,
  onGenerateFromGeometry,
  voxelDerived = false,
}: InertialControlProps) => {
  const [mass, setMass] = useState(inertial.mass);
  const [origin, setOrigin] = useState(inertial.origin);
  const [inertia, setInertia] = useState(inertial.inertia);
  const [densityPresetId, setDensityPresetId] = useState<InertialDensityPresetId>(
    INERTIAL_SYNTHESIS_DEFAULT_DENSITY_PRESET_ID
  );

  useEffect(() => {
    setMass(inertial.mass);
    setOrigin(inertial.origin);
    setInertia(inertial.inertia);
  }, [inertial]);

  const validation = useMemo(() => validateInertia(inertia), [inertia]);

  const updateURDF = () => {
    if (!urdfContent || !onUrdfChange) return;
    const newContent = updateInertialInLink(urdfContent, linkName, mass, inertia, origin);
    onUrdfChange(newContent);
  };
  const scheduleUpdate = useDeferredUrdfUpdate(updateURDF);

  const handleMassChange = (newMass: number) => {
    setMass(newMass);
    scheduleUpdate();
  };

  const handleOriginChange = createOriginChangeHandler(setOrigin, scheduleUpdate);

  const handleInertiaChange = (key: keyof typeof inertia, value: number) => {
    setInertia({ ...inertia, [key]: value });
    scheduleUpdate();
  };

  const handleComputeFromGeometry = () => {
    onGenerateFromGeometry?.(linkName, densityPresetId);
  };

  const inertiaTooltips: Record<InertiaKey, string> = {
    ixx: "Moment of inertia about X-axis (rotation around X)",
    ixy: "Product of inertia (XY coupling term)",
    ixz: "Product of inertia (XZ coupling term)",
    iyy: "Moment of inertia about Y-axis (rotation around Y)",
    iyz: "Product of inertia (YZ coupling term)",
    izz: "Moment of inertia about Z-axis (rotation around Z)",
  };

  const inertiaRows: { label: string; keys: InertiaKey[] }[] = [
    { label: "X", keys: ["ixx", "ixy", "ixz"] },
    { label: "Y", keys: ["ixy", "iyy", "iyz"] },
    { label: "Z", keys: ["ixz", "iyz", "izz"] },
  ];

  return (
    <TooltipProvider>
      <div className="space-y-1">
        <BlenderPropertyRow label="Mass">
          <NumberInput
            value={mass}
            onValueChange={handleMassChange}
            step={0.01}
            min={0.001}
            compact
            className="w-20"
          />
        </BlenderPropertyRow>

        <OriginRows origin={origin} onChange={handleOriginChange} step={0.01} />

        <div className="space-y-1 pt-1 border-t border-border/20">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                Inertia Tensor
              </span>
              {voxelDerived ? (
                <span
                  className="rounded-sm border border-cyan-500/40 bg-cyan-500/15 px-1 py-0.5 text-[9px] font-medium uppercase tracking-[0.04em] text-cyan-200"
                  title="This staged inertial draft used volumetric voxel fallback for this link."
                >
                  Voxel-Derived
                </span>
              ) : null}
            </div>
            {onGenerateFromGeometry ? (
              <InertialDraftGeneratorControls
                densityPresetId={densityPresetId}
                onDensityPresetChange={setDensityPresetId}
                onGenerate={handleComputeFromGeometry}
              />
            ) : null}
          </div>

          {!validation.isValid && (
            <div className="mb-2 p-2 bg-destructive/10 border border-destructive/30 rounded text-[10px] text-destructive">
              <div className="flex items-center gap-1 mb-1">
                <AlertTriangle className="w-3 h-3" />
                <span className="font-semibold">Invalid Inertia Tensor</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 ml-4">
                {validation.errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1">
            <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground font-semibold">
              <div></div>
              <div className="text-center">X</div>
              <div className="text-center">Y</div>
              <div className="text-center">Z</div>
            </div>

            {inertiaRows.map((row) => (
              <div key={row.label} className="grid grid-cols-4 gap-1 items-center">
                <div className="text-[10px] text-muted-foreground font-semibold">{row.label}</div>
                {row.keys.map((key) => (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <div>
                        <NumberInput
                          value={inertia[key]}
                          onValueChange={(val) => handleInertiaChange(key, val)}
                          step={0.0001}
                          compact
                          className="w-full"
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{inertiaTooltips[key]}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};
