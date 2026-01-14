import { AlertCircle, CheckCircle2, X, XCircle } from "lucide-react";
import type { DebugMeshInfo } from "@/shared/types/feature";

type MeshFilesStatusPanelProps = {
  open: boolean;
  debugMeshInfo: DebugMeshInfo[];
  unmatchedURDFRefs: string[];
  isRightSidebarCollapsed: boolean;
  rightSidebarWidth: number;
  onClose: () => void;
};

export const MeshFilesStatusPanel = ({
  open,
  debugMeshInfo,
  unmatchedURDFRefs,
  isRightSidebarCollapsed,
  rightSidebarWidth,
  onClose,
}: MeshFilesStatusPanelProps) => {
  if (!open) return null;

  const foundCount = debugMeshInfo.filter((info) => info.found).length;
  const missingCount = debugMeshInfo.length - foundCount;

  return (
    <div
      className="fixed bottom-4 z-50 w-80 max-h-[40vh] bg-[#282828] border border-[#3d3d3d] rounded-lg shadow-lg flex flex-col"
      style={{
        right: isRightSidebarCollapsed ? "1rem" : `${rightSidebarWidth + 16}px`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-[#3d3d3d]">
        <div className="text-xs font-medium text-[#d4d4d4]">Mesh Files Status</div>
        <button
          onClick={onClose}
          className="text-[#9d9d9d] hover:text-[#d4d4d4] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Summary */}
      <div className="px-2 py-1.5 text-xs border-b border-[#3d3d3d] bg-[#1e1e1e]">
        <div className="text-[#9d9d9d]">
          Total: {debugMeshInfo.length} |{" "}
          <span className="text-[#6d9d6d] ml-1">✓ {foundCount}</span> |{" "}
          <span className="text-[#9d6d6d] ml-1">✗ {missingCount}</span>
          {unmatchedURDFRefs.length > 0 && (
            <span className="text-[#9d6d6d] ml-2">
              ⚠ {unmatchedURDFRefs.length}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="overflow-y-auto flex-1 p-2 space-y-1 blender-scrollbar">
        {unmatchedURDFRefs.length > 0 && (
          <div className="mb-2 p-1.5 bg-[#2a1e1e] border border-[#4a2d2d] rounded text-xs">
            <div className="flex items-center gap-1 mb-1">
              <AlertCircle className="h-3 w-3 text-[#9d6d6d]" />
              <span className="font-medium text-[#9d6d6d]">
                Unmatched: {unmatchedURDFRefs.length}
              </span>
            </div>
          </div>
        )}

        {debugMeshInfo.map((info, index) => (
          <div
            key={index}
            className={`text-xs p-1.5 rounded border ${
              info.found
                ? "bg-[#1e2a1e] border-[#3d4a3d]"
                : "bg-[#2a1e1e] border-[#4a3d3d]"
            }`}
          >
            <div className="flex items-start gap-1.5">
              {info.found ? (
                <CheckCircle2 className="h-3 w-3 text-[#6d9d6d] flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-3 w-3 text-[#9d6d6d] flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[#d4d4d4] truncate">
                  {info.filename}
                </div>
                {info.found && info.urdfReference && (
                  <div className="text-[#9d9d9d] text-[10px] mt-0.5 truncate">
                    {info.urdfReference}
                  </div>
                )}
                {!info.found && (
                  <div className="text-[#9d6d6d] text-[10px] mt-0.5">
                    Not found
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
