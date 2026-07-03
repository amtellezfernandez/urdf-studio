import { useCallback, useMemo } from "react";
import { Box, Camera as CameraIcon, Eye, EyeOff } from "lucide-react";
import type { URDFRobot } from "urdf-loader";

import { useObjectStore, type CreatedObject } from "@/features/objects";
import { JOINT_LIST_SIDEBAR_PARAMS } from "@/features/layout/jointListSidebarParams";
import { resolveTrackingReference } from "@/features/viewer/trackingTarget";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { cn } from "@/shared/lib/utils";

type WorldPanelProps = {
  robot?: URDFRobot | null;
  endEffectorLink?: string | null;
  onJointSelect?: (jointName: string | null) => void;
  setSelectedLink?: (linkName: string | null) => void;
};

const WORLD_OBJECT_SOURCE_ORDER: ReadonlyArray<NonNullable<CreatedObject["source"]>> =
  JOINT_LIST_SIDEBAR_PARAMS.worldObjectSourceOrder;
const WORLD_OBJECT_SOURCE_LABELS: Record<NonNullable<CreatedObject["source"]>, string> =
  JOINT_LIST_SIDEBAR_PARAMS.worldObjectSourceLabels;

const toReadableWorldSourceLabel = (source: string): string =>
  source
    .split(/[-_]/g)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

export const WorldPanel = ({
  robot,
  endEffectorLink,
  onJointSelect,
  setSelectedLink,
}: WorldPanelProps) => {
  const objects = useObjectStore((state) => state.objects);
  const selectedObjectId = useObjectStore((state) => state.selectedObjectId);
  const setSelectedObject = useObjectStore((state) => state.setSelectedObject);
  const setObjectHidden = useObjectStore((state) => state.setObjectHidden);
  const cameras = useCameraStore((state) => state.cameras);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const selectCamera = useCameraStore((state) => state.selectCamera);
  const selectWorldObject = useCallback((objectId: string) => {
    setSelectedObject(objectId);
    onJointSelect?.(null);
    setSelectedLink?.(null);
    useCameraStore.getState().selectCamera(null);
  }, [onJointSelect, setSelectedLink, setSelectedObject]);
  const selectWorldCamera = useCallback((cameraId: string) => {
    selectCamera(cameraId);
    setSelectedObject(null);
    onJointSelect?.(null);
    setSelectedLink?.(null);
  }, [onJointSelect, selectCamera, setSelectedLink, setSelectedObject]);
  const toggleWorldObjectVisibility = useCallback((objectId: string, isHidden: boolean) => {
    setObjectHidden(objectId, !isHidden);
  }, [setObjectHidden]);

  const objectGroups = useMemo(() => {
    const groupedBySource = new Map<string, CreatedObject[]>();
    objects.forEach((object) => {
      const source = object.source ?? "user";
      const existing = groupedBySource.get(source);
      if (existing) {
        existing.push(object);
      } else {
        groupedBySource.set(source, [object]);
      }
    });

    const sourceOrder = new Map(WORLD_OBJECT_SOURCE_ORDER.map((source, index) => [source, index]));

    return [...groupedBySource.entries()]
      .sort(([sourceA], [sourceB]) => {
        const sourceAIndex = sourceOrder.get(sourceA as NonNullable<CreatedObject["source"]>);
        const sourceBIndex = sourceOrder.get(sourceB as NonNullable<CreatedObject["source"]>);
        return (sourceAIndex ?? Number.MAX_SAFE_INTEGER) - (sourceBIndex ?? Number.MAX_SAFE_INTEGER);
      })
      .map(([source, sourceObjects]) => ({
        source,
        label:
          WORLD_OBJECT_SOURCE_LABELS[source as NonNullable<CreatedObject["source"]>] ??
          `${toReadableWorldSourceLabel(source)} Objects`,
        objects: [...sourceObjects].sort((a, b) => a.id.localeCompare(b.id)),
      }));
  }, [objects]);

  const hasWorldItems = objects.length > 0 || cameras.length > 0;

  if (!hasWorldItems) {
    return (
      <div className="text-[10px] text-muted-foreground/70">
        {"No world objects yet. Use Create -> Objects."}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {cameras.length > 0 ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between px-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
            <span>Cameras</span>
            <span className="tabular-nums">{cameras.length}</span>
          </div>
          <div className="overflow-hidden rounded-sm border border-border/20 bg-background/20">
            {cameras.map((camera) => {
              const isSelected = camera.id === selectedCameraId;
              return (
                <div
                  key={camera.id}
                  className={cn(
                    "group cursor-pointer border-b border-border/20 px-1.5 py-1 transition-colors last:border-b-0",
                    isSelected ? "bg-muted/35" : "hover:bg-muted/20"
                  )}
                  onClick={() => selectWorldCamera(camera.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <CameraIcon className="h-3 w-3 shrink-0 text-muted-foreground/80" />
                      <span className="truncate text-[9.5px] font-medium text-foreground/95">
                        {camera.name}
                      </span>
                    </div>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[8.5px] text-muted-foreground">
                    <span className="truncate">{camera.parent_joint}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {objectGroups.length > 0 ? (
        <div className="space-y-1">
          {objectGroups.map((group) => (
            <div key={group.source} className="space-y-0.5">
              <div className="flex items-center justify-between px-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                <span>{group.label}</span>
                <span className="tabular-nums">{group.objects.length}</span>
              </div>
              <div className="overflow-hidden rounded-sm border border-border/20 bg-background/20">
                {group.objects.map((obj) => {
                  const isHidden = obj.isHidden === true;
                  const isSelected = obj.id === selectedObjectId;
                  const trackingReference = resolveTrackingReference({
                    robot,
                    trackedName: obj.trackedJointName,
                    endEffectorLink,
                  });
                  const liveDistance =
                    trackingReference?.position !== null && trackingReference?.position !== undefined
                      ? obj.position.distanceTo(trackingReference.position)
                      : null;
                  const objectOrdinal = obj.id.startsWith("object-") ? obj.id.slice(7) : obj.id;

                  return (
                    <div
                      key={obj.id}
                      className={cn(
                        "group cursor-pointer border-b border-border/20 px-1.5 py-1 transition-colors last:border-b-0",
                        isSelected ? "bg-muted/35" : "hover:bg-muted/20",
                        isHidden && "opacity-70"
                      )}
                      onClick={() => selectWorldObject(obj.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Box className="h-3 w-3 shrink-0 text-muted-foreground/80" />
                          <span className="truncate text-[9.5px] font-medium text-foreground/95">
                            {obj.type.charAt(0).toUpperCase() + obj.type.slice(1)} {objectOrdinal}
                          </span>
                          {isHidden ? (
                            <span className="shrink-0 text-[8px] uppercase tracking-[0.05em] text-muted-foreground/80">
                              Hidden
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {liveDistance !== null ? (
                            <span className="text-[8.5px] font-mono text-muted-foreground tabular-nums">
                              {liveDistance.toFixed(3)} m
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleWorldObjectVisibility(obj.id, isHidden);
                            }}
                            title={isHidden ? "Show object" : "Hide object"}
                            aria-label={isHidden ? "Show object" : "Hide object"}
                            className="text-muted-foreground/70 transition-colors hover:text-foreground"
                          >
                            {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[8.5px] text-muted-foreground">
                        <span className="truncate">{trackingReference?.label ?? "No reference"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
