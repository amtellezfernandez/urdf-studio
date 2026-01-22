import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/shared/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import type { AngleUnit, JointLimitMode, RotationAxis, UrdfViewMode } from "@/shared/types/feature";

type DatasetActions = {
  loadFromLocal: () => void;
  loadFromHuggingFace: () => void;
  exportToLocal: () => void;
  exportToHuggingFace: () => void;
  isImportingFromHF: boolean;
  isExportingDataset: boolean;
  isUploadingToHF: boolean;
  hasEpisodes: boolean;
  limitCorrectionMode: JointLimitMode;
  setLimitCorrectionMode: (mode: JointLimitMode) => void;
};

type TopNavBarProps = {
  showMenus: boolean;
  openExportDialog: () => void;
  onSave: () => void;
  onRevert: () => void;
  canRevert: boolean;
  onResetRotation: () => void;
  hasRotationChanges: boolean;
  onCanonicalOrder: () => void;
  onPrettyPrint: () => void;
  onNormalizeAxes: () => void;
  onFixMeshPaths: () => void;
  rotationAxis: RotationAxis;
  setRotationAxis: (axis: RotationAxis) => void;
  onRotateRobot: (axis: RotationAxis) => void;
  angleUnit: AngleUnit;
  setAngleUnit: (unit: AngleUnit) => void;
  gpuMode: "low" | "high";
  setGPUMode: (mode: "low" | "high") => void;
  showUrdfEditor: boolean;
  setShowUrdfEditor: (show: boolean) => void;
  urdfViewMode: UrdfViewMode;
  setUrdfViewMode: (mode: UrdfViewMode) => void;
  showPovCameras: boolean;
  setShowPovCameras: (show: boolean) => void;
  openMappingList: () => void;
  datasetActions?: DatasetActions | null;
  openObjectCreator: (type?: "cube" | "point") => void;
  setShowCameraCreator: (show: boolean) => void;
  setShowCameraUpload: (show: boolean) => void;
  exportCamerasAsJSON: () => void;
  exportCamerasAsYAML: () => void;
  hasCamerasToExport: boolean;
};

export const TopNavBar = ({
  showMenus,
  openExportDialog,
  onSave,
  onRevert,
  canRevert,
  onResetRotation,
  hasRotationChanges,
  onCanonicalOrder,
  onPrettyPrint,
  onNormalizeAxes,
  onFixMeshPaths,
  rotationAxis,
  setRotationAxis,
  onRotateRobot,
  angleUnit,
  setAngleUnit,
  gpuMode,
  setGPUMode,
  showUrdfEditor,
  setShowUrdfEditor,
  urdfViewMode,
  setUrdfViewMode,
  showPovCameras,
  setShowPovCameras,
  openMappingList,
  datasetActions,
  openObjectCreator,
  setShowCameraCreator,
  setShowCameraUpload,
  exportCamerasAsJSON,
  exportCamerasAsYAML,
  hasCamerasToExport,
}: TopNavBarProps) => (
  <div className="fixed top-0 left-0 right-0 z-50 h-7 bg-[#282828] border-b border-[#3d3d3d] flex items-center px-1">
    <img
      src="/assets/urdf-studio-logo.png"
      alt="URDF Studio"
      className="h-5 w-auto object-contain ml-1 mr-3"
    />
    {showMenus && (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-5 px-2.5 text-[11px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] rounded-none border-l border-[#3d3d3d] flex items-center transition-none ml-1">
              File
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 bg-[#282828] border-[#3d3d3d]">
            <DropdownMenuItem
              onClick={openExportDialog}
              className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
            >
              Export
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onSave}
              className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
            >
              Save
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onRevert}
              disabled={!canRevert}
              className={cn(
                "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                !canRevert && "opacity-50 cursor-not-allowed"
              )}
              title="Reloads the last saved file"
            >
              Revert
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onResetRotation}
              disabled={!hasRotationChanges}
              className={cn(
                "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                !hasRotationChanges && "opacity-50 cursor-not-allowed"
              )}
              title="Reloads the original loaded file"
            >
              Reset
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-5 px-2.5 text-[11px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] rounded-none border-l border-[#3d3d3d] flex items-center transition-none">
              Utils
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48 bg-[#282828] border-[#3d3d3d]">
            <DropdownMenuItem
              onClick={onCanonicalOrder}
              className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
            >
              Canonical Order
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onPrettyPrint}
              className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
            >
              Pretty Print
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onNormalizeAxes}
              className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
            >
              Normalize Axes
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onFixMeshPaths}
              className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
            >
              Fix Mesh Paths
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
              >
                Rotate
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-32 bg-[#282828] border-[#3d3d3d]">
                <DropdownMenuItem
                  onClick={() => {
                    setRotationAxis("x");
                    onRotateRobot("x");
                  }}
                  className={cn(
                    "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                    rotationAxis === "x" && "bg-[#3d3d3d] text-white"
                  )}
                >
                  X
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setRotationAxis("y");
                    onRotateRobot("y");
                  }}
                  className={cn(
                    "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                    rotationAxis === "y" && "bg-[#3d3d3d] text-white"
                  )}
                >
                  Y
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setRotationAxis("z");
                    onRotateRobot("z");
                  }}
                  className={cn(
                    "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                    rotationAxis === "z" && "bg-[#3d3d3d] text-white"
                  )}
                >
                  Z
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    )}
    {showMenus && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="h-5 px-2.5 text-[11px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] rounded-none border-l border-[#3d3d3d] flex items-center transition-none ml-1">
            View
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48 bg-[#282828] border-[#3d3d3d]">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
            >
              Angle Unit
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-32 bg-[#282828] border-[#3d3d3d]">
              <DropdownMenuItem
                onClick={() => setAngleUnit("rad")}
                className={cn(
                  "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                  angleUnit === "rad" && "bg-[#3d3d3d] text-white"
                )}
              >
                Radians
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setAngleUnit("deg")}
                className={cn(
                  "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                  angleUnit === "deg" && "bg-[#3d3d3d] text-white"
                )}
              >
                Degrees
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
            >
              GPU Mode
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40 bg-[#282828] border-[#3d3d3d]">
              <DropdownMenuItem
                onClick={() => setGPUMode("low")}
                className={cn(
                  "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                  gpuMode === "low" && "bg-[#3d3d3d] text-white"
                )}
              >
                Low GPU Mode
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setGPUMode("high")}
                className={cn(
                  "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                  gpuMode === "high" && "bg-[#3d3d3d] text-white"
                )}
              >
                High GPU Mode
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            onClick={() => setShowUrdfEditor(false)}
            className={cn(
              "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
              !showUrdfEditor && "bg-[#3d3d3d] text-white"
            )}
          >
            3D Visualization
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setShowPovCameras(true)}
            className={cn(
              "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
              showPovCameras && "bg-[#3d3d3d] text-white"
            )}
          >
            POV Cameras
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className={cn(
                "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                showUrdfEditor && "bg-[#3d3d3d] text-white"
              )}
            >
              URDF File
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40 bg-[#282828] border-[#3d3d3d]">
              <DropdownMenuItem
                onClick={() => {
                  setShowUrdfEditor(true);
                  setUrdfViewMode("original");
                }}
                className={cn(
                  "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
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
                  "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
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
                  "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                  showUrdfEditor && urdfViewMode === "split" && "bg-[#3d3d3d] text-white"
                )}
              >
                Split View
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    )}
    {showMenus && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="h-5 px-2.5 text-[11px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] rounded-none border-l border-[#3d3d3d] flex items-center transition-none ml-1">
            Dataset
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48 bg-[#282828] border-[#3d3d3d]">
          <DropdownMenuItem
            onClick={openMappingList}
            className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
          >
            Joint Mappings
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
            >
              Load Episodes
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48 bg-[#282828] border-[#3d3d3d]">
              <DropdownMenuItem
                onClick={() => datasetActions?.loadFromLocal()}
                disabled={!datasetActions}
                className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                From Local File
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => datasetActions?.loadFromHuggingFace()}
                disabled={!datasetActions || datasetActions.isImportingFromHF}
                className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {datasetActions?.isImportingFromHF ? "Loading from HF..." : "From Hugging Face"}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
            >
              Export Episodes
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48 bg-[#282828] border-[#3d3d3d]">
              <DropdownMenuItem
                onClick={() => datasetActions?.exportToLocal()}
                disabled={!datasetActions || !datasetActions.hasEpisodes || datasetActions.isExportingDataset}
                className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {datasetActions?.isExportingDataset ? "Exporting..." : "To Local File"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => datasetActions?.exportToHuggingFace()}
                disabled={!datasetActions || !datasetActions.hasEpisodes || datasetActions.isUploadingToHF}
                className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {datasetActions?.isUploadingToHF ? "Uploading to HF..." : "To Hugging Face"}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {datasetActions && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]">
                Limit Corrections
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48 bg-[#282828] border-[#3d3d3d]">
                <DropdownMenuItem
                  onClick={() => datasetActions.setLimitCorrectionMode("report")}
                  className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                >
                  {datasetActions.limitCorrectionMode === "report" ? "[x] " : "[ ] "}
                  Report only
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => datasetActions.setLimitCorrectionMode("clamp")}
                  className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                >
                  {datasetActions.limitCorrectionMode === "clamp" ? "[x] " : "[ ] "}
                  Clamp to limits
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => datasetActions.setLimitCorrectionMode("shift")}
                  className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
                >
                  {datasetActions.limitCorrectionMode === "shift" ? "[x] " : "[ ] "}
                  Shift to fit
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )}
    {showMenus && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="h-5 px-2.5 text-[11px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d] rounded-none border-l border-[#3d3d3d] flex items-center transition-none ml-1">
            Create
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48 bg-[#282828] border-[#3d3d3d]">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
            >
              Objects
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-32 bg-[#282828] border-[#3d3d3d]">
              <DropdownMenuItem
                onClick={() => {
                  openObjectCreator("cube");
                }}
                className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
              >
                Cube
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  openObjectCreator("point");
                }}
                className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
              >
                Point
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
            >
              Camera
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48 bg-[#282828] border-[#3d3d3d]">
              <DropdownMenuItem
                onClick={() => setShowCameraCreator(true)}
                className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
              >
                Add Camera
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setShowCameraUpload(true)}
                className="text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
              >
                Upload Camera Config
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={exportCamerasAsJSON}
                disabled={!hasCamerasToExport}
                className={cn(
                  "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                  !hasCamerasToExport && "opacity-50 cursor-not-allowed"
                )}
              >
                Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={exportCamerasAsYAML}
                disabled={!hasCamerasToExport}
                className={cn(
                  "text-[11px] cursor-pointer text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]",
                  !hasCamerasToExport && "opacity-50 cursor-not-allowed"
                )}
              >
                Export as YAML
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    )}
  </div>
);
