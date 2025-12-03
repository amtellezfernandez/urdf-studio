import { useState, useEffect, createContext, useContext, ReactNode } from "react";

export type GPUMode = "high" | "low";

const GPU_MODE_STORAGE_KEY = "urdf-studio-gpu-mode";

/**
 * Get initial GPU mode from:
 * 1. URL query parameter (?gpu=low or ?gpu=high)
 * 2. localStorage
 * 3. Default to "high"
 */
const getInitialGPUMode = (): GPUMode => {
  // Check URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const urlMode = urlParams.get("gpu");
  if (urlMode === "low" || urlMode === "high") {
    return urlMode;
  }

  // Check localStorage
  const stored = localStorage.getItem(GPU_MODE_STORAGE_KEY) as GPUMode | null;
  if (stored === "low" || stored === "high") {
    return stored;
  }

  // Default to high
  return "high";
};

interface GPUModeContextType {
  gpuMode: GPUMode;
  setGPUMode: (mode: GPUMode) => void;
}

const GPUModeContext = createContext<GPUModeContextType | undefined>(undefined);

export function GPUModeProvider({ children }: { children: ReactNode }) {
  const [gpuMode, setGpuMode] = useState<GPUMode>(getInitialGPUMode);

  useEffect(() => {
    localStorage.setItem(GPU_MODE_STORAGE_KEY, gpuMode);
  }, [gpuMode]);

  const setGPUMode = (mode: GPUMode) => {
    setGpuMode(mode);
  };

  return (
    <GPUModeContext.Provider value={{ gpuMode, setGPUMode }}>
      {children}
    </GPUModeContext.Provider>
  );
}

export function useGPUMode() {
  const context = useContext(GPUModeContext);
  if (context === undefined) {
    throw new Error("useGPUMode must be used within a GPUModeProvider");
  }
  return context;
}
