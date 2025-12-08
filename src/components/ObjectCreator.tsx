import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as THREE from "three";
import { useObjectStore } from "@/store/useObjectStore";

interface ObjectCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  robotBoundingBox?: THREE.Box3 | null;
}

export function ObjectCreator({ open, onOpenChange, robotBoundingBox }: ObjectCreatorProps) {
  const addObject = useObjectStore((state) => state.addObject);

  // Default size for the cube
  const [sizeX, setSizeX] = useState(0.1);
  const [sizeY, setSizeY] = useState(0.1);
  const [sizeZ, setSizeZ] = useState(0.1);

  // Default position
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const [posZ, setPosZ] = useState(0);

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
    const size = new THREE.Vector3(sizeX, sizeY, sizeZ);

    addObject({
      type: "cube",
      position,
      size,
      color: "#3b82f6", // Blue color
      trackedJointName: null,
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Create Cube</DialogTitle>
          <DialogDescription className="text-[#a0a0a0]">
            Define the size and position of the cube
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <h3 className="text-sm font-medium mb-3 text-white">Size (meters)</h3>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="size-x" className="text-xs text-[#a0a0a0]">X</Label>
                <Input
                  id="size-x"
                  type="number"
                  step="0.01"
                  value={sizeX}
                  onChange={(e) => setSizeX(parseFloat(e.target.value) || 0)}
                  className="h-8 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-white"
                />
              </div>
              <div>
                <Label htmlFor="size-y" className="text-xs text-[#a0a0a0]">Y</Label>
                <Input
                  id="size-y"
                  type="number"
                  step="0.01"
                  value={sizeY}
                  onChange={(e) => setSizeY(parseFloat(e.target.value) || 0)}
                  className="h-8 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-white"
                />
              </div>
              <div>
                <Label htmlFor="size-z" className="text-xs text-[#a0a0a0]">Z</Label>
                <Input
                  id="size-z"
                  type="number"
                  step="0.01"
                  value={sizeZ}
                  onChange={(e) => setSizeZ(parseFloat(e.target.value) || 0)}
                  className="h-8 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-white"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-medium text-white">Position (meters)</h3>
              <Button
                onClick={suggestPosition}
                variant="outline"
                size="sm"
                className="h-6 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-[#a0a0a0] hover:text-white hover:bg-[#3d3d3d]"
              >
                Suggest Position
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="pos-x" className="text-xs text-[#a0a0a0]">X</Label>
                <Input
                  id="pos-x"
                  type="number"
                  step="0.01"
                  value={posX}
                  onChange={(e) => setPosX(parseFloat(e.target.value) || 0)}
                  className="h-8 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-white"
                />
              </div>
              <div>
                <Label htmlFor="pos-y" className="text-xs text-[#a0a0a0]">Y</Label>
                <Input
                  id="pos-y"
                  type="number"
                  step="0.01"
                  value={posY}
                  onChange={(e) => setPosY(parseFloat(e.target.value) || 0)}
                  className="h-8 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-white"
                />
              </div>
              <div>
                <Label htmlFor="pos-z" className="text-xs text-[#a0a0a0]">Z</Label>
                <Input
                  id="pos-z"
                  type="number"
                  step="0.01"
                  value={posZ}
                  onChange={(e) => setPosZ(parseFloat(e.target.value) || 0)}
                  className="h-8 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-white"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-8 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-[#a0a0a0] hover:text-white hover:bg-[#3d3d3d]"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            className="h-8 text-xs bg-[#0066cc] hover:bg-[#0052a3] text-white"
          >
            Create Cube
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
