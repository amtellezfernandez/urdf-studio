import { useGPUMode } from "@/shared/hooks/use-gpu-mode";
import { useTheme } from "@/shared/hooks/use-theme";

export const useThemeAndGPUMode = () => {
  const theme = useTheme();
  const gpuMode = useGPUMode();

  return {
    ...theme,
    ...gpuMode,
  };
};
