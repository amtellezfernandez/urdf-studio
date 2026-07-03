import { Camera, Globe } from "lucide-react";

import type { Camera as RobotCamera } from "@/shared/types/camera";
import { cn } from "@/shared/lib/utils";

type ViewerCameraToolbarProps = {
  cameras: readonly RobotCamera[];
  isCameraMenuOpen: boolean;
  onCameraSelect: (cameraId: string) => void;
  onGlobalCameraSelect: () => void;
  onToggleCameraMenu: () => void;
  selectedCameraId: string | null;
};

export function ViewerCameraToolbar({
  cameras,
  isCameraMenuOpen,
  onCameraSelect,
  onGlobalCameraSelect,
  onToggleCameraMenu,
  selectedCameraId,
}: ViewerCameraToolbarProps) {
  const hasCameras = cameras.length > 0;

  return (
    <div className="absolute top-4 right-4 z-20">
      <div className="relative">
        <div className="flex items-center gap-1 rounded-md border border-border/60 bg-background/90 p-1 shadow-sm backdrop-blur-sm">
          <button
            type="button"
            aria-label="Global Camera"
            title="Global Camera"
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded text-[11px] transition-colors",
              selectedCameraId === null
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            )}
            onClick={(event) => {
              event.stopPropagation();
              onGlobalCameraSelect();
            }}
          >
            <Globe className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Cameras"
            title="Cameras"
            disabled={!hasCameras}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded text-[11px] transition-colors",
              !hasCameras
                ? "cursor-not-allowed text-muted-foreground/60"
                : selectedCameraId !== null || isCameraMenuOpen
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            )}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCameraMenu();
            }}
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
        </div>
        {isCameraMenuOpen && hasCameras ? (
          <div
            className="absolute right-0 mt-1 w-44 bg-background/95 border border-border/70 rounded shadow-md text-xs"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-border/60 px-3 py-1 text-[10px] font-medium text-muted-foreground">
              Cameras
            </div>
            {cameras.map((camera) => (
              <button
                key={camera.id}
                className={cn(
                  "w-full text-left px-3 py-1 hover:bg-muted transition-colors",
                  selectedCameraId === camera.id && "bg-muted/70 font-medium"
                )}
                onClick={() => {
                  onCameraSelect(camera.id);
                }}
              >
                {camera.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
