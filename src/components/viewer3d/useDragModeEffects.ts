import { useEffect } from "react";
import { getDragModeDisplayName, type DragMode } from "@/components/viewer3d/viewer3d-helpers";

type UseDragModeEffectsParams = {
  dragMode: DragMode;
  isDragModeMenuOpen: boolean;
  setIsDragModeMenuOpen: (open: boolean) => void;
};

export const useDragModeEffects = ({
  dragMode,
  isDragModeMenuOpen,
  setIsDragModeMenuOpen,
}: UseDragModeEffectsParams) => {
  useEffect(() => {
    if (!isDragModeMenuOpen) return;

    const handleClickOutside = () => {
      setIsDragModeMenuOpen(false);
    };

    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [isDragModeMenuOpen, setIsDragModeMenuOpen]);

  useEffect(() => {
    console.log(`[Drag Mode] Switched to: ${getDragModeDisplayName(dragMode)}`);
  }, [dragMode]);
};
