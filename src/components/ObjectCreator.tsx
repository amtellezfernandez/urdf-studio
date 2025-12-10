import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as THREE from "three";
import { useObjectStore } from "@/store/useObjectStore";
import { cn } from "@/lib/utils";

interface ObjectCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  robotBoundingBox?: THREE.Box3 | null;
  defaultType?: "cube" | "point";
}

const DEFAULT_CUBE_SIZE = 0.1;
const DEFAULT_POINT_SIZE = 0.02;

export function ObjectCreator({ open, onOpenChange, robotBoundingBox, defaultType = "cube" }: ObjectCreatorProps) {
  const addObject = useObjectStore((state) => state.addObject);

  const [objectType, setObjectType] = useState<"cube" | "point">(defaultType);
  // Default size for the cube
  const [sizeX, setSizeX] = useState(DEFAULT_CUBE_SIZE);
  const [sizeY, setSizeY] = useState(DEFAULT_CUBE_SIZE);
  const [sizeZ, setSizeZ] = useState(DEFAULT_CUBE_SIZE);

  // Default position
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const [posZ, setPosZ] = useState(0);
  const [isIkTarget, setIsIkTarget] = useState(false);

  // Reset defaults when dialog opens or when caller requests a different type
  useEffect(() => {
    if (!open) return;
    setObjectType(defaultType);
    if (defaultType === "point") {
      setSizeX(DEFAULT_POINT_SIZE);
      setSizeY(DEFAULT_POINT_SIZE);
      setSizeZ(DEFAULT_POINT_SIZE);
    } else {
      setSizeX(DEFAULT_CUBE_SIZE);
      setSizeY(DEFAULT_CUBE_SIZE);
      setSizeZ(DEFAULT_CUBE_SIZE);
    }
  }, [open, defaultType]);

  // Keep size in sync when switching types inside the dialog
  useEffect(() => {
    if (objectType === "point") {
      setSizeX(DEFAULT_POINT_SIZE);
      setSizeY(DEFAULT_POINT_SIZE);
      setSizeZ(DEFAULT_POINT_SIZE);
    }
  }, [objectType]);

  // Suggest a non-colliding position
  const suggestPosition = () => {
    if (!robotBoundingBox || robotBoundingBox.isEmpty()) {
      // No robot loaded, use default position
      setPosX(0.5);
      setPosY(0.5);
      setPosZ(0.5);
      return;
    }

    // Get robot bounds
    const robotMax = robotBoundingBox.max;
    const robotMin = robotBoundingBox.min;
    const robotCenter = new THREE.Vector3();
    robotBoundingBox.getCenter(robotCenter);
    const robotSize = new THREE.Vector3();
    robotBoundingBox.getSize(robotSize);

    // Place cube at a safe distance from robot
    const offset = Math.max(robotSize.x, robotSize.y, robotSize.z) * 0.5 + 0.3;

    // Position to the right of the robot
    const suggestedPos = new THREE.Vector3(
      robotMax.x + offset,
      robotCenter.y,
      robotCenter.z
    );

    setPosX(parseFloat(suggestedPos.x.toFixed(3)));
    setPosY(parseFloat(suggestedPos.y.toFixed(3)));
    setPosZ(parseFloat(suggestedPos.z.toFixed(3)));
  };

  const handleCreate = () => {
    const position = new THREE.Vector3(posX, posY, posZ);
    const size =
      objectType === "point"
        ? new THREE.Vector3(DEFAULT_POINT_SIZE, DEFAULT_POINT_SIZE, DEFAULT_POINT_SIZE)
        : new THREE.Vector3(sizeX, sizeY, sizeZ);

    addObject({
      type: objectType,
      position,
      size,
      color: objectType === "point" ? "#f472b6" : "#3b82f6", // make points easier to spot
      trackedJointName: null,
      isIkTarget,
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4] max-w-xs p-3">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-sm text-[#d4d4d4] font-normal">Create Object</DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5">
          <div>
            <Label className="text-[10px] text-[#9d9d9d] mb-1 block">Type</Label>
            <div className="grid grid-cols-2 gap-1">
              {(["cube", "point"] as const).map((type) => (
                <Button
                  key={type}
                  variant={objectType === type ? "default" : "outline"}
                  size="sm"
                  onClick={() => setObjectType(type)}
                  className={cn(
                    "h-7 text-[11px] px-2",
                    objectType === type
                      ? "bg-[#3d3d3d] text-white"
                      : "bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4]"
                  )}
                >
                  {type === "cube" ? "Cube" : "Point"}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-[10px] text-[#9d9d9d] mb-1 block">
              {objectType === "point" ? "Size (fixed)" : "Size"}
            </Label>
            {objectType === "cube" ? (
              <div className="grid grid-cols-3 gap-1.5">
                <Input
                  id="size-x"
                  type="number"
                  step="0.01"
                  value={sizeX}
                  onChange={(e) => setSizeX(parseFloat(e.target.value) || 0)}
                  placeholder="X"
                  className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
                />
                <Input
                  id="size-y"
                  type="number"
                  step="0.01"
                  value={sizeY}
                  onChange={(e) => setSizeY(parseFloat(e.target.value) || 0)}
                  placeholder="Y"
                  className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
                />
                <Input
                  id="size-z"
                  type="number"
                  step="0.01"
                  value={sizeZ}
                  onChange={(e) => setSizeZ(parseFloat(e.target.value) || 0)}
                  placeholder="Z"
                  className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
                />
              </div>
            ) : (
              <div className="text-[11px] text-[#d4d4d4] px-2 py-1 bg-[#1e1e1e] border border-[#3d3d3d] rounded">
                Points use a fixed {DEFAULT_POINT_SIZE} m size.
              </div>
            )}
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <Label className="text-[10px] text-[#9d9d9d]">Position</Label>
              <Button
                onClick={suggestPosition}
                variant="outline"
                size="sm"
                className="h-5 text-[10px] bg-[#1e1e1e] border-[#3d3d3d] text-[#9d9d9d] hover:text-[#d4d4d4] hover:bg-[#3d3d3d] px-2 py-0"
              >
                Suggest
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Input
                id="pos-x"
                type="number"
                step="0.01"
                value={posX}
                onChange={(e) => setPosX(parseFloat(e.target.value) || 0)}
                placeholder="X"
                className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
              />
              <Input
                id="pos-y"
                type="number"
                step="0.01"
                value={posY}
                onChange={(e) => setPosY(parseFloat(e.target.value) || 0)}
                placeholder="Y"
                className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
              />
              <Input
                id="pos-z"
                type="number"
                step="0.01"
                value={posZ}
                onChange={(e) => setPosZ(parseFloat(e.target.value) || 0)}
                placeholder="Z"
                className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between py-1 border-t border-[#3d3d3d]">
          <Label className="text-[10px] text-[#9d9d9d]">Mark as IK target</Label>
          <input
            type="checkbox"
            checked={isIkTarget}
            onChange={(e) => setIsIkTarget(e.target.checked)}
            className="h-4 w-4 accent-[#3d3d3d] bg-[#1e1e1e] border-[#3d3d3d]"
          />
        </div>

        <div className="flex justify-end gap-1.5 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#9d9d9d] hover:text-[#d4d4d4] hover:bg-[#3d3d3d] px-3"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            className="h-7 text-[11px] bg-[#3d3d3d] hover:bg-[#4d4d4d] text-[#d4d4d4] px-3"
          >
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
