import { useEffect } from "react";

type UseDragModeEffectsParams = {
  isDragModeMenuOpen: boolean;
  setIsDragModeMenuOpen: (open: boolean) => void;
};

export const useDragModeEffects = ({
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
};
