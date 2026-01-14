import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { EpisodeCameraPreview } from "@/features/camera/EpisodeCameraPreview";
import type { MeshFiles } from "@/shared/types/feature";

type EpisodePreviewPanelProps = {
  episodesViewHeight?: number;
  cameras: Array<{ id: string; name: string }>;
  episodePreviewCameraId: string | null;
  setEpisodePreviewCameraId: (value: string) => void;
  vizUrdf?: string;
  originalUrdf?: string;
  meshFiles: MeshFiles;
};

export const EpisodePreviewPanel = ({
  episodesViewHeight = 0.4,
  cameras,
  episodePreviewCameraId,
  setEpisodePreviewCameraId,
  vizUrdf,
  originalUrdf,
  meshFiles,
}: EpisodePreviewPanelProps) => (
  <div
    className="overflow-hidden flex flex-col bg-background"
    style={{
      flex: `0 0 ${episodesViewHeight * 100}%`,
      minHeight: "160px",
    }}
  >
    <div className="flex-1 min-h-0 flex flex-col gap-2 p-2">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-foreground">
            Episode camera monitor
          </span>
          <span className="text-[11px] text-muted-foreground">
            Fixed frame; image updates during playback.
          </span>
        </div>
        <Select
          value={episodePreviewCameraId ?? undefined}
          onValueChange={(value) => setEpisodePreviewCameraId(value)}
          disabled={cameras.length === 0}
        >
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="Choose camera" />
          </SelectTrigger>
          <SelectContent>
            {cameras.map((cam) => (
              <SelectItem key={cam.id} value={cam.id}>
                {cam.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 min-h-[160px]">
        <EpisodeCameraPreview
          urdfContent={vizUrdf || originalUrdf || null}
          meshFiles={meshFiles}
          cameraId={episodePreviewCameraId}
          gpuMode="low"
        />
      </div>
    </div>
  </div>
);
