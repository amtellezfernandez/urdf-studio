import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCameraStore } from "@/store/useCameraStore";
import { autoComputeCameraPoseDefault } from "@/features/camera";
import { Sparkles } from "lucide-react";
import type { URDFRobot } from "urdf-loader";

interface CameraCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableLinks: string[];
  robot?: URDFRobot | null; // Robot object for auto-computation
}

export function CameraCreator({ open, onOpenChange, availableLinks, robot }: CameraCreatorProps) {
  const addCamera = useCameraStore((state) => state.addCamera);

  // Camera properties
  const [name, setName] = useState("");
  const [parentLink, setParentLink] = useState("");

  // Position (xyz)
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const [posZ, setPosZ] = useState(0);

  // Rotation (rpy in degrees, will be converted to radians)
  const [roll, setRoll] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [yaw, setYaw] = useState(0);

  // Intrinsics
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(720);
  const [fovDeg, setFovDeg] = useState(90);

  const handleAutoCompute = () => {
    if (!parentLink) {
      alert("Please select a parent link first");
      return;
    }

    if (!robot) {
      alert("Robot model not loaded");
      return;
    }

    const pose = autoComputeCameraPoseDefault(robot, parentLink);
    if (!pose) {
      alert(`Failed to compute camera pose for link "${parentLink}". The link may not have geometry.`);
      return;
    }

    // Convert radians to degrees for display
    const radToDeg = (rad: number) => (rad * 180) / Math.PI;

    // Update position
    setPosX(pose.xyz[0]);
    setPosY(pose.xyz[1]);
    setPosZ(pose.xyz[2]);

    // Update rotation (convert to degrees)
    setRoll(radToDeg(pose.rpy[0]));
    setPitch(radToDeg(pose.rpy[1]));
    setYaw(radToDeg(pose.rpy[2]));
  };

  const handleCreate = () => {
    if (!name || !parentLink) {
      alert("Please provide a camera name and select a parent link");
      return;
    }

    // Convert degrees to radians
    const degToRad = (deg: number) => (deg * Math.PI) / 180;

    addCamera({
      name,
      parent_link: parentLink,
      pose: {
        xyz: [posX, posY, posZ],
        rpy: [degToRad(roll), degToRad(pitch), degToRad(yaw)],
      },
      intrinsics: {
        width,
        height,
        fov_deg: fovDeg,
      },
    });

    // Reset form
    setName("");
    setParentLink("");
    setPosX(0);
    setPosY(0);
    setPosZ(0);
    setRoll(0);
    setPitch(0);
    setYaw(0);
    setWidth(1280);
    setHeight(720);
    setFovDeg(90);

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4] max-w-sm max-h-[85vh] overflow-y-auto p-3">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-sm text-[#d4d4d4] font-normal">Create Camera</DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5">
          {/* Camera Name */}
          <div>
            <Label htmlFor="camera-name" className="text-[10px] text-[#9d9d9d] mb-1 block">Name</Label>
            <Input
              id="camera-name"
              type="text"
              placeholder="front_cam"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
            />
          </div>

          {/* Parent Link */}
          <div>
            <Label htmlFor="parent-link" className="text-[10px] text-[#9d9d9d] mb-1 block">Link</Label>
            <Select value={parentLink} onValueChange={setParentLink}>
              <SelectTrigger className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4]">
                <SelectValue placeholder="Select link..." />
              </SelectTrigger>
              <SelectContent className="bg-[#2a2a2a] border-[#3d3d3d]">
                {availableLinks.length === 0 ? (
                  <SelectItem value="none" disabled className="text-[#9d9d9d]">No links available</SelectItem>
                ) : (
                  availableLinks.map((link) => (
                    <SelectItem key={link} value={link} className="text-[#d4d4d4] hover:bg-[#3d3d3d] text-[11px]">
                      {link}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Auto Compute Button */}
          <div className="flex items-center justify-between p-2 bg-[#1e1e1e] border border-[#3d3d3d] rounded">
            <span className="text-[10px] text-[#9d9d9d]">Auto Compute</span>
            <Button
              onClick={handleAutoCompute}
              disabled={!parentLink || !robot}
              className="h-6 text-[10px] bg-[#3d3d3d] hover:bg-[#4d4d4d] text-[#d4d4d4] disabled:opacity-50 disabled:cursor-not-allowed px-2"
            >
              <Sparkles className="w-3 h-3 mr-1" />
              Compute
            </Button>
          </div>

          {/* Position */}
          <div>
            <Label className="text-[10px] text-[#9d9d9d] mb-1 block">Position</Label>
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

          {/* Rotation */}
          <div>
            <Label className="text-[10px] text-[#9d9d9d] mb-1 block">Rotation</Label>
            <div className="grid grid-cols-3 gap-1.5">
              <Input
                id="roll"
                type="number"
                step="1"
                value={roll}
                onChange={(e) => setRoll(parseFloat(e.target.value) || 0)}
                placeholder="Roll"
                className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
              />
              <Input
                id="pitch"
                type="number"
                step="1"
                value={pitch}
                onChange={(e) => setPitch(parseFloat(e.target.value) || 0)}
                placeholder="Pitch"
                className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
              />
              <Input
                id="yaw"
                type="number"
                step="1"
                value={yaw}
                onChange={(e) => setYaw(parseFloat(e.target.value) || 0)}
                placeholder="Yaw"
                className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
              />
            </div>
          </div>

          {/* Camera Intrinsics */}
          <div>
            <Label className="text-[10px] text-[#9d9d9d] mb-1 block">Intrinsics</Label>
            <div className="grid grid-cols-3 gap-1.5">
              <Input
                id="width"
                type="number"
                step="1"
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value) || 0)}
                placeholder="W"
                className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
              />
              <Input
                id="height"
                type="number"
                step="1"
                value={height}
                onChange={(e) => setHeight(parseInt(e.target.value) || 0)}
                placeholder="H"
                className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
              />
              <Input
                id="fov"
                type="number"
                step="1"
                value={fovDeg}
                onChange={(e) => setFovDeg(parseFloat(e.target.value) || 0)}
                placeholder="FOV"
                className="h-7 text-[11px] bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] px-2"
              />
            </div>
          </div>
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
