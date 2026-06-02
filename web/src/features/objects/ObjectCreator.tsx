import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { NumberInput } from "@/shared/ui/number-input";
import * as THREE from "three";
import { useObjectStore } from "@/features/objects";
import { cn } from "@/shared/lib/utils";
import {
  DEFAULT_ORBIT_INCLINATION,
  DEFAULT_ORBIT_OFFSET,
  DEFAULT_ORBIT_PHASE,
  DEFAULT_ORBIT_RADIUS,
  getDefaultSize,
  suggestPositionFromBoundingBox,
} from "@/features/objects";
import type { ObjectCreatorType } from "@/features/objects/useObjectCreator";

interface ObjectCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  robotBoundingBox?: THREE.Box3 | null;
  defaultType?: ObjectCreatorType;
}

const OBJECT_TYPE_OPTIONS: Array<{
  type: ObjectCreatorType;
  label: string;
  description: string;
  color: string;
}> = [
  { type: "cube", label: "Cube", description: "Box with XYZ size", color: "#3b82f6" },
  { type: "sphere", label: "Sphere", description: "Uniform diameter primitive", color: "#0ea5e9" },
  { type: "cylinder", label: "Cylinder", description: "Round base with height", color: "#14b8a6" },
  { type: "point", label: "Point", description: "Tiny marker target", color: "#f472b6" },
];

export function ObjectCreator({ open, onOpenChange, robotBoundingBox, defaultType = "cube" }: ObjectCreatorProps) {
  const addObject = useObjectStore((state) => state.addObject);

  const [objectType, setObjectType] = useState<ObjectCreatorType>(defaultType);
  const initialSize = getDefaultSize(defaultType);
  const [sizeX, setSizeX] = useState(initialSize.x);
  const [sizeY, setSizeY] = useState(initialSize.y);
  const [sizeZ, setSizeZ] = useState(initialSize.z);

  // Default position
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const [posZ, setPosZ] = useState(0);
  const [ikTargetType, setIkTargetType] = useState<"punctual" | "orbit">("punctual");
  const [orbitRadius, setOrbitRadius] = useState(DEFAULT_ORBIT_RADIUS);
  const [orbitInclination, setOrbitInclination] = useState(DEFAULT_ORBIT_INCLINATION);
  const [orbitPhase, setOrbitPhase] = useState(DEFAULT_ORBIT_PHASE);
  const [orbitOffset, setOrbitOffset] = useState(DEFAULT_ORBIT_OFFSET);

  // Reset defaults when dialog opens or when caller requests a different type
  useEffect(() => {
    if (!open) return;
    setObjectType(defaultType);
    const defaultSize = getDefaultSize(defaultType);
    setSizeX(defaultSize.x);
    setSizeY(defaultSize.y);
    setSizeZ(defaultSize.z);
    setIkTargetType("punctual");
    setOrbitRadius(DEFAULT_ORBIT_RADIUS);
    setOrbitInclination(DEFAULT_ORBIT_INCLINATION);
    setOrbitPhase(DEFAULT_ORBIT_PHASE);
    setOrbitOffset(DEFAULT_ORBIT_OFFSET);
  }, [open, defaultType]);

  // Keep size in sync when switching types inside the dialog
  useEffect(() => {
    const defaultSize = getDefaultSize(objectType);
    setSizeX(defaultSize.x);
    setSizeY(defaultSize.y);
    setSizeZ(defaultSize.z);
  }, [objectType]);

  // Suggest a non-colliding position
  const suggestPosition = () => {
    const pos = suggestPositionFromBoundingBox(robotBoundingBox);
    setPosX(pos.x);
    setPosY(pos.y);
    setPosZ(pos.z);
  };

  const handleCreate = () => {
    const position = new THREE.Vector3(posX, posY, posZ);
    const size = new THREE.Vector3(sizeX, sizeY, sizeZ);
    const selectedOption =
      OBJECT_TYPE_OPTIONS.find((option) => option.type === objectType) ?? OBJECT_TYPE_OPTIONS[0];

    const orbitProps =
      ikTargetType === "orbit"
        ? {
            orbitRadius,
            orbitInclination,
            orbitPhase,
            orbitSecondaryOffset: orbitOffset,
            ikTargetType: "orbit" as const,
          }
        : { ikTargetType: "punctual" as const };

    addObject({
      type: objectType,
      position,
      size,
      color: selectedOption?.color ?? "#3b82f6",
      trackedJointName: null,
      isIkTarget: true,
      ...orbitProps,
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#181818] border-[#303030] text-[#d4d4d4] max-w-sm p-3">
        <DialogHeader className="pb-1">
          <DialogTitle className="text-sm text-[#e5e5e5] font-semibold">Create Object</DialogTitle>
          <DialogDescription className="text-[11px] text-[#8a8a8a]">
            Create a primitive world object and prep IK/orbit semantics.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-1.5">
            {OBJECT_TYPE_OPTIONS.map(({ type, label, description }) => (
              <button
                key={type}
                className={cn(
                  "flex-1 rounded-sm border px-2.5 py-2 text-left text-[12px] transition-colors",
                  objectType === type
                    ? "border-[#4a4a4a] bg-[#222] text-[#f1f1f1]"
                    : "border-[#333] bg-[#1a1a1a] text-[#cfcfcf] hover:border-[#444]"
                )}
                onClick={() => setObjectType(type)}
              >
                <div className="font-semibold">{label}</div>
                <div className="text-[10px] text-[#8a8a8a]">{description}</div>
              </button>
            ))}
          </div>

          {objectType === "cube" ? (
            <div className="space-y-1">
              <Label className="text-[10px] text-[#9d9d9d]">Size (m)</Label>
              <div className="grid grid-cols-3 gap-1.5">
                <NumberInput
                  value={sizeX}
                  onValueChange={setSizeX}
                  step={0.01}
                  min={0.005}
                  compact
                  className="w-full"
                  aria-label="Size X"
                />
                <NumberInput
                  value={sizeY}
                  onValueChange={setSizeY}
                  step={0.01}
                  min={0.005}
                  compact
                  className="w-full"
                  aria-label="Size Y"
                />
                <NumberInput
                  value={sizeZ}
                  onValueChange={setSizeZ}
                  step={0.01}
                  min={0.005}
                  compact
                  className="w-full"
                  aria-label="Size Z"
                />
              </div>
            </div>
          ) : objectType === "sphere" ? (
            <div className="space-y-1">
              <Label className="text-[10px] text-[#9d9d9d]">Diameter (m)</Label>
              <NumberInput
                value={sizeX}
                onValueChange={(value) => {
                  setSizeX(value);
                  setSizeY(value);
                  setSizeZ(value);
                }}
                step={0.01}
                min={0.005}
                compact
                className="w-full"
                aria-label="Sphere diameter"
              />
            </div>
          ) : objectType === "cylinder" ? (
            <div className="space-y-1">
              <Label className="text-[10px] text-[#9d9d9d]">Cylinder Size (m)</Label>
              <div className="grid grid-cols-2 gap-1.5">
                <NumberInput
                  value={sizeX}
                  onValueChange={(value) => {
                    setSizeX(value);
                    setSizeY(value);
                  }}
                  step={0.01}
                  min={0.005}
                  compact
                  className="w-full"
                  aria-label="Cylinder diameter"
                />
                <NumberInput
                  value={sizeZ}
                  onValueChange={setSizeZ}
                  step={0.01}
                  min={0.005}
                  compact
                  className="w-full"
                  aria-label="Cylinder height"
                />
              </div>
            </div>
          ) : (
            <div className="rounded border border-[#3d3d3d] bg-[#1a1a1a] px-3 py-2 text-[11px] text-[#d4d4d4]">
              Point size is fixed by the primitive defaults to keep targets easy to spot.
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-[#9d9d9d]">Position (m)</Label>
              <Button
                onClick={suggestPosition}
                variant="outline"
                size="sm"
                className="h-6 text-[10px] bg-[#161616] border-[#3a3a3a] text-[#9d9d9d] hover:text-[#e0e0e0] hover:bg-[#2a2a2a] px-2 py-0"
              >
                Suggest
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <NumberInput
                value={posX}
                onValueChange={setPosX}
                step={0.01}
                compact
                className="w-full"
                aria-label="Position X"
              />
              <NumberInput
                value={posY}
                onValueChange={setPosY}
                step={0.01}
                compact
                className="w-full"
                aria-label="Position Y"
              />
              <NumberInput
                value={posZ}
                onValueChange={setPosZ}
                step={0.01}
                compact
                className="w-full"
                aria-label="Position Z"
              />
            </div>
          </div>

          <div className="rounded border border-[#323232] bg-[#141414] p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-[10px] text-[#9d9d9d]">IK Mode</Label>
                <div className="text-[11px] text-[#9d9d9d]">
                  Objects are IK targets by default. Switch to orbit only when needed.
                </div>
              </div>
              <span className="text-[10px] uppercase tracking-[0.08em] text-emerald-400">Enabled</span>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                {(["punctual", "orbit"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={cn(
                      "rounded-sm border px-3 py-2 text-left text-[11px] transition-colors",
                      ikTargetType === mode
                        ? "border-[#4a4a4a] bg-[#222] text-[#f1f1f1]"
                        : "border-[#3a3a3a] bg-[#111] text-[#cfcfcf] hover:border-[#4a4a4a]"
                    )}
                    onClick={() => setIkTargetType(mode)}
                  >
                    <div className="text-xs font-semibold capitalize">{mode}</div>
                    <div className="text-[10px] text-[#9d9d9d]">
                      {mode === "punctual" ? "Use the exact position" : "Follow a small orbit path"}
                    </div>
                  </button>
                ))}
              </div>

              {ikTargetType === "orbit" && (
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-[#9d9d9d]">Radius (m)</Label>
                    <NumberInput
                      value={orbitRadius}
                      onValueChange={setOrbitRadius}
                      step={0.01}
                      min={0.01}
                      compact
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-[#9d9d9d]">Inclination (°)</Label>
                    <NumberInput
                      value={orbitInclination}
                      onValueChange={setOrbitInclination}
                      step={5}
                      min={-90}
                      max={90}
                      compact
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-[#9d9d9d]">Phase (°)</Label>
                    <NumberInput
                      value={orbitPhase}
                      onValueChange={(val) => setOrbitPhase(((val % 360) + 360) % 360)}
                      step={15}
                      min={0}
                      max={360}
                      compact
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-[#9d9d9d]">Arc Offset (°)</Label>
                    <NumberInput
                      value={orbitOffset}
                      onValueChange={(val) => setOrbitOffset(((val % 360) + 360) % 360)}
                      step={15}
                      min={0}
                      max={360}
                      compact
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-1.5 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-8 text-[11px] bg-[#161616] border-[#3a3a3a] text-[#a0a0a0] hover:text-[#e0e0e0] hover:bg-[#2a2a2a] px-3"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            className="h-8 text-[11px] bg-[#2d2d2d] hover:bg-[#3a3a3a] text-[#e0e0e0] border border-[#3a3a3a] px-3"
          >
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
