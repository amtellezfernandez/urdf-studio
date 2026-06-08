import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import type { TopNavBarProps } from "./types";
import { menuContentClass, menuItemClass, menuTriggerClass } from "./menuStyles";

type ViewMenuProps = Pick<
  TopNavBarProps,
  | "angleUnit"
  | "setAngleUnit"
  | "rendererRuntime"
  | "onRendererRuntimeChange"
  | "rendererRuntimeLocked"
  | "rendererRuntimeLockedReason"
  | "rosVizRuntimeAvailable"
  | "rosVizRuntimeUnavailableReason"
  | "viewerProfile"
  | "onViewerProfileChange"
  | "viewerProfileLocked"
  | "viewerProfileLockedReason"
  | "displaysPanelOpen"
  | "runtimeHealthPanelOpen"
  | "onToggleDisplaysPanel"
  | "onToggleRuntimeHealthPanel"
  | "gpuMode"
  | "setGPUMode"
  | "collisionsVisible"
  | "setCollisionsVisible"
  | "showUrdfEditor"
  | "setShowUrdfEditor"
  | "urdfViewMode"
  | "setUrdfViewMode"
  | "showPovCameras"
  | "setShowPovCameras"
  | "inertialVisualization"
  | "setInertialVisualization"
> & {
  minimalMode?: boolean;
};

export function ViewMenu({
  angleUnit,
  setAngleUnit,
  rendererRuntime,
  onRendererRuntimeChange,
  rendererRuntimeLocked,
  rendererRuntimeLockedReason,
  rosVizRuntimeAvailable,
  rosVizRuntimeUnavailableReason,
  viewerProfile,
  onViewerProfileChange,
  viewerProfileLocked,
  viewerProfileLockedReason,
  displaysPanelOpen,
  runtimeHealthPanelOpen,
  onToggleDisplaysPanel,
  onToggleRuntimeHealthPanel,
  gpuMode,
  setGPUMode,
  collisionsVisible,
  setCollisionsVisible,
  showUrdfEditor,
  setShowUrdfEditor,
  urdfViewMode,
  setUrdfViewMode,
  showPovCameras,
  setShowPovCameras,
  inertialVisualization,
  setInertialVisualization,
  minimalMode = false,
}: ViewMenuProps) {
  const rendererSubmenuDisabled = rendererRuntimeLocked;
  const rendererSubmenuDisabledTitle = rendererRuntimeLockedReason;
  const rosVizItemDisabled = rendererRuntimeLocked || !rosVizRuntimeAvailable;
  const rosVizItemTitle = rendererRuntimeLocked
    ? rendererRuntimeLockedReason
    : rosVizRuntimeUnavailableReason;
  const profileSubmenuDisabled = viewerProfileLocked;
  const profileSubmenuTitle = viewerProfileLockedReason;

  const toggleInertial = (
    key: "showGlobalCOM" | "showLinkCOM" | "showInertia" | "showReferenceGeometry"
  ) => {
    setInertialVisualization((prev) => ({
      ...prev,
      [key]: !prev[key],
      scopedLinkNames: null,
    }));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn(menuTriggerClass, "ml-1")}>View</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("w-48", menuContentClass)}>
        {!minimalMode ? (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                disabled={rendererSubmenuDisabled}
                title={rendererSubmenuDisabledTitle}
                className={menuItemClass}
              >
                Renderer
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={cn("w-40", menuContentClass)}>
                <DropdownMenuItem
                  onClick={() => onRendererRuntimeChange("studio3D")}
                  disabled={rendererSubmenuDisabled}
                  title={rendererSubmenuDisabledTitle}
                  className={cn(
                    menuItemClass,
                    rendererRuntime === "studio3D" && "bg-[#3d3d3d] text-white",
                    rendererSubmenuDisabled && "opacity-50 cursor-not-allowed"
                  )}
                >
                  Studio 3D
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onRendererRuntimeChange("rosVizV2")}
                  disabled={rosVizItemDisabled}
                  title={rosVizItemTitle}
                  className={cn(
                    menuItemClass,
                    rendererRuntime === "rosVizV2" && "bg-[#3d3d3d] text-white",
                    rosVizItemDisabled && "opacity-50 cursor-not-allowed"
                  )}
                >
                  ROS viz v2
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                disabled={profileSubmenuDisabled}
                title={profileSubmenuTitle}
                className={menuItemClass}
              >
                Viewer Profile
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={cn("w-40", menuContentClass)}>
                <DropdownMenuItem
                  onClick={() => onViewerProfileChange("studio")}
                  disabled={profileSubmenuDisabled}
                  title={profileSubmenuTitle}
                  className={cn(
                    menuItemClass,
                    viewerProfile === "studio" && "bg-[#3d3d3d] text-white",
                    profileSubmenuDisabled && "opacity-50 cursor-not-allowed"
                  )}
                >
                  Studio
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onViewerProfileChange("ros_debug")}
                  disabled={profileSubmenuDisabled}
                  title={profileSubmenuTitle}
                  className={cn(
                    menuItemClass,
                    viewerProfile === "ros_debug" && "bg-[#3d3d3d] text-white",
                    profileSubmenuDisabled && "opacity-50 cursor-not-allowed"
                  )}
                >
                  ROS Debug
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem
              onClick={onToggleDisplaysPanel}
              className={cn(menuItemClass, displaysPanelOpen && "bg-[#3d3d3d] text-white")}
            >
              Displays Panel
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onToggleRuntimeHealthPanel}
              className={cn(menuItemClass, runtimeHealthPanelOpen && "bg-[#3d3d3d] text-white")}
            >
              Runtime Health
            </DropdownMenuItem>
          </>
        ) : null}

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={menuItemClass}>Angle Unit</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={cn("w-32", menuContentClass)}>
            <DropdownMenuItem
              onClick={() => setAngleUnit("rad")}
              className={cn(menuItemClass, angleUnit === "rad" && "bg-[#3d3d3d] text-white")}
            >
              Radians
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setAngleUnit("deg")}
              className={cn(menuItemClass, angleUnit === "deg" && "bg-[#3d3d3d] text-white")}
            >
              Degrees
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={menuItemClass}>GPU Mode</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={cn("w-40", menuContentClass)}>
            <DropdownMenuItem
              onClick={() => setGPUMode("low")}
              className={cn(menuItemClass, gpuMode === "low" && "bg-[#3d3d3d] text-white")}
            >
              Low GPU Mode
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setGPUMode("high")}
              className={cn(menuItemClass, gpuMode === "high" && "bg-[#3d3d3d] text-white")}
            >
              High GPU Mode
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={menuItemClass}>Center of Mass</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={cn("w-44", menuContentClass)}>
            <DropdownMenuItem
              onClick={() => toggleInertial("showGlobalCOM")}
              className={cn(
                menuItemClass,
                inertialVisualization.showGlobalCOM && "bg-[#3d3d3d] text-white"
              )}
            >
              Global COM
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => toggleInertial("showLinkCOM")}
              className={cn(
                menuItemClass,
                inertialVisualization.showLinkCOM && "bg-[#3d3d3d] text-white"
              )}
            >
              Link COM Markers
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => toggleInertial("showInertia")}
              className={cn(
                menuItemClass,
                inertialVisualization.showInertia && "bg-[#3d3d3d] text-white"
              )}
            >
              Inertia Boxes
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => toggleInertial("showReferenceGeometry")}
              className={cn(
                menuItemClass,
                inertialVisualization.showReferenceGeometry && "bg-[#3d3d3d] text-white"
              )}
            >
              Reference Boxes
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem
          onClick={() => setCollisionsVisible(!collisionsVisible)}
          className={cn(menuItemClass, collisionsVisible && "bg-[#3d3d3d] text-white")}
        >
          Collisions
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => setShowUrdfEditor(false)}
          className={cn(menuItemClass, !showUrdfEditor && "bg-[#3d3d3d] text-white")}
        >
          3D Visualization
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setShowPovCameras(true)}
          className={cn(menuItemClass, showPovCameras && "bg-[#3d3d3d] text-white")}
        >
          POV Cameras
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            className={cn(menuItemClass, showUrdfEditor && "bg-[#3d3d3d] text-white")}
          >
            URDF File
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={cn("w-40", menuContentClass)}>
            <DropdownMenuItem
              onClick={() => {
                setShowUrdfEditor(true);
                setUrdfViewMode("original");
              }}
              className={cn(
                menuItemClass,
                showUrdfEditor && urdfViewMode === "original" && "bg-[#3d3d3d] text-white"
              )}
            >
              Original
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setShowUrdfEditor(true);
                setUrdfViewMode("modified");
              }}
              className={cn(
                menuItemClass,
                showUrdfEditor && urdfViewMode === "modified" && "bg-[#3d3d3d] text-white"
              )}
            >
              Modified
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setShowUrdfEditor(true);
                setUrdfViewMode("split");
              }}
              className={cn(
                menuItemClass,
                showUrdfEditor && urdfViewMode === "split" && "bg-[#3d3d3d] text-white"
              )}
            >
              Split View
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
