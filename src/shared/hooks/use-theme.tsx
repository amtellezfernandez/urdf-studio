import { useEffect } from "react";

const THEME_STORAGE_KEY = "urdf-studio-theme";

export function useTheme() {
  useEffect(() => {
    const root = document.documentElement;
    
    // Always use dark mode
    root.classList.remove("light");
    root.classList.add("dark");
    
    // Save to localStorage
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
  }, []);

  return { theme: "dark" as const };
}

