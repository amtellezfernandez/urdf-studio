/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import {
  readBrowserStorageItem,
  writeBrowserStorageItem,
} from "@/shared/lib/browserStorage";

export type GPUMode = "high" | "low";

const GPU_MODE_STORAGE_KEY = "urdf-studio-gpu-mode";
const DEFAULT_GPU_MODE: GPUMode = "high";

const parseGPUMode = (value: string | null): GPUMode | null =>
  value === "low" || value === "high" ? value : null;

/**
 * Get initial GPU mode from:
 * 1. URL query parameter (?gpu=low or ?gpu=high)
 * 2. localStorage
 * 3. Default to "high"
 */
const getInitialGPUMode = (): GPUMode => {
  const urlParams = new URLSearchParams(window.location.search);
  const urlMode = parseGPUMode(urlParams.get("gpu"));
  if (urlMode) {
    return urlMode;
  }

  const stored = parseGPUMode(readBrowserStorageItem(GPU_MODE_STORAGE_KEY));
  if (stored) {
    return stored;
  }

  return DEFAULT_GPU_MODE;
};

interface GPUModeContextType {
  gpuMode: GPUMode;
  setGPUMode: (mode: GPUMode) => void;
}

const GPUModeContext = createContext<GPUModeContextType | undefined>(undefined);

export function GPUModeProvider({ children }: { children: ReactNode }) {
  const [gpuMode, setGpuMode] = useState<GPUMode>(getInitialGPUMode);

  useEffect(() => {
    writeBrowserStorageItem(GPU_MODE_STORAGE_KEY, gpuMode);
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
