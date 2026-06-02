import { useEffect } from "react";
import { writeBrowserStorageItem } from "@/shared/lib/browserStorage";

const THEME_STORAGE_KEY = "urdf-studio-theme";

export function useTheme() {
  useEffect(() => {
    const root = document.documentElement;
    
    // Always use dark mode
    root.classList.remove("light");
    root.classList.add("dark");
    
    // Save to localStorage
    writeBrowserStorageItem(THEME_STORAGE_KEY, "dark");
  }, []);

  return { theme: "dark" as const };
}
