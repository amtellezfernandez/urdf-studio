import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "urdfstudio:hfToken";

export const useHfToken = () => {
  const [hfToken, setHfToken] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (hfToken) {
        window.localStorage.setItem(STORAGE_KEY, hfToken);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors (e.g., private mode).
    }
  }, [hfToken]);

  const clearHfToken = useCallback(() => setHfToken(null), []);

  return { hfToken, setHfToken, clearHfToken };
};
