import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Trash2, Edit } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { SavedMapping } from "@/features/types";

interface MappingListPanelProps {
  isOpen: boolean;
  onClose: () => void;
  mappings: SavedMapping[];
  onSelectMapping: (mapping: SavedMapping) => void;
  onDeleteMapping: (id: string) => void;
}

export const MappingListPanel = ({
  isOpen,
  onClose,
  mappings,
  onSelectMapping,
  onDeleteMapping,
}: MappingListPanelProps) => {
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[70vh] overflow-hidden flex flex-col bg-[#282828] border border-[#3d3d3d] text-[#d4d4d4]">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-sm font-medium text-white">
            Saved Joint Mappings
          </DialogTitle>
          <DialogDescription className="text-xs text-[#9d9d9d]">
            Select a mapping to edit or apply
          </DialogDescription>
        </DialogHeader>

        {mappings.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-8">
            <div className="text-center space-y-2">
              <div className="text-sm text-[#9d9d9d]">No saved mappings</div>
              <div className="text-xs text-[#5d5d5d]">
                Mappings will be saved automatically when you apply them to a dataset
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto blender-scrollbar space-y-2">
            {mappings.map((mapping) => (
              <div
                key={mapping.id}
                className="p-3 bg-[#1e1e1e] border border-[#3d3d3d] rounded hover:border-[#4d4d4d] transition-colors cursor-pointer"
                onClick={() => onSelectMapping(mapping)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-sm font-medium text-white truncate">
                        {mapping.source}
                      </div>
                      {mapping.degToRad && (
                        <Badge
                          variant="outline"
                          className="h-5 px-1.5 text-[10px] bg-[#2d3d4d] border-[#4d6d7d] text-[#9dbdcd]"
                        >
                          deg→rad
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-[#9d9d9d]">
                      <span>{mapping.mappings.length} joints</span>
                      <span className="text-[#5d5d5d]">•</span>
                      <span>{formatTimestamp(mapping.timestamp)}</span>
                    </div>

                    {/* Show first few mappings as preview */}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {mapping.mappings.slice(0, 5).map((m) => (
                        <div
                          key={m.datasetJoint}
                          className="text-[10px] px-1.5 py-0.5 bg-[#2d2d2d] border border-[#3d3d3d] rounded font-mono text-[#9d9d9d]"
                        >
                          {m.datasetJoint} → {m.urdfJoint}
                        </div>
                      ))}
                      {mapping.mappings.length > 5 && (
                        <div className="text-[10px] px-1.5 py-0.5 text-[#5d5d5d]">
                          +{mapping.mappings.length - 5} more
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectMapping(mapping);
                      }}
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs bg-[#2d2d2d] border-[#3d3d3d] text-[#d4d4d4] hover:bg-[#3d3d3d] hover:text-white"
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteMapping(mapping.id);
                      }}
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs bg-[#2d2d2d] border-[#3d3d3d] text-[#d4d4d4] hover:bg-[#3d1e1e] hover:border-[#5d2e2e] hover:text-[#dd6d6d]"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex-shrink-0 flex justify-end pt-3 border-t border-[#3d3d3d]">
          <Button
            onClick={onClose}
            variant="outline"
            className="h-7 text-xs bg-[#1e1e1e] border-[#3d3d3d] text-[#d4d4d4] hover:bg-[#2d2d2d] hover:text-white"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
