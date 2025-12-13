import { useGPUMode } from "@/hooks/use-gpu-mode";
import { useTheme } from "@/hooks/use-theme";

export const useThemeAndGPUMode = () => {
  const theme = useTheme();
  const gpuMode = useGPUMode();

  return {
    ...theme,
    ...gpuMode,
  };
};
