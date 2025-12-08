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
              "p-1.5 border border-[#3d3d3d] rounded transition-colors cursor-pointer",
              isSelected
                ? "bg-[#2a2a2a] border-[#4d4d4d]"
                : "bg-[#1e1e1e] hover:bg-[#252525] hover:border-[#4d4d4d]"
            )}
            onClick={() => selectCamera(camera.id)}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1">
                <CameraIcon className="h-3 w-3 text-[#9d9d9d]" />
                <span className="text-[11px] font-normal text-[#d4d4d4] truncate">
                  {camera.name}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeCamera(camera.id);
                }}
                className="text-[#9d9d9d] hover:text-[#d4d4d4] transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            {/* Parent Link */}
            <div className="mb-1.5">
              <div className="text-[9px] text-[#9d9d9d] mb-1">Link</div>
              <Select
                value={camera.parent_link}
                onValueChange={(value) => {
                  updateCamera(camera.id, { parent_link: value });
                }}
              >
                <SelectTrigger
                  className="h-5 text-[10px] px-1 bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#2a2a2a] border-[#3d3d3d]">
                  {availableLinks.map((link) => (
                    <SelectItem key={link} value={link} className="text-[10px] text-[#d4d4d4] hover:bg-[#3d3d3d]">
                      {link}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Position inputs */}
            <div className="space-y-1 mb-1.5">
              <div className="text-[9px] text-[#9d9d9d]">Position</div>
              <div className="grid grid-cols-3 gap-1">
                <div>
                  <label className="text-[8px] text-[#7d7d7d]">X</label>
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
                    className="h-5 text-[10px] px-1 bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div>
                  <label className="text-[8px] text-[#7d7d7d]">Y</label>
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
                    className="h-5 text-[10px] px-1 bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div>
                  <label className="text-[8px] text-[#7d7d7d]">Z</label>
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
                    className="h-5 text-[10px] px-1 bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            </div>

            {/* Rotation inputs (in degrees) */}
            <div className="space-y-1 mb-1.5">
              <div className="text-[9px] text-[#9d9d9d]">Rotation</div>
              <div className="grid grid-cols-3 gap-1">
                <div>
                  <label className="text-[8px] text-[#7d7d7d]">R</label>
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
                    className="h-5 text-[10px] px-1 bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div>
                  <label className="text-[8px] text-[#7d7d7d]">P</label>
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
                    className="h-5 text-[10px] px-1 bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div>
                  <label className="text-[8px] text-[#7d7d7d]">Y</label>
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
                    className="h-5 text-[10px] px-1 bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            </div>

            {/* Intrinsics */}
            <div className="space-y-1">
              <div className="text-[9px] text-[#9d9d9d]">Intrinsics</div>
              <div className="grid grid-cols-3 gap-1">
                <div>
                  <label className="text-[8px] text-[#7d7d7d]">W</label>
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
                    className="h-5 text-[10px] px-1 bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div>
                  <label className="text-[8px] text-[#7d7d7d]">H</label>
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
                    className="h-5 text-[10px] px-1 bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div>
                  <label className="text-[8px] text-[#7d7d7d]">FOV</label>
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
                    className="h-5 text-[10px] px-1 bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]"
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
