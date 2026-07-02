import { useEffect, useMemo, useRef, useState } from "react";
import { Camera as CameraIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { CameraViewportPreview } from "@/features/camera/CameraViewportPreview";
import { useCameraStore } from "@/shared/store/useCameraStore";
import type { Camera } from "@/shared/types/camera";
import type { PackageRootMap } from "@/shared/lib/urdfBrowser";
import type { MeshFiles } from "@/shared/types/feature";

type CameraPreviewMode = "all" | "focus" | "list";

const CAMERA_PREVIEW_MAX_ALL_CANDIDATES = 10;
const CAMERA_PREVIEW_MAX_ALL_CANVASES = 4;

type CameraPreviewPanelProps = {
  cameraPreviewEmptyStateMessage?: string;
  cameras: Camera[];
  meshFiles: MeshFiles;
  originalUrdf?: string;
  packageRoots?: PackageRootMap;
  urdfBasePath?: string;
  vizUrdf?: string;
};

const getCameraAspect = (camera: Camera) => {
  const width = camera.intrinsics?.width ?? 0;
  const height = camera.intrinsics?.height ?? 0;
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : 16 / 9;
};

const chooseAllPreviewColumns = (
  cameras: Camera[],
  viewportSize: { width: number; height: number }
) => {
  const count = cameras.length;
  if (count <= 1) return 1;
  const aspects = cameras.map(getCameraAspect);
  const horizontalCount = aspects.filter((aspect) => aspect >= 1).length;
  if (count === 2 && horizontalCount === 2) return 1;
  if (count === 2 && horizontalCount === 0) return 2;
  const width = Math.max(1, viewportSize.width);
  const height = Math.max(1, viewportSize.height);
  const viewportAspect = width / height;
  const maxColumns = count <= 3 ? 2 : count <= 8 ? 3 : 4;
  let bestColumns = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let columns = 1; columns <= Math.min(maxColumns, count); columns += 1) {
    const rows = Math.ceil(count / columns);
    const tileAspect = viewportAspect * (rows / columns);
    const aspectCost =
      aspects.reduce((sum, aspect) => sum + Math.abs(Math.log(tileAspect / aspect)), 0) /
      Math.max(1, count);
    const emptySlotCost = (columns * rows - count) * 0.2;
    const score = aspectCost + emptySlotCost;
    if (score < bestScore) {
      bestScore = score;
      bestColumns = columns;
    }
  }
  return bestColumns;
};

export const CameraPreviewPanel = ({
  cameraPreviewEmptyStateMessage,
  cameras,
  meshFiles,
  originalUrdf,
  packageRoots,
  urdfBasePath,
  vizUrdf,
}: CameraPreviewPanelProps) => {
  const [previewMode, setPreviewMode] = useState<CameraPreviewMode>("all");
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const selectCamera = useCameraStore((state) => state.selectCamera);
  const [panelCameraId, setPanelCameraId] = useState<string | null>(selectedCameraId);
  const allPreviewRef = useRef<HTMLDivElement | null>(null);
  const [allPreviewSize, setAllPreviewSize] = useState({ width: 0, height: 0 });
  const urdfContent = vizUrdf || originalUrdf || null;
  const allPreviewCandidates = useMemo(
    () => cameras.slice(0, CAMERA_PREVIEW_MAX_ALL_CANDIDATES),
    [cameras]
  );
  const activeCameraId = useMemo(
    () =>
      panelCameraId && cameras.some((camera) => camera.id === panelCameraId)
        ? panelCameraId
        : cameras[0]?.id ?? null,
    [cameras, panelCameraId]
  );
  const allPreviewCameras = useMemo(() => {
    const cappedCameras = allPreviewCandidates.slice(0, CAMERA_PREVIEW_MAX_ALL_CANVASES);
    if (!activeCameraId || cappedCameras.some((camera) => camera.id === activeCameraId)) {
      return cappedCameras;
    }

    const activeCamera = cameras.find((camera) => camera.id === activeCameraId);
    return activeCamera
      ? [activeCamera, ...cappedCameras.slice(0, CAMERA_PREVIEW_MAX_ALL_CANVASES - 1)]
      : cappedCameras;
  }, [activeCameraId, allPreviewCandidates, cameras]);
  const hiddenAllPreviewCount = Math.max(0, cameras.length - allPreviewCameras.length);
  const allPreviewTileCount =
    allPreviewCameras.length + (hiddenAllPreviewCount > 0 ? 1 : 0);
  const allPreviewColumns = useMemo(
    () => chooseAllPreviewColumns(allPreviewCameras, allPreviewSize),
    [allPreviewCameras, allPreviewSize]
  );
  const allPreviewRows = useMemo(
    () => Math.max(1, Math.ceil(Math.max(1, allPreviewTileCount) / allPreviewColumns)),
    [allPreviewColumns, allPreviewTileCount]
  );

  useEffect(() => {
    if (!selectedCameraId) return;
    setPanelCameraId(selectedCameraId);
  }, [selectedCameraId]);

  useEffect(() => {
    if (cameras.length === 0) {
      setPanelCameraId(null);
      return;
    }
    if (!panelCameraId || !cameras.some((camera) => camera.id === panelCameraId)) {
      setPanelCameraId(cameras[0].id);
    }
  }, [cameras, panelCameraId]);

  useEffect(() => {
    const node = allPreviewRef.current;
    if (!node) return;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setAllPreviewSize((previous) => {
        const width = Math.max(0, rect.width);
        const height = Math.max(0, rect.height);
        return Math.abs(previous.width - width) < 0.5 &&
          Math.abs(previous.height - height) < 0.5
          ? previous
          : { width, height };
      });
    };
    updateSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [previewMode, allPreviewTileCount]);

  const handleCameraSelect = (cameraId: string, nextMode?: CameraPreviewMode) => {
    setPanelCameraId(cameraId);
    selectCamera(cameraId);
    if (nextMode) setPreviewMode(nextMode);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-foreground/90">
            <CameraIcon className="h-3 w-3" />
            <span>({cameras.length})</span>
          </span>
          <div className="inline-flex items-center rounded-md border border-border/60 bg-muted/20 p-0.5">
            {(["focus", "all", "list"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPreviewMode(mode)}
                className={`h-5 rounded px-1.5 text-[9px] capitalize transition-colors ${
                  previewMode === mode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {previewMode === "focus" ? (
          <div className="flex min-w-0 items-center gap-1">
            <span className="shrink-0 text-[9px] text-muted-foreground">Camera</span>
            <Select
              value={activeCameraId ?? undefined}
              onValueChange={(value) => handleCameraSelect(value)}
              disabled={cameras.length === 0}
            >
              <SelectTrigger className="h-6 min-w-0 flex-1 text-[9px]">
                <SelectValue placeholder="Choose camera" />
              </SelectTrigger>
              <SelectContent>
                {cameras.map((camera) => (
                  <SelectItem key={camera.id} value={camera.id}>
                    {camera.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="min-h-[160px] min-w-0 flex-1 overflow-hidden">
          {cameras.length === 0 ? (
            <CameraViewportPreview
              cameraId={null}
              emptyStateMessage={cameraPreviewEmptyStateMessage}
              meshFiles={meshFiles}
              packageRoots={packageRoots}
              urdfBasePath={urdfBasePath}
              urdfContent={urdfContent}
            />
          ) : previewMode === "focus" ? (
            <div className="h-full min-h-0 min-w-0 overflow-hidden rounded-md border border-border/60">
              <CameraViewportPreview
                cameraId={activeCameraId}
                emptyStateMessage={cameraPreviewEmptyStateMessage}
                meshFiles={meshFiles}
                packageRoots={packageRoots}
                urdfBasePath={urdfBasePath}
                urdfContent={urdfContent}
              />
            </div>
          ) : previewMode === "list" ? (
            <div className="h-full min-h-0 min-w-0 overflow-y-auto rounded-md border border-border/60 bg-background/40">
              <div className="divide-y divide-border/30">
                {cameras.map((camera) => {
                  const isSelected = activeCameraId === camera.id;
                  const width = camera.intrinsics?.width ?? 0;
                  const height = camera.intrinsics?.height ?? 0;
                  const fov = camera.intrinsics?.fov_deg ?? 0;
                  return (
                    <div
                      key={camera.id}
                      className={`flex items-center justify-between gap-2 px-2 py-1.5 ${
                        isSelected ? "bg-primary/5" : "hover:bg-muted/20"
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => handleCameraSelect(camera.id)}
                      >
                        <div className="truncate text-[9px] text-foreground/90">{camera.name}</div>
                        <div className="truncate text-[8px] text-muted-foreground">
                          {width}x{height} - {fov.toFixed(1)}deg - {camera.parent_joint}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="shrink-0 text-[8px] text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => handleCameraSelect(camera.id, "focus")}
                      >
                        Focus
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div ref={allPreviewRef} className="h-full min-h-0 min-w-0 overflow-hidden">
              <div
                className="grid h-full min-h-0 min-w-0 gap-1.5"
                style={{
                  gridTemplateColumns: `repeat(${allPreviewColumns}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${allPreviewRows}, minmax(0, 1fr))`,
                }}
              >
                {allPreviewCameras.map((camera) => (
                  <div
                    key={camera.id}
                    className={`h-full min-h-0 min-w-0 overflow-hidden rounded-md border p-0.5 ${
                      activeCameraId === camera.id
                        ? "border-primary/70 bg-primary/5"
                        : "border-border/60 bg-background/40"
                    }`}
                  >
                    <div className="flex items-center justify-between px-1 pb-0.5">
                      <span className="truncate text-[9px] text-foreground/90">{camera.name}</span>
                      <button
                        type="button"
                        className="text-[9px] text-muted-foreground hover:text-foreground"
                        onClick={() => handleCameraSelect(camera.id, "focus")}
                      >
                        Focus
                      </button>
                    </div>
                    <div className="h-[calc(100%-1.2rem)] min-h-0">
                      <CameraViewportPreview
                        cameraId={camera.id}
                        emptyStateMessage={cameraPreviewEmptyStateMessage}
                        meshFiles={meshFiles}
                        packageRoots={packageRoots}
                        urdfBasePath={urdfBasePath}
                        urdfContent={urdfContent}
                      />
                    </div>
                  </div>
                ))}
                {hiddenAllPreviewCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setPreviewMode("list")}
                    className="flex h-full min-h-0 min-w-0 flex-col items-center justify-center rounded-md border border-border/60 bg-background/40 text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
                  >
                    <span className="text-[12px] font-medium">+{hiddenAllPreviewCount}</span>
                    <span className="text-[8px] uppercase">List</span>
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
