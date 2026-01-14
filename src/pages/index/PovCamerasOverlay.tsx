import { cn } from "@/lib/utils";
import type { Camera } from "@/types/camera";

type PovCamerasOverlayProps = {
  open: boolean;
  cameras: Camera[];
  selectedCameraId: string | null;
  onClose: () => void;
};

export const PovCamerasOverlay = ({
  open,
  cameras,
  selectedCameraId,
  onClose,
}: PovCamerasOverlayProps) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-5xl rounded-xl border border-border bg-[#101010]/95 p-4 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-border/50">
          <div>
            <div className="text-sm font-semibold text-foreground">POV Cameras</div>
            <p className="text-[11px] text-muted-foreground">
              Camera definitions (preview removed).
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground"
            aria-label="Close POV split view"
          >
            Close
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cameras.map((camera, index) => (
            <div
              key={camera.id}
              className={cn(
                "flex flex-col gap-2 rounded-lg border bg-gradient-to-b from-[#151515] to-[#0b0b0b] p-3 shadow-lg",
                selectedCameraId === camera.id
                  ? "border-primary/60 ring-2 ring-primary/20"
                  : "border-border/50"
              )}
            >
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>Camera {index + 1}</span>
                <span className="text-[9px] text-muted-foreground/70">
                  {camera.parent_link}
                </span>
              </div>
              <div className="text-sm font-semibold text-foreground truncate">
                {camera.name}
              </div>
              <div className="w-full rounded-md border border-border/40 bg-[#0b0b0b] p-3 text-[11px] text-muted-foreground">
                <div>
                  Parent link:{" "}
                  <span className="text-foreground">{camera.parent_link}</span>
                </div>
                <div>Pose xyz: {camera.pose.xyz.join(", ")}</div>
                <div>Pose rpy: {camera.pose.rpy.join(", ")}</div>
                <div>
                  Intrinsics: {camera.intrinsics.width}×{camera.intrinsics.height}, FOV{" "}
                  {camera.intrinsics.fov_deg}°
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
