import { X, Camera as CameraIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCameraStore } from "@/store/useCameraStore";
import { cn } from "@/lib/utils";

interface CameraListProps {
  availableLinks: string[];
}

export const CameraList = ({ availableLinks }: CameraListProps) => {
  const cameras = useCameraStore((state) => state.cameras);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const selectCamera = useCameraStore((state) => state.selectCamera);
  const removeCamera = useCameraStore((state) => state.removeCamera);
  const updateCamera = useCameraStore((state) => state.updateCamera);

  if (cameras.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
        No cameras created yet.
        <br />
        Use Create → Camera to add cameras.
      </div>
    );
  }

  // Convert radians to degrees
  const radToDeg = (rad: number) => (rad * 180) / Math.PI;
  // Convert degrees to radians
  const degToRad = (deg: number) => (deg * Math.PI) / 180;

  return (
    <div className="space-y-2">
      {cameras.map((camera) => {
        const isSelected = camera.id === selectedCameraId;

        return (
          <div
            key={camera.id}
            className={cn(
              "p-2 border rounded-sm transition-colors cursor-pointer",
              isSelected
                ? "bg-primary/10 border-primary/30"
                : "bg-muted/5 border-border/30 hover:bg-muted/10"
            )}
            onClick={() => selectCamera(camera.id)}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <CameraIcon className="h-3 w-3 text-orange-400" />
                <span className="text-xs font-medium text-foreground truncate">
                  {camera.name}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeCamera(camera.id);
                }}
                className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            {/* Parent Link */}
            <div className="mb-2">
              <div className="text-[10px] text-muted-foreground/70 font-medium mb-1">Parent Link</div>
              <Select
                value={camera.parent_link}
                onValueChange={(value) => {
                  updateCamera(camera.id, { parent_link: value });
                }}
              >
                <SelectTrigger
                  className="h-6 text-[10px] px-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#2a2a2a] border-[#3d3d3d]">
                  {availableLinks.map((link) => (
                    <SelectItem key={link} value={link} className="text-[10px] text-white hover:bg-[#3d3d3d]">
                      {link}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Position inputs */}
            <div className="space-y-1.5 mb-2">
              <div className="text-[10px] text-muted-foreground/70 font-medium">Position (m)</div>
              <div className="grid grid-cols-3 gap-1">
                <div>
                  <label className="text-[9px] text-muted-foreground/70">X</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={camera.pose.xyz[0].toFixed(3)}
                    onChange={(e) => {
                      const newXyz: [number, number, number] = [
                        parseFloat(e.target.value) || 0,
                        camera.pose.xyz[1],
                        camera.pose.xyz[2],
                      ];
                      updateCamera(camera.id, {
                        pose: { ...camera.pose, xyz: newXyz },
                      });
                    }}
                    className="h-6 text-[10px] px-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground/70">Y</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={camera.pose.xyz[1].toFixed(3)}
                    onChange={(e) => {
                      const newXyz: [number, number, number] = [
                        camera.pose.xyz[0],
                        parseFloat(e.target.value) || 0,
                        camera.pose.xyz[2],
                      ];
                      updateCamera(camera.id, {
                        pose: { ...camera.pose, xyz: newXyz },
                      });
                    }}
                    className="h-6 text-[10px] px-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground/70">Z</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={camera.pose.xyz[2].toFixed(3)}
                    onChange={(e) => {
                      const newXyz: [number, number, number] = [
                        camera.pose.xyz[0],
                        camera.pose.xyz[1],
                        parseFloat(e.target.value) || 0,
                      ];
                      updateCamera(camera.id, {
                        pose: { ...camera.pose, xyz: newXyz },
                      });
                    }}
                    className="h-6 text-[10px] px-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            </div>

            {/* Rotation inputs (in degrees) */}
            <div className="space-y-1.5 mb-2">
              <div className="text-[10px] text-muted-foreground/70 font-medium">Rotation (deg)</div>
              <div className="grid grid-cols-3 gap-1">
                <div>
                  <label className="text-[9px] text-muted-foreground/70">Roll</label>
                  <Input
                    type="number"
                    step="1"
                    value={Math.round(radToDeg(camera.pose.rpy[0]))}
                    onChange={(e) => {
                      const newRpy: [number, number, number] = [
                        degToRad(parseFloat(e.target.value) || 0),
                        camera.pose.rpy[1],
                        camera.pose.rpy[2],
                      ];
                      updateCamera(camera.id, {
                        pose: { ...camera.pose, rpy: newRpy },
                      });
                    }}
                    className="h-6 text-[10px] px-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground/70">Pitch</label>
                  <Input
                    type="number"
                    step="1"
                    value={Math.round(radToDeg(camera.pose.rpy[1]))}
                    onChange={(e) => {
                      const newRpy: [number, number, number] = [
                        camera.pose.rpy[0],
                        degToRad(parseFloat(e.target.value) || 0),
                        camera.pose.rpy[2],
                      ];
                      updateCamera(camera.id, {
                        pose: { ...camera.pose, rpy: newRpy },
                      });
                    }}
                    className="h-6 text-[10px] px-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground/70">Yaw</label>
                  <Input
                    type="number"
                    step="1"
                    value={Math.round(radToDeg(camera.pose.rpy[2]))}
                    onChange={(e) => {
                      const newRpy: [number, number, number] = [
                        camera.pose.rpy[0],
                        camera.pose.rpy[1],
                        degToRad(parseFloat(e.target.value) || 0),
                      ];
                      updateCamera(camera.id, {
                        pose: { ...camera.pose, rpy: newRpy },
                      });
                    }}
                    className="h-6 text-[10px] px-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            </div>

            {/* Intrinsics */}
            <div className="space-y-1.5">
              <div className="text-[10px] text-muted-foreground/70 font-medium">Intrinsics</div>
              <div className="grid grid-cols-3 gap-1">
                <div>
                  <label className="text-[9px] text-muted-foreground/70">W (px)</label>
                  <Input
                    type="number"
                    step="1"
                    value={camera.intrinsics.width}
                    onChange={(e) => {
                      updateCamera(camera.id, {
                        intrinsics: {
                          ...camera.intrinsics,
                          width: parseInt(e.target.value) || 0,
                        },
                      });
                    }}
                    className="h-6 text-[10px] px-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground/70">H (px)</label>
                  <Input
                    type="number"
                    step="1"
                    value={camera.intrinsics.height}
                    onChange={(e) => {
                      updateCamera(camera.id, {
                        intrinsics: {
                          ...camera.intrinsics,
                          height: parseInt(e.target.value) || 0,
                        },
                      });
                    }}
                    className="h-6 text-[10px] px-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground/70">FOV</label>
                  <Input
                    type="number"
                    step="1"
                    value={camera.intrinsics.fov_deg}
                    onChange={(e) => {
                      updateCamera(camera.id, {
                        intrinsics: {
                          ...camera.intrinsics,
                          fov_deg: parseFloat(e.target.value) || 0,
                        },
                      });
                    }}
                    className="h-6 text-[10px] px-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
