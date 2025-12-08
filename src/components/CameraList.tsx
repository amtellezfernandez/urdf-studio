import { X, Video } from "lucide-react";
import { useCameraStore } from "@/store/useCameraStore";
import { cn } from "@/lib/utils";

interface CameraListProps {
  availableLinks?: string[];
  onCameraSelect?: (cameraId: string) => void;
}

export const CameraList = ({ availableLinks, onCameraSelect }: CameraListProps) => {
  const cameras = useCameraStore((state) => state.cameras);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const selectCamera = useCameraStore((state) => state.selectCamera);
  const removeCamera = useCameraStore((state) => state.removeCamera);

  if (cameras.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
        No cameras created yet.
        <br />
        Use Create → Camera to add cameras.
      </div>
    );
  }


  return (
    <div className="space-y-0.5">
      {cameras.map((camera) => {
        const isSelected = camera.id === selectedCameraId;

        return (
          <div
            key={camera.id}
            className={cn(
              "px-2 py-1.5 border border-[#3d3d3d] rounded-sm transition-colors cursor-pointer",
              isSelected
                ? "bg-[#2a2a2a] border-[#4d4d4d]"
                : "bg-[#1e1e1e] hover:bg-[#252525] hover:border-[#4d4d4d]"
            )}
            onClick={() => {
              selectCamera(camera.id);
              onCameraSelect?.(camera.id);
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Video className="h-3 w-3 text-[#9d9d9d]" />
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
          </div>
        );
      })}
    </div>
  );
};
