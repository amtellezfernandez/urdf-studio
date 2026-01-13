import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { BlenderPropertyRow } from "@/components/ui/blender-panel";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { AlertTriangle, Calculator } from "lucide-react";
import { updateInertialInLink, type InertialData } from "@/features/urdf";
import { toast } from "sonner";

interface InertialControlProps {
  linkName: string;
  inertial: InertialData;
  urdfContent?: string;
  onUrdfChange?: (newContent: string) => void;
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

export const InertialControl = ({
  linkName,
  inertial,
  urdfContent,
  onUrdfChange,
}: InertialControlProps) => {
  const [mass, setMass] = useState(inertial.mass);
  const [origin, setOrigin] = useState(inertial.origin);
  const [inertia, setInertia] = useState(inertial.inertia);

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

  const handleMassChange = (newMass: number) => {
    setMass(newMass);
    setTimeout(updateURDF, 0);
  };

  const handleOriginChange = (field: "xyz" | "rpy", index: number, value: number) => {
    const newOrigin = { ...origin };
    newOrigin[field][index] = value;
    setOrigin(newOrigin);
    setTimeout(updateURDF, 0);
  };

  const handleInertiaChange = (key: keyof typeof inertia, value: number) => {
    setInertia({ ...inertia, [key]: value });
    setTimeout(updateURDF, 0);
  };

  const handleComputeFromMesh = () => {
    toast.info("Mesh-based inertia computation coming soon");
  };

  const inertiaTooltips: Record<string, string> = {
    ixx: "Moment of inertia about X-axis (rotation around X)",
    ixy: "Product of inertia (XY coupling term)",
    ixz: "Product of inertia (XZ coupling term)",
    iyy: "Moment of inertia about Y-axis (rotation around Y)",
    iyz: "Product of inertia (YZ coupling term)",
    izz: "Moment of inertia about Z-axis (rotation around Z)",
  };

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

        <BlenderPropertyRow label="Origin XYZ">
          <div className="flex items-center gap-1">
            {origin.xyz.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("xyz", i, newVal)}
                step={0.01}
                compact
                className="w-16"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        <BlenderPropertyRow label="Origin RPY">
          <div className="flex items-center gap-1">
            {origin.rpy.map((val, i) => (
              <NumberInput
                key={i}
                value={val}
                onValueChange={(newVal) => handleOriginChange("rpy", i, newVal)}
                step={0.01}
                compact
                className="w-16"
              />
            ))}
          </div>
        </BlenderPropertyRow>

        <div className="space-y-1 pt-1 border-t border-border/20">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase">
              Inertia Tensor
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={handleComputeFromMesh}
              title="Compute inertia from mesh geometry"
            >
              <Calculator className="w-3 h-3 mr-1" />
              Compute from Mesh
            </Button>
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

            <div className="grid grid-cols-4 gap-1 items-center">
              <div className="text-[10px] text-muted-foreground font-semibold">X</div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.ixx}
                      onValueChange={(val) => handleInertiaChange("ixx", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.ixx}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.ixy}
                      onValueChange={(val) => handleInertiaChange("ixy", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.ixy}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.ixz}
                      onValueChange={(val) => handleInertiaChange("ixz", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.ixz}</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="grid grid-cols-4 gap-1 items-center">
              <div className="text-[10px] text-muted-foreground font-semibold">Y</div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.ixy}
                      onValueChange={(val) => handleInertiaChange("ixy", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.ixy}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.iyy}
                      onValueChange={(val) => handleInertiaChange("iyy", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.iyy}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.iyz}
                      onValueChange={(val) => handleInertiaChange("iyz", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.iyz}</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="grid grid-cols-4 gap-1 items-center">
              <div className="text-[10px] text-muted-foreground font-semibold">Z</div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.ixz}
                      onValueChange={(val) => handleInertiaChange("ixz", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.ixz}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.iyz}
                      onValueChange={(val) => handleInertiaChange("iyz", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.iyz}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NumberInput
                      value={inertia.izz}
                      onValueChange={(val) => handleInertiaChange("izz", val)}
                      step={0.0001}
                      compact
                      className="w-full"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{inertiaTooltips.izz}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};
