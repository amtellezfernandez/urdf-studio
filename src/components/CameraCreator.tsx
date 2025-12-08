import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCameraStore } from "@/store/useCameraStore";
import { autoComputeCameraPoseDefault } from "@/utils/cameraPoseCompute";
import { Sparkles } from "lucide-react";

interface CameraCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableLinks: string[];
  robot?: any; // Robot object for auto-computation
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
      <DialogContent className="bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Create Camera</DialogTitle>
          <DialogDescription className="text-[#a0a0a0]">
            Define camera properties and placement in the robot frame
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Camera Name */}
          <div>
            <Label htmlFor="camera-name" className="text-sm text-white mb-2 block">Camera Name</Label>
            <Input
              id="camera-name"
              type="text"
              placeholder="e.g., front_cam"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 bg-[#2a2a2a] border-[#3d3d3d] text-white"
            />
          </div>

          {/* Parent Link */}
          <div>
            <Label htmlFor="parent-link" className="text-sm text-white mb-2 block">Parent Link</Label>
            <Select value={parentLink} onValueChange={setParentLink}>
              <SelectTrigger className="h-9 bg-[#2a2a2a] border-[#3d3d3d] text-white">
                <SelectValue placeholder="Select a link..." />
              </SelectTrigger>
              <SelectContent className="bg-[#2a2a2a] border-[#3d3d3d]">
                {availableLinks.length === 0 ? (
                  <SelectItem value="none" disabled>No links available</SelectItem>
                ) : (
                  availableLinks.map((link) => (
                    <SelectItem key={link} value={link} className="text-white hover:bg-[#3d3d3d]">
                      {link}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Auto Compute Button */}
          <div className="flex items-center justify-between p-3 bg-[#2a2a2a] border border-[#3d3d3d] rounded-md">
            <div className="flex-1">
              <h3 className="text-sm font-medium text-white mb-1">Auto-Compute Camera Pose</h3>
              <p className="text-xs text-[#a0a0a0]">
                Automatically position camera in front of the selected link, looking forward
              </p>
            </div>
            <Button
              onClick={handleAutoCompute}
              disabled={!parentLink || !robot}
              className="h-9 bg-[#0066cc] hover:bg-[#0052a3] text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Auto Compute
            </Button>
          </div>

          {/* Position */}
          <div>
            <h3 className="text-sm font-medium mb-3 text-white">Position (meters)</h3>
            <div className="grid grid-cols-3 gap-3">
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

          {/* Rotation */}
          <div>
            <h3 className="text-sm font-medium mb-3 text-white">Rotation (degrees)</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="roll" className="text-xs text-[#a0a0a0]">Roll</Label>
                <Input
                  id="roll"
                  type="number"
                  step="1"
                  value={roll}
                  onChange={(e) => setRoll(parseFloat(e.target.value) || 0)}
                  className="h-8 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-white"
                />
              </div>
              <div>
                <Label htmlFor="pitch" className="text-xs text-[#a0a0a0]">Pitch</Label>
                <Input
                  id="pitch"
                  type="number"
                  step="1"
                  value={pitch}
                  onChange={(e) => setPitch(parseFloat(e.target.value) || 0)}
                  className="h-8 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-white"
                />
              </div>
              <div>
                <Label htmlFor="yaw" className="text-xs text-[#a0a0a0]">Yaw</Label>
                <Input
                  id="yaw"
                  type="number"
                  step="1"
                  value={yaw}
                  onChange={(e) => setYaw(parseFloat(e.target.value) || 0)}
                  className="h-8 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-white"
                />
              </div>
            </div>
          </div>

          {/* Camera Intrinsics */}
          <div>
            <h3 className="text-sm font-medium mb-3 text-white">Camera Intrinsics</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="width" className="text-xs text-[#a0a0a0]">Width (px)</Label>
                <Input
                  id="width"
                  type="number"
                  step="1"
                  value={width}
                  onChange={(e) => setWidth(parseInt(e.target.value) || 0)}
                  className="h-8 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-white"
                />
              </div>
              <div>
                <Label htmlFor="height" className="text-xs text-[#a0a0a0]">Height (px)</Label>
                <Input
                  id="height"
                  type="number"
                  step="1"
                  value={height}
                  onChange={(e) => setHeight(parseInt(e.target.value) || 0)}
                  className="h-8 text-xs bg-[#2a2a2a] border-[#3d3d3d] text-white"
                />
              </div>
              <div>
                <Label htmlFor="fov" className="text-xs text-[#a0a0a0]">FOV (deg)</Label>
                <Input
                  id="fov"
                  type="number"
                  step="1"
                  value={fovDeg}
                  onChange={(e) => setFovDeg(parseFloat(e.target.value) || 0)}
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
            Create Camera
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
